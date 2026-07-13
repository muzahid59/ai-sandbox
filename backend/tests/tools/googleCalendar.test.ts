jest.mock('@googleapis/gmail', () => ({
  gmail: jest.fn(() => ({
    users: {
      messages: { list: jest.fn(), get: jest.fn() },
      drafts: { create: jest.fn() },
    },
  })),
}));

jest.mock('@googleapis/calendar', () => ({
  calendar: jest.fn(() => ({
    events: { list: jest.fn() },
    freebusy: { query: jest.fn() },
  })),
}));

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => ({ setCredentials: jest.fn(), refreshAccessToken: jest.fn() })),
}));

import fs from 'fs';
import path from 'path';
import { googleCalendar } from '../../src/tools/googleCalendar';

const TOKEN_FILE = path.join(__dirname, '../../.gmail-tokens.json');

function cleanupTokenFile() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

describe('google_calendar tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupTokenFile();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => cleanupTokenFile());

  it('has correct definition', () => {
    expect(googleCalendar.definition.name).toBe('google_calendar');
    expect(googleCalendar.timeoutMs).toBe(10000);
  });

  it('returns auth required message when not connected', async () => {
    const result = await googleCalendar.run({ action: 'list' });
    expect(result).toContain('ACTION_REQUIRED');
    expect(result).toContain('http://localhost:5001/api/v1/auth/gmail');
  });
});
