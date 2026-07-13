const mockOAuth2Instance = {
  generateAuthUrl: jest.fn(),
  getToken: jest.fn(),
  setCredentials: jest.fn(),
};

const mockGmailUsers = {
  getProfile: jest.fn(),
};

jest.mock('@googleapis/gmail', () => ({
  gmail: jest.fn(() => ({
    users: mockGmailUsers,
  })),
}));

jest.mock('@googleapis/calendar', () => ({
  calendar: jest.fn(),
}));

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => mockOAuth2Instance),
}));

import request from 'supertest';
import { app } from '../../src/server';
import { emailService } from '../../src/services/emailService';
import fs from 'fs';
import path from 'path';

const TOKEN_FILE = path.join(__dirname, '../../.gmail-tokens.json');

function cleanupTokenFile() {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch { /* ignore */ }
}

describe('Gmail Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupTokenFile();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => {
    cleanupTokenFile();
  });

  describe('GET /api/v1/auth/gmail', () => {
    it('redirects to Google consent URL', async () => {
      mockOAuth2Instance.generateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?test=1');

      const res = await request(app).get('/api/v1/auth/gmail');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('accounts.google.com');
    });
  });

  describe('GET /api/v1/auth/gmail/callback', () => {
    it('exchanges code for tokens and returns HTML confirmation', async () => {
      mockOAuth2Instance.getToken.mockResolvedValue({
        tokens: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expiry_date: Date.now() + 3600_000,
          scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
        },
      });
      mockGmailUsers.getProfile.mockResolvedValue({
        data: { emailAddress: 'user@gmail.com' },
      });

      const res = await request(app)
        .get('/api/v1/auth/gmail/callback')
        .query({ code: 'auth-code-123', state: 'user-id-1' });

      expect(res.status).toBe(200);
      expect(res.text).toContain('Gmail Connected');
      expect(emailService.isConnected('user-id-1')).toBe(true);
    });

    it('returns 400 when user denied access', async () => {
      const res = await request(app)
        .get('/api/v1/auth/gmail/callback')
        .query({ error: 'access_denied', state: 'user-id-1' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Authorization denied by user.');
    });

    it('returns 400 when code is missing', async () => {
      const res = await request(app)
        .get('/api/v1/auth/gmail/callback')
        .query({ state: 'user-id-1' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Missing authorization code.');
    });

    it('returns 500 when token exchange fails', async () => {
      mockOAuth2Instance.getToken.mockRejectedValue(new Error('Exchange failed'));

      const res = await request(app)
        .get('/api/v1/auth/gmail/callback')
        .query({ code: 'bad-code', state: 'user-id-1' });

      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Token exchange failed.');
    });
  });

  describe('GET /api/v1/auth/gmail/status', () => {
    it('returns connected: false when no tokens', async () => {
      const res = await request(app).get('/api/v1/auth/gmail/status');

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
      expect(res.body.authorizeUrl).toBe('/api/v1/auth/gmail');
    });

    it('returns connected: true with email and scopes', async () => {
      const userId = '00000000-0000-0000-0000-000000000001';
      emailService.saveTokens(userId, {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiryDate: Date.now() + 3600_000,
        scopes: ['gmail.readonly', 'gmail.compose'],
        email: 'user@gmail.com',
        obtainedAt: '2026-07-12T10:00:00Z',
      });

      const res = await request(app).get('/api/v1/auth/gmail/status');

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.email).toBe('user@gmail.com');
      expect(res.body.scopes).toEqual(['gmail.readonly', 'gmail.compose']);
    });
  });
});
