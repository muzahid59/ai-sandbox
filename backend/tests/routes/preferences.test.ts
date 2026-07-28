import request from 'supertest';

const TEST_SECRET = 'test-secret-preferences';

const mockPrisma = {
  userPreferences: {
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    findFirst: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../src/services/toolRegistry', () => ({
  toolRegistry: { getDefinitions: jest.fn().mockReturnValue([]), register: jest.fn() },
}));

jest.mock('../../src/providers', () => ({
  registerProviders: jest.fn(),
}));

jest.mock('../../src/tools', () => ({
  registerAllTools: jest.fn(),
}));

jest.mock('../../src/services/contextService', () => ({
  contextService: { estimateTokens: (t: string) => Math.ceil(t.length / 4) },
}));

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = TEST_SECRET;
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  jest.clearAllMocks();
});

import { app } from '../../src/server';
import jwt from 'jsonwebtoken';

const userId = 'user-pref-1';

function makeToken() {
  return jwt.sign({ id: userId, email: 'pref@example.com' }, TEST_SECRET, { expiresIn: '1h' });
}

function makePrefs(overrides = {}) {
  return {
    id: 'pref-1',
    userId,
    defaultModel: null,
    customInstructions: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    displayName: null,
    ...overrides,
  };
}

describe('GET /api/v1/preferences', () => {
  it('returns 200 with preferences object', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, email: 'pref@example.com' });
    mockPrisma.userPreferences.findUniqueOrThrow.mockResolvedValue(makePrefs());
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: userId, displayName: null });

    const res = await request(app)
      .get('/api/v1/preferences')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('defaultModel');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/preferences');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/v1/preferences', () => {
  it('returns 200 with valid partial update', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, email: 'pref@example.com' });
    mockPrisma.userPreferences.update.mockResolvedValue(makePrefs({ defaultModel: 'google' }));
    mockPrisma.userPreferences.findUniqueOrThrow.mockResolvedValue(makePrefs({ defaultModel: 'google' }));
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: userId, displayName: null });

    const res = await request(app)
      .patch('/api/v1/preferences')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ defaultModel: 'google' });

    expect(res.status).toBe(200);
  });

  it('returns 400 with invalid defaultModel value', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, email: 'pref@example.com' });

    const res = await request(app)
      .patch('/api/v1/preferences')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ defaultModel: 'anthropic' });

    expect(res.status).toBe(400);
  });

  it('returns 400 with customInstructions > 2000 chars', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, email: 'pref@example.com' });

    const res = await request(app)
      .patch('/api/v1/preferences')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ customInstructions: 'a'.repeat(2001) });

    expect(res.status).toBe(400);
  });

  it('returns 200 when clearing customInstructions with null', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, email: 'pref@example.com' });
    mockPrisma.userPreferences.update.mockResolvedValue(makePrefs());
    mockPrisma.userPreferences.findUniqueOrThrow.mockResolvedValue(makePrefs());
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: userId, displayName: null });

    const res = await request(app)
      .patch('/api/v1/preferences')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ customInstructions: null });

    expect(res.status).toBe(200);
  });
});
