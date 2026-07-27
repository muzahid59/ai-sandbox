import request from 'supertest';

const TEST_SECRET = 'test-secret-routes';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
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

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = TEST_SECRET;
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  jest.clearAllMocks();
});

import { app } from '../../src/server';

const VALID_EMAIL = 'test@example.com';
const VALID_PASSWORD = 'password123';

const mockUser = {
  id: 'user-uuid-1',
  email: VALID_EMAIL,
  passwordHash: '$2a$12$fakehashfakehashfakehashfakehashfakehashe',
  displayName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRefreshRecord = {
  id: 'rt-1',
  token: 'valid-refresh-token',
  userId: mockUser.id,
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  revokedAt: null,
  createdAt: new Date(),
};

describe('POST /api/v1/auth/register', () => {
  it('returns 201 with accessToken and sets refreshToken cookie on valid input', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue(mockUser);
    mockPrisma.refreshToken.create.mockResolvedValue(mockRefreshRecord);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe(VALID_EMAIL);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'][0]).toContain('refreshToken=');
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
  });

  it('returns 400 on invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: VALID_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('returns 400 on password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: VALID_EMAIL, password: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: VALID_EMAIL, password: VALID_PASSWORD });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns 200 with accessToken on correct credentials', async () => {
    const bcrypt = require('bcryptjs');
    const realHash = await bcrypt.hash(VALID_PASSWORD, 12);
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, passwordHash: realHash });
    mockPrisma.refreshToken.create.mockResolvedValue(mockRefreshRecord);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('returns 401 with invalid_credentials on wrong password', async () => {
    const bcrypt = require('bcryptjs');
    const realHash = await bcrypt.hash(VALID_PASSWORD, 12);
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, passwordHash: realHash });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: VALID_EMAIL, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('invalid_credentials');
  });

  it('returns 401 with invalid_credentials on unknown email (same message)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'unknown@example.com', password: VALID_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('invalid_credentials');
    expect(res.body.error.message).toBe('Invalid email or password');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('returns 200 with new accessToken when cookie is valid', async () => {
    mockPrisma.refreshToken.findFirst.mockResolvedValue(mockRefreshRecord);
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refreshToken=valid-refresh-token');

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('returns 401 when no cookie is present', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is not found (revoked or expired)', async () => {
    mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refreshToken=bad-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('returns 200 and clears the cookie', async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refreshToken=some-token');
    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);
    expect(res.headers['set-cookie'][0]).toContain('refreshToken=;');
  });

  it('returns 200 even when no cookie is present (fail-open)', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);
  });
});
