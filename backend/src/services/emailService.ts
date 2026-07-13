import fs from 'fs';
import path from 'path';
import { gmail, gmail_v1 } from '@googleapis/gmail';
import { OAuth2Client } from 'google-auth-library';
import { convert } from 'html-to-text';
import logger from '../config/logger';
import {
  GmailTokenStore,
  GmailTokenEntry,
  EmailSummary,
  AttachmentMeta,
  EmailDraft,
  DraftResult,
  EmailListResult,
} from '../types/email';

const log = logger.child({ service: 'emailService' });
const TOKEN_FILE = path.join(__dirname, '../../.gmail-tokens.json');
const MAX_BODY_BYTES = 50 * 1024;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
];

class EmailService {
  private static instance: EmailService;

  static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  getScopes(): string[] {
    return SCOPES;
  }

  getRedirectUri(): string {
    return 'http://localhost:5001/api/v1/auth/gmail/callback';
  }

  createOAuth2Client(): OAuth2Client {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    }
    return new OAuth2Client(clientId, clientSecret, this.getRedirectUri());
  }

  // ─── Token CRUD ───

  getTokens(userId: string): GmailTokenEntry | null {
    const store = this.readTokenFile();
    return store[userId] ?? null;
  }

  saveTokens(userId: string, tokens: GmailTokenEntry): void {
    const store = this.readTokenFile();
    store[userId] = tokens;
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
    log.info({ userId }, 'Gmail tokens saved');
  }

  removeTokens(userId: string): void {
    const store = this.readTokenFile();
    delete store[userId];
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
    log.info({ userId }, 'Gmail tokens removed');
  }

  isConnected(userId: string): boolean {
    return this.getTokens(userId) !== null;
  }

  private readTokenFile(): GmailTokenStore {
    try {
      if (!fs.existsSync(TOKEN_FILE)) return {};
      const data = fs.readFileSync(TOKEN_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  // ─── Auth Client ───

  async getAuthClient(userId: string): Promise<OAuth2Client> {
    const entry = this.getTokens(userId);
    if (!entry) {
      throw new Error('Gmail not connected. Visit /api/v1/auth/gmail to authorize.');
    }

    const oauth2 = this.createOAuth2Client();
    oauth2.setCredentials({
      access_token: entry.accessToken,
      refresh_token: entry.refreshToken,
      expiry_date: entry.expiryDate,
    });

    if (Date.now() >= entry.expiryDate) {
      log.info({ userId }, 'Access token expired, refreshing');
      try {
        const { credentials } = await oauth2.refreshAccessToken();
        this.saveTokens(userId, {
          ...entry,
          accessToken: credentials.access_token!,
          expiryDate: credentials.expiry_date!,
        });
        oauth2.setCredentials(credentials);
      } catch (err: any) {
        log.error({ userId, err }, 'Token refresh failed');
        this.removeTokens(userId);
        throw new Error('Gmail authorization expired. Visit /api/v1/auth/gmail to re-authorize.');
      }
    }

    return oauth2;
  }

  // ─── Retry Wrapper ───

  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        const is429 = err?.code === 429 || err?.response?.status === 429;
        if (!is429 || attempt === retries) throw err;
        const delay = Math.pow(2, attempt) * 1000;
        log.warn({ attempt: attempt + 1, delay }, 'Rate limited, retrying');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error('Retry exhausted');
  }

  // ─── Email Parsing ───

  parseEmail(message: gmail_v1.Schema$Message): EmailSummary {
    const headers = message.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

    const fromRaw = getHeader('From');
    const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
    const from = fromMatch
      ? { name: fromMatch[1].replace(/"/g, '').trim(), address: fromMatch[2] }
      : { name: '', address: fromRaw };

    const toRaw = getHeader('To');
    const to = toRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const labels = message.labelIds ?? [];
    const attachments = this.extractAttachments(message.payload);

    return {
      id: message.id!,
      threadId: message.threadId!,
      from,
      to,
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      snippet: message.snippet ?? '',
      isUnread: labels.includes('UNREAD'),
      hasAttachments: attachments.length > 0,
      attachments: attachments.length > 0 ? attachments : undefined,
      labels,
    };
  }

  extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return '';

    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    }

    if (payload.mimeType === 'text/html' && payload.body?.data) {
      const html = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      return convert(html, { wordwrap: 120 });
    }

    if (payload.parts) {
      const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
      if (textPart) return this.extractBody(textPart);

      const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
      if (htmlPart) return this.extractBody(htmlPart);

      for (const part of payload.parts) {
        const result = this.extractBody(part);
        if (result) return result;
      }
    }

    return '';
  }

  truncateBody(text: string, maxBytes: number = MAX_BODY_BYTES): string {
    const buf = Buffer.from(text, 'utf-8');
    if (buf.length <= maxBytes) return text;
    const truncated = buf.subarray(0, maxBytes).toString('utf-8');
    return truncated + '\n[truncated]';
  }

  private extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): AttachmentMeta[] {
    const attachments: AttachmentMeta[] = [];
    if (!payload) return attachments;

    if (payload.filename && payload.filename.length > 0 && payload.body) {
      attachments.push({
        filename: payload.filename,
        mimeType: payload.mimeType ?? 'application/octet-stream',
        size: payload.body.size ?? 0,
      });
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        attachments.push(...this.extractAttachments(part));
      }
    }

    return attachments;
  }

  // ─── List Emails ───

  async listEmails(
    userId: string,
    filter: 'unread' | 'read' | 'all' = 'unread',
    maxResults: number = 20,
    dateRange?: { after?: string; before?: string },
    includeBody: boolean = false,
  ): Promise<EmailListResult> {
    const auth = await this.getAuthClient(userId);
    const gmailClient = gmail({ version: 'v1', auth });

    const queryParts: string[] = [];
    if (filter === 'unread') queryParts.push('is:unread');
    else if (filter === 'read') queryParts.push('is:read');
    if (dateRange?.after) queryParts.push(`after:${this.formatDateForQuery(dateRange.after)}`);
    if (dateRange?.before) queryParts.push(`before:${this.formatDateForQuery(dateRange.before)}`);

    const q = queryParts.join(' ') || undefined;

    const listResponse = await this.withRetry(() =>
      gmailClient.users.messages.list({ userId: 'me', q, maxResults }),
    );

    const messageIds = listResponse.data.messages ?? [];
    const totalCount = listResponse.data.resultSizeEstimate ?? messageIds.length;

    const emails: EmailSummary[] = [];
    for (const msg of messageIds) {
      const detail = await this.withRetry(() =>
        gmailClient.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: includeBody ? 'full' : 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        }),
      );
      const summary = this.parseEmail(detail.data);
      if (includeBody) {
        const rawBody = this.extractBody(detail.data.payload);
        summary.body = this.truncateBody(rawBody);
      }
      emails.push(summary);
    }

    return { emails, totalCount, returnedCount: emails.length };
  }

  // ─── Get Single Email ───

  async getEmail(userId: string, emailId: string, includeBody: boolean = false): Promise<EmailSummary> {
    const auth = await this.getAuthClient(userId);
    const gmailClient = gmail({ version: 'v1', auth });

    const detail = await this.withRetry(() =>
      gmailClient.users.messages.get({ userId: 'me', id: emailId, format: 'full' }),
    );

    const summary = this.parseEmail(detail.data);
    if (includeBody) {
      const rawBody = this.extractBody(detail.data.payload);
      summary.body = this.truncateBody(rawBody);
    }

    return summary;
  }

  // ─── Search Emails ───

  async searchEmails(
    userId: string,
    params: {
      from?: string;
      to?: string;
      subject?: string;
      keywords?: string;
      dateRange?: { after?: string; before?: string };
      hasAttachment?: boolean;
      maxResults?: number;
      includeBody?: boolean;
    },
  ): Promise<EmailListResult> {
    const queryParts: string[] = [];
    if (params.from) queryParts.push(`from:${params.from}`);
    if (params.to) queryParts.push(`to:${params.to}`);
    if (params.subject) queryParts.push(`subject:${params.subject}`);
    if (params.keywords) queryParts.push(params.keywords);
    if (params.dateRange?.after) queryParts.push(`after:${this.formatDateForQuery(params.dateRange.after)}`);
    if (params.dateRange?.before) queryParts.push(`before:${this.formatDateForQuery(params.dateRange.before)}`);
    if (params.hasAttachment) queryParts.push('has:attachment');

    const auth = await this.getAuthClient(userId);
    const gmailClient = gmail({ version: 'v1', auth });
    const maxResults = params.maxResults ?? 20;
    const q = queryParts.join(' ') || undefined;

    const listResponse = await this.withRetry(() =>
      gmailClient.users.messages.list({ userId: 'me', q, maxResults }),
    );

    const messageIds = listResponse.data.messages ?? [];
    const totalCount = listResponse.data.resultSizeEstimate ?? messageIds.length;

    const emails: EmailSummary[] = [];
    for (const msg of messageIds) {
      const detail = await this.withRetry(() =>
        gmailClient.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: params.includeBody ? 'full' : 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        }),
      );
      const summary = this.parseEmail(detail.data);
      if (params.includeBody) {
        const rawBody = this.extractBody(detail.data.payload);
        summary.body = this.truncateBody(rawBody);
      }
      emails.push(summary);
    }

    return { emails, totalCount, returnedCount: emails.length };
  }

  // ─── Create Draft ───

  async createDraft(userId: string, draft: EmailDraft): Promise<DraftResult> {
    const auth = await this.getAuthClient(userId);
    const gmailClient = gmail({ version: 'v1', auth });

    const mime = this.buildMimeMessage(draft);
    const encodedMessage = Buffer.from(mime).toString('base64url');

    const response = await this.withRetry(() =>
      gmailClient.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw: encodedMessage } },
      }),
    );

    log.info({ userId, draftId: response.data.id }, 'Draft created');

    return {
      draftId: response.data.id!,
      threadId: response.data.message?.threadId ?? '',
      to: draft.to,
      subject: draft.subject,
      bodyPreview: draft.body.substring(0, 200),
    };
  }

  // ─── Create Reply Draft ───

  async createReplyDraft(userId: string, emailId: string, body: string): Promise<DraftResult> {
    const auth = await this.getAuthClient(userId);
    const gmailClient = gmail({ version: 'v1', auth });

    const original = await this.withRetry(() =>
      gmailClient.users.messages.get({ userId: 'me', id: emailId, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Message-ID', 'References'] }),
    );

    const headers = original.data.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

    const originalFrom = getHeader('From');
    const originalSubject = getHeader('Subject');
    const messageId = getHeader('Message-ID');
    const references = getHeader('References');
    const threadId = original.data.threadId!;

    const replySubject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`;
    const replyReferences = references ? `${references} ${messageId}` : messageId;

    const fromMatch = originalFrom.match(/<(.+?)>/);
    const replyTo = fromMatch ? fromMatch[1] : originalFrom;

    const mime = this.buildReplyMimeMessage(
      { to: replyTo, subject: replySubject, body },
      messageId,
      replyReferences,
    );
    const encodedMessage = Buffer.from(mime).toString('base64url');

    const response = await this.withRetry(() =>
      gmailClient.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw: encodedMessage, threadId } },
      }),
    );

    log.info({ userId, draftId: response.data.id, threadId }, 'Reply draft created');

    return {
      draftId: response.data.id!,
      threadId,
      to: replyTo,
      subject: replySubject,
      bodyPreview: body.substring(0, 200),
    };
  }

  // ─── MIME Helpers ───

  private buildMimeMessage(draft: EmailDraft): string {
    const lines: string[] = [
      `To: ${draft.to}`,
      `Subject: ${draft.subject}`,
      'Content-Type: text/plain; charset=UTF-8',
    ];
    if (draft.cc) lines.push(`Cc: ${draft.cc}`);
    if (draft.bcc) lines.push(`Bcc: ${draft.bcc}`);
    lines.push('', draft.body);
    return lines.join('\r\n');
  }

  private buildReplyMimeMessage(
    draft: { to: string; subject: string; body: string },
    inReplyTo: string,
    references: string,
  ): string {
    return [
      `To: ${draft.to}`,
      `Subject: ${draft.subject}`,
      `In-Reply-To: ${inReplyTo}`,
      `References: ${references}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      draft.body,
    ].join('\r\n');
  }

  // ─── Date Formatting ───

  private formatDateForQuery(dateStr: string): string {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  }
}

export const emailService = EmailService.getInstance();
