import fs from 'fs';
import path from 'path';

const TOKEN_FILE = path.join(__dirname, '../../.gmail-tokens.json');

const mockOAuth2Instance = {
  setCredentials: jest.fn(),
  refreshAccessToken: jest.fn(),
  generateAuthUrl: jest.fn(),
  getToken: jest.fn(),
};

const mockGmailMessages = {
  list: jest.fn(),
  get: jest.fn(),
};

const mockGmailDrafts = {
  create: jest.fn(),
};

jest.mock('@googleapis/gmail', () => ({
  gmail: jest.fn(() => ({
    users: {
      messages: mockGmailMessages,
      drafts: mockGmailDrafts,
    },
  })),
}));

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => mockOAuth2Instance),
}));

import { emailService } from '../../src/services/emailService';
import { GmailTokenEntry } from '../../src/types/email';

const TEST_USER_ID = 'test-user-001';

function makeTokenEntry(overrides: Partial<GmailTokenEntry> = {}): GmailTokenEntry {
  return {
    accessToken: 'access-token-123',
    refreshToken: 'refresh-token-456',
    expiryDate: Date.now() + 3600_000,
    scopes: ['gmail.readonly', 'gmail.compose'],
    email: 'test@gmail.com',
    obtainedAt: new Date().toISOString(),
    ...overrides,
  };
}

function cleanupTokenFile() {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch { /* ignore */ }
}

