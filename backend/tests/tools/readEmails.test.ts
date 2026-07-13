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
import { readEmails } from '../../src/tools/readEmails';
import { searchEmails } from '../../src/tools/searchEmails';
import { emailService } from '../../src/services/emailService';

const TOKEN_FILE = path.join(__dirname, '../../.gmail-tokens.json');
const USER_ID = '00000000-0000-0000-0000-000000000001';

function cleanupTokenFile() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

describe('read_emails tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupTokenFile();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => cleanupTokenFile());

  it('has correct definition', () => {
    expect(readEmails.definition.name).toBe('read_emails');
    expect(readEmails.timeoutMs).toBe(15000);
  });

  it('validates schema with defaults', () => {
    const result = readEmails.schema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filter).toBe('unread');
      expect(result.data.maxResults).toBe(20);
      expect(result.data.includeBody).toBe(false);
    }
  });

  it('rejects invalid maxResults', () => {
    const result = readEmails.schema.safeParse({ maxResults: 100 });
    expect(result.success).toBe(false);
  });

  it('throws when Gmail not connected', async () => {
    await expect(readEmails.run({ filter: 'unread', maxResults: 10, includeBody: false }))
      .rejects.toThrow('Gmail not connected');
  });
});

describe('search_emails tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupTokenFile();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => cleanupTokenFile());

  it('has correct definition', () => {
    expect(searchEmails.definition.name).toBe('search_emails');
    expect(searchEmails.timeoutMs).toBe(15000);
  });

  it('validates schema with defaults', () => {
    const result = searchEmails.schema.safeParse({ from: 'test@example.com' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxResults).toBe(20);
      expect(result.data.includeBody).toBe(false);
    }
  });

  it('throws when Gmail not connected', async () => {
    await expect(searchEmails.run({
      maxResults: 10,
      includeBody: false,
      from: 'test@example.com',
    })).rejects.toThrow('Gmail not connected');
  });
});
