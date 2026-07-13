jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn(), refreshAccessToken: jest.fn() })) },
    gmail: jest.fn(() => ({
      users: {
        messages: { list: jest.fn(), get: jest.fn() },
        drafts: { create: jest.fn() },
      },
    })),
  },
}));

import fs from 'fs';
import path from 'path';
import { summarizeEmails } from '../../src/tools/summarizeEmails';
import { draftEmail } from '../../src/tools/draftEmail';
import { replyEmail } from '../../src/tools/replyEmail';

const TOKEN_FILE = path.join(__dirname, '../../.gmail-tokens.json');

function cleanupTokenFile() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

describe('summarize_emails tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupTokenFile();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => cleanupTokenFile());

  it('has correct definition', () => {
    expect(summarizeEmails.definition.name).toBe('summarize_emails');
    expect(summarizeEmails.timeoutMs).toBe(30000);
  });

  it('validates schema defaults', () => {
    const result = summarizeEmails.schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filter).toBe('unread');
      expect(result.data.maxResults).toBe(50);
    }
  });

  it('throws when Gmail not connected', async () => {
    await expect(summarizeEmails.run({ filter: 'unread', maxResults: 50 }))
      .rejects.toThrow('Gmail not connected');
  });
});

describe('draft_email tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupTokenFile();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => cleanupTokenFile());

  it('has correct definition', () => {
    expect(draftEmail.definition.name).toBe('draft_email');
    expect(draftEmail.timeoutMs).toBe(10000);
  });

  it('validates required fields', () => {
    const result = draftEmail.schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('validates email format for "to" field', () => {
    const result = draftEmail.schema.safeParse({
      to: 'not-an-email',
      subject: 'Test',
      body: 'Test body',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid draft input', () => {
    const result = draftEmail.schema.safeParse({
      to: 'valid@example.com',
      subject: 'Test Subject',
      body: 'Hello there',
      cc: 'cc@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('throws when Gmail not connected', async () => {
    await expect(draftEmail.run({
      to: 'test@example.com',
      subject: 'Test',
      body: 'Hello',
    })).rejects.toThrow('Gmail not connected');
  });
});

describe('reply_email tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupTokenFile();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => cleanupTokenFile());

  it('has correct definition', () => {
    expect(replyEmail.definition.name).toBe('reply_email');
    expect(replyEmail.timeoutMs).toBe(10000);
  });

  it('validates required fields', () => {
    const result = replyEmail.schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty emailId', () => {
    const result = replyEmail.schema.safeParse({ emailId: '', body: 'Reply text' });
    expect(result.success).toBe(false);
  });

  it('accepts valid reply input', () => {
    const result = replyEmail.schema.safeParse({
      emailId: 'msg-123',
      body: 'Thanks for your message!',
    });
    expect(result.success).toBe(true);
  });

  it('throws when Gmail not connected', async () => {
    await expect(replyEmail.run({ emailId: 'msg-123', body: 'Reply' }))
      .rejects.toThrow('Gmail not connected');
  });
});