describe('EmailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupTokenFile();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => {
    cleanupTokenFile();
  });

  // ─── Token CRUD ───

  describe('token CRUD', () => {
    it('returns null for non-existent user', () => {
      expect(emailService.getTokens('nonexistent')).toBeNull();
    });

    it('saves and retrieves tokens', () => {
      const entry = makeTokenEntry();
      emailService.saveTokens(TEST_USER_ID, entry);
      const retrieved = emailService.getTokens(TEST_USER_ID);
      expect(retrieved).toEqual(entry);
    });

    it('isConnected returns true after saving tokens', () => {
      emailService.saveTokens(TEST_USER_ID, makeTokenEntry());
      expect(emailService.isConnected(TEST_USER_ID)).toBe(true);
    });

    it('isConnected returns false for unknown user', () => {
      expect(emailService.isConnected('unknown')).toBe(false);
    });

    it('removes tokens', () => {
      emailService.saveTokens(TEST_USER_ID, makeTokenEntry());
      emailService.removeTokens(TEST_USER_ID);
      expect(emailService.getTokens(TEST_USER_ID)).toBeNull();
      expect(emailService.isConnected(TEST_USER_ID)).toBe(false);
    });

    it('handles multiple users independently', () => {
      const entry1 = makeTokenEntry({ email: 'user1@gmail.com' });
      const entry2 = makeTokenEntry({ email: 'user2@gmail.com' });
      emailService.saveTokens('user-1', entry1);
      emailService.saveTokens('user-2', entry2);
      expect(emailService.getTokens('user-1')?.email).toBe('user1@gmail.com');
      expect(emailService.getTokens('user-2')?.email).toBe('user2@gmail.com');
    });
  });

  // ─── Auth Client ───

  describe('getAuthClient', () => {
    it('throws when user has no tokens', async () => {
      await expect(emailService.getAuthClient('no-tokens-user'))
        .rejects.toThrow('Gmail not connected');
    });

    it('returns OAuth2 client with valid tokens', async () => {
      emailService.saveTokens(TEST_USER_ID, makeTokenEntry());
      const client = await emailService.getAuthClient(TEST_USER_ID);
      expect(client).toBe(mockOAuth2Instance);
      expect(mockOAuth2Instance.setCredentials).toHaveBeenCalled();
    });

    it('refreshes expired token', async () => {
      const expired = makeTokenEntry({ expiryDate: Date.now() - 1000 });
      emailService.saveTokens(TEST_USER_ID, expired);

      mockOAuth2Instance.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-access-token',
          expiry_date: Date.now() + 3600_000,
        },
      });

      await emailService.getAuthClient(TEST_USER_ID);

      expect(mockOAuth2Instance.refreshAccessToken).toHaveBeenCalled();
      const updated = emailService.getTokens(TEST_USER_ID);
      expect(updated?.accessToken).toBe('new-access-token');
    });

    it('removes tokens and throws on refresh failure', async () => {
      const expired = makeTokenEntry({ expiryDate: Date.now() - 1000 });
      emailService.saveTokens(TEST_USER_ID, expired);

      mockOAuth2Instance.refreshAccessToken.mockRejectedValue(new Error('Token revoked'));

      await expect(emailService.getAuthClient(TEST_USER_ID))
        .rejects.toThrow('Gmail not connected');
      expect(emailService.isConnected(TEST_USER_ID)).toBe(false);
    });
  });

  // ─── Email Parsing ───

  describe('parseEmail', () => {
    it('parses email with name and address in From header', () => {
      const msg = {
        id: 'msg-1',
        threadId: 'thread-1',
        snippet: 'Hello there...',
        labelIds: ['UNREAD', 'INBOX'],
        payload: {
          headers: [
            { name: 'From', value: 'John Doe <john@example.com>' },
            { name: 'To', value: 'me@example.com' },
            { name: 'Subject', value: 'Test Subject' },
            { name: 'Date', value: 'Thu, 12 Jul 2026 10:00:00 +0000' },
          ],
          parts: [],
        },
      };

      const result = emailService.parseEmail(msg);
      expect(result.id).toBe('msg-1');
      expect(result.threadId).toBe('thread-1');
      expect(result.from).toEqual({ name: 'John Doe', address: 'john@example.com' });
      expect(result.subject).toBe('Test Subject');
      expect(result.isUnread).toBe(true);
      expect(result.snippet).toBe('Hello there...');
    });

    it('parses email with address-only From header', () => {
      const msg = {
        id: 'msg-2',
        threadId: 'thread-2',
        snippet: '',
        labelIds: [],
        payload: {
          headers: [{ name: 'From', value: 'plain@example.com' }],
        },
      };
      const result = emailService.parseEmail(msg);
      expect(result.from).toEqual({ name: '', address: 'plain@example.com' });
      expect(result.isUnread).toBe(false);
    });
  });

  // ─── Body Extraction ───

  describe('extractBody', () => {
    it('extracts text/plain body', () => {
      const payload = {
        mimeType: 'text/plain',
        body: { data: Buffer.from('Hello world').toString('base64url') },
      };
      expect(emailService.extractBody(payload)).toBe('Hello world');
    });

    it('extracts from multipart preferring text/plain', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/plain',
            body: { data: Buffer.from('Plain text').toString('base64url') },
          },
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('<p>HTML text</p>').toString('base64url') },
          },
        ],
      };
      expect(emailService.extractBody(payload)).toBe('Plain text');
    });

    it('falls back to html-to-text conversion', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('<p>HTML only</p>').toString('base64url') },
          },
        ],
      };
      const result = emailService.extractBody(payload);
      expect(result).toContain('HTML only');
    });

    it('returns empty string for empty payload', () => {
      expect(emailService.extractBody(undefined)).toBe('');
    });
  });

  // ─── Truncation ───

  describe('truncateBody', () => {
    it('does not truncate short text', () => {
      expect(emailService.truncateBody('short text')).toBe('short text');
    });

    it('truncates and adds marker at limit', () => {
      const longText = 'A'.repeat(60_000);
      const result = emailService.truncateBody(longText);
      expect(result.endsWith('[truncated]')).toBe(true);
      expect(Buffer.from(result, 'utf-8').length).toBeLessThanOrEqual(50 * 1024 + 20);
    });
  });

  // ─── List Emails ───

  describe('listEmails', () => {
    beforeEach(() => {
      emailService.saveTokens(TEST_USER_ID, makeTokenEntry());
    });

    it('lists unread emails', async () => {
      mockGmailMessages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'msg-1' }],
          resultSizeEstimate: 1,
        },
      });
      mockGmailMessages.get.mockResolvedValue({
        data: {
          id: 'msg-1',
          threadId: 'thread-1',
          snippet: 'Test snippet',
          labelIds: ['UNREAD'],
          payload: {
            headers: [
              { name: 'From', value: 'sender@test.com' },
              { name: 'Subject', value: 'Test' },
              { name: 'Date', value: '2026-07-12' },
            ],
          },
        },
      });

      const result = await emailService.listEmails(TEST_USER_ID, 'unread', 10);
      expect(result.emails).toHaveLength(1);
      expect(result.emails[0].subject).toBe('Test');
      expect(result.emails[0].body).toBeUndefined();
    });

    it('returns empty result for no messages', async () => {
      mockGmailMessages.list.mockResolvedValue({
        data: { messages: [], resultSizeEstimate: 0 },
      });

      const result = await emailService.listEmails(TEST_USER_ID);
      expect(result.emails).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });
  });

  // ─── Search Emails ───

  describe('searchEmails', () => {
    beforeEach(() => {
      emailService.saveTokens(TEST_USER_ID, makeTokenEntry());
    });

    it('constructs query from search params', async () => {
      mockGmailMessages.list.mockResolvedValue({ data: { messages: [], resultSizeEstimate: 0 } });

      await emailService.searchEmails(TEST_USER_ID, {
        from: 'john@test.com',
        subject: 'report',
        hasAttachment: true,
      });

      const call = mockGmailMessages.list.mock.calls[0][0];
      expect(call.q).toContain('from:john@test.com');
      expect(call.q).toContain('subject:report');
      expect(call.q).toContain('has:attachment');
    });
  });

  // ─── Create Draft ───

  describe('createDraft', () => {
    beforeEach(() => {
      emailService.saveTokens(TEST_USER_ID, makeTokenEntry());
    });

    it('creates a draft and returns result', async () => {
      mockGmailDrafts.create.mockResolvedValue({
        data: {
          id: 'draft-1',
          message: { threadId: 'thread-1' },
        },
      });

      const result = await emailService.createDraft(TEST_USER_ID, {
        to: 'recipient@test.com',
        subject: 'Test Draft',
        body: 'Hello from the test',
      });

      expect(result.draftId).toBe('draft-1');
      expect(result.to).toBe('recipient@test.com');
      expect(result.subject).toBe('Test Draft');
    });
  });

  // ─── Create Reply Draft ───

  describe('createReplyDraft', () => {
    beforeEach(() => {
      emailService.saveTokens(TEST_USER_ID, makeTokenEntry());
    });

    it('creates a reply draft with threading headers', async () => {
      mockGmailMessages.get.mockResolvedValue({
        data: {
          id: 'original-msg',
          threadId: 'thread-1',
          payload: {
            headers: [
              { name: 'From', value: 'Original Sender <sender@test.com>' },
              { name: 'Subject', value: 'Original Subject' },
              { name: 'Message-ID', value: '<msg-id@test.com>' },
              { name: 'References', value: '<prev-msg@test.com>' },
            ],
          },
        },
      });

      mockGmailDrafts.create.mockResolvedValue({
        data: { id: 'reply-draft-1', message: { threadId: 'thread-1' } },
      });

      const result = await emailService.createReplyDraft(TEST_USER_ID, 'original-msg', 'Thanks!');

      expect(result.draftId).toBe('reply-draft-1');
      expect(result.threadId).toBe('thread-1');
      expect(result.to).toBe('sender@test.com');
      expect(result.subject).toBe('Re: Original Subject');

      const createCall = mockGmailDrafts.create.mock.calls[0][0];
      expect(createCall.requestBody.message.threadId).toBe('thread-1');
    });
  });

  // ─── Auth Required ───

  describe('buildAuthRequiredMessage', () => {
    it('returns a string containing the auth URL', () => {
      const message = emailService.buildAuthRequiredMessage();
      expect(message).toContain('http://localhost:5001/api/v1/auth/gmail');
    });

    it('starts with ACTION_REQUIRED prefix', () => {
      const message = emailService.buildAuthRequiredMessage();
      expect(message).toMatch(/^ACTION_REQUIRED:/);
    });

    it('instructs user to notify when done', () => {
      const message = emailService.buildAuthRequiredMessage();
      expect(message).toContain('let me know when you\'re done');
    });
  });

  describe('getAuthClient throws AuthRequiredError', () => {
    it('throws AuthRequiredError when user has no tokens', async () => {
      const { AuthRequiredError } = await import('../../src/services/emailService');
      await expect(emailService.getAuthClient('no-tokens-user'))
        .rejects.toThrow(AuthRequiredError);
    });

    it('throws AuthRequiredError when refresh fails and tokens are removed', async () => {
      const { AuthRequiredError } = await import('../../src/services/emailService');
      const expired = makeTokenEntry({ expiryDate: Date.now() - 1000 });
      emailService.saveTokens(TEST_USER_ID, expired);
      mockOAuth2Instance.refreshAccessToken.mockRejectedValue(new Error('Token revoked'));

      await expect(emailService.getAuthClient(TEST_USER_ID))
        .rejects.toThrow(AuthRequiredError);
    });
  });
});
