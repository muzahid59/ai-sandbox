export interface GmailTokenStore {
  [userId: string]: GmailTokenEntry;
}

export interface GmailTokenEntry {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scopes: string[];
  email: string;
  obtainedAt: string;
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: {
    name: string;
    address: string;
  };
  to: string[];
  subject: string;
  date: string;
  snippet: string;
  isUnread: boolean;
  hasAttachments: boolean;
  attachments?: AttachmentMeta[];
  labels?: string[];
  body?: string;
}

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}

export interface ReplyDraft {
  emailId: string;
  body: string;
}

export interface DraftResult {
  draftId: string;
  threadId: string;
  to: string;
  subject: string;
  bodyPreview: string;
}

export interface EmailListResult {
  emails: EmailSummary[];
  totalCount: number;
  returnedCount: number;
}
