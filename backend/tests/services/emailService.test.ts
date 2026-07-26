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

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn(() => mockOAuth2Instance),
    },
    gmail: jest.fn(() => ({
      users: {
        messages: mockGmailMessages,
        drafts: mockGmailDrafts,
      },
    })),
  },
}));

jest.mock('../../src/services/googleAuthService', () => ({
  googleAuthService: {
    getAuthClient: jest.fn().mockResolvedValue(mockOAuth2Instance),
  },
}));

import { emailService } from '../../src/services/emailService';

describe('EmailService — parseEmail', () => {
  it('parses basic email headers', () => {
    const mockMessage = {
      id: 'msg-1',
      threadId: 'thread-1',
      snippet: 'Hello world',
      labelIds: ['UNREAD', 'INBOX'],
      payload: {
        headers: [
          { name: 'From', value: 'Alice <alice@example.com>' },
          { name: 'To', value: 'bob@example.com' },
          { name: 'Subject', value: 'Test Subject' },
          { name: 'Date', value: 'Mon, 1 Jan 2026 00:00:00 +0000' },
        ],
      },
    };

    const result = emailService.parseEmail(mockMessage as any);
    expect(result.id).toBe('msg-1');
    expect(result.from.name).toBe('Alice');
    expect(result.from.address).toBe('alice@example.com');
    expect(result.subject).toBe('Test Subject');
    expect(result.isUnread).toBe(true);
  });

  it('handles sender without display name', () => {
    const mockMessage = {
      id: 'msg-2',
      threadId: 'thread-2',
      snippet: 'Hello',
      labelIds: [],
      payload: {
        headers: [
          { name: 'From', value: 'plain@example.com' },
          { name: 'To', value: 'to@example.com' },
          { name: 'Subject', value: 'Hi' },
          { name: 'Date', value: 'Mon, 1 Jan 2026 00:00:00 +0000' },
        ],
      },
    };

    const result = emailService.parseEmail(mockMessage as any);
    expect(result.from.name).toBe('');
    expect(result.from.address).toBe('plain@example.com');
  });
});

describe('EmailService — truncateBody', () => {
  it('returns text unchanged when under limit', () => {
    const text = 'short text';
    expect(emailService.truncateBody(text)).toBe(text);
  });

  it('truncates text that exceeds maxBytes', () => {
    const longText = 'a'.repeat(100 * 1024);
    const result = emailService.truncateBody(longText, 50 * 1024);
    expect(result.endsWith('[truncated]')).toBe(true);
    expect(Buffer.from(result).length).toBeLessThanOrEqual(50 * 1024 + 20);
  });
});

describe('EmailService — extractBody', () => {
  it('extracts text/plain content', () => {
    const payload = {
      mimeType: 'text/plain',
      body: { data: Buffer.from('Hello world').toString('base64url') },
    };
    expect(emailService.extractBody(payload as any)).toBe('Hello world');
  });

  it('returns empty string for empty payload', () => {
    expect(emailService.extractBody(undefined)).toBe('');
  });
});
