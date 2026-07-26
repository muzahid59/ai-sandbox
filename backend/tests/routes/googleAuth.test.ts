import request from 'supertest';

jest.mock('../../src/services/googleAuthService', () => ({
  googleAuthService: {
    buildAuthorizeUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?scope=gmail'),
    handleCallback: jest.fn().mockResolvedValue(undefined),
    getConnectionStatus: jest.fn(),
    isConnected: jest.fn(),
    revokeTokens: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: {
    thread: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    message: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    googleOAuthToken: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('../../src/services/toolRegistry', () => ({
  toolRegistry: {
    getDefinitions: jest.fn().mockReturnValue([]),
    register: jest.fn(),
  },
}));

jest.mock('../../src/providers', () => ({
  registerProviders: jest.fn(),
}));

jest.mock('../../src/tools', () => ({
  registerAllTools: jest.fn(),
}));

const { googleAuthService } = require('../../src/services/googleAuthService');

describe('Google Auth Routes', () => {
  let app: any;

  beforeAll(async () => {
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    const mod = await import('../../src/server');
    app = mod.app;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/auth/google', () => {
    it('redirects to Google OAuth URL', async () => {
      const res = await request(app).get('/api/v1/auth/google');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('accounts.google.com');
    });

    it('returns 500 when buildAuthorizeUrl throws', async () => {
      googleAuthService.buildAuthorizeUrl.mockImplementationOnce(() => {
        throw new Error('GOOGLE_CLIENT_ID missing');
      });
      const res = await request(app).get('/api/v1/auth/google');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/v1/auth/google/callback', () => {
    it('redirects to frontend with google=connected on success', async () => {
      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .query({ code: 'valid-code', state: 'user-id' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('google=connected');
    });

    it('redirects with error param when access_denied', async () => {
      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .query({ error: 'access_denied', state: 'user-id' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('google=error');
    });

    it('returns 400 when code is missing', async () => {
      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .query({ state: 'user-id' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when state is missing', async () => {
      const res = await request(app)
        .get('/api/v1/auth/google/callback')
        .query({ code: 'valid-code' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/auth/google/status', () => {
    it('returns connected status with email and scopes', async () => {
      googleAuthService.getConnectionStatus.mockResolvedValueOnce({
        connected: true,
        email: 'user@gmail.com',
        scopes: ['gmail.readonly'],
        connectedAt: '2026-01-01T00:00:00.000Z',
      });

      const res = await request(app).get('/api/v1/auth/google/status');
      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.email).toBe('user@gmail.com');
    });

    it('returns authorizeUrl when not connected', async () => {
      googleAuthService.getConnectionStatus.mockResolvedValueOnce({
        connected: false,
        authorizeUrl: 'https://accounts.google.com/o/oauth2/auth',
      });

      const res = await request(app).get('/api/v1/auth/google/status');
      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
      expect(res.body.authorizeUrl).toBeDefined();
    });
  });

  describe('DELETE /api/v1/auth/google', () => {
    it('returns disconnected true on success', async () => {
      googleAuthService.isConnected.mockResolvedValueOnce(true);
      const res = await request(app).delete('/api/v1/auth/google');
      expect(res.status).toBe(200);
      expect(res.body.disconnected).toBe(true);
    });

    it('returns 404 when not connected', async () => {
      googleAuthService.isConnected.mockResolvedValueOnce(false);
      const res = await request(app).delete('/api/v1/auth/google');
      expect(res.status).toBe(404);
    });
  });
});
