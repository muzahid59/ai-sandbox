import request from 'supertest';

const TEST_SECRET = 'test-secret-memories';

const mockPrisma = {
  memory: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
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

const userId = 'user-uuid-1';

function makeToken() {
  return jwt.sign({ id: userId, email: 'test@example.com' }, TEST_SECRET, { expiresIn: '1h' });
}

function makeMemory(overrides = {}) {
  return {
    id: 'mem-1',
    userId,
    content: 'User is a backend engineer',
    source: 'manual',
    sourceThreadId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('GET /api/v1/memories', () => {
  it('returns 200 with memory array', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.memory.findMany.mockResolvedValue([makeMemory()]);

    const res = await request(app)
      .get('/api/v1/memories')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.memories).toHaveLength(1);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/memories');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/memories', () => {
  it('returns 201 with valid content', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.findMany.mockResolvedValue([]);
    mockPrisma.memory.create.mockResolvedValue(makeMemory());

    const res = await request(app)
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ content: 'User is a backend engineer' });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe('User is a backend engineer');
  });

  it('returns 400 with empty content', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ content: '' });

    expect(res.status).toBe(400);
  });

  it('returns 400 with content > 500 chars', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ content: 'a'.repeat(501) });

    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate memory', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.findMany.mockResolvedValue([{ content: 'User is a backend engineer' }]);

    const res = await request(app)
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ content: 'User is a backend engineer' });

    expect(res.status).toBe(409);
  });

  it('returns 422 at 200-memory cap', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.memory.count.mockResolvedValue(200);

    const res = await request(app)
      .post('/api/v1/memories')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ content: 'Some valid content here' });

    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/v1/memories/:id', () => {
  it('returns 200 with updated content', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.memory.findFirst.mockResolvedValue(makeMemory());
    mockPrisma.memory.findMany.mockResolvedValue([]);
    mockPrisma.memory.update.mockResolvedValue(makeMemory({ content: 'Updated content' }));

    const res = await request(app)
      .patch('/api/v1/memories/mem-1')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ content: 'Updated content' });

    expect(res.status).toBe(200);
    expect(res.body.content).toBe('Updated content');
  });

  it('returns 404 for another user\'s memory', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.memory.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/memories/other-mem')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ content: 'Updated content' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/memories/:id', () => {
  it('returns 204 on success', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.memory.findFirst.mockResolvedValue(makeMemory());
    mockPrisma.memory.delete.mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/v1/memories/mem-1')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(204);
  });

  it('returns 404 for another user\'s memory', async () => {
    const mockUser = { id: userId, email: 'test@example.com' };
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.memory.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/v1/memories/other-mem')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });
});
