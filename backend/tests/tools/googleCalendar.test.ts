jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn(() => ({ setCredentials: jest.fn(), refreshAccessToken: jest.fn() })) },
    calendar: jest.fn(() => ({
      events: { list: jest.fn() },
      freebusy: { query: jest.fn() },
    })),
  },
}));

jest.mock('../../src/services/googleAuthService', () => ({
  googleAuthService: {
    getAuthClient: jest.fn(),
    hasScope: jest.fn().mockResolvedValue(undefined),
  },
}));

import { googleCalendar } from '../../src/tools/googleCalendar';

describe('google_calendar tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('has correct definition', () => {
    expect(googleCalendar.definition.name).toBe('google_calendar');
    expect(googleCalendar.timeoutMs).toBe(10000);
  });

  it('validates required action field', () => {
    const result = googleCalendar.schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts valid list input', () => {
    const result = googleCalendar.schema.safeParse({ action: 'list' });
    expect(result.success).toBe(true);
  });

  it('throws ToolError when no userId in context', async () => {
    await expect(
      googleCalendar.run({ action: 'list' })
    ).rejects.toMatchObject({ name: 'ToolError' });
  });
});
