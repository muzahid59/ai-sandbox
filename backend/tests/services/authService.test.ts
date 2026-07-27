const mockPrisma = {
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

import * as authService from '../../src/services/authService';

const TEST_SECRET = 'test-secret-for-unit-tests-only';

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = TEST_SECRET;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('hashPassword / verifyPassword', () => {
  it('produces a hash that verifyPassword accepts', async () => {
    const hash = await authService.hashPassword('MySecret1!');
    const valid = await authService.verifyPassword('MySecret1!', hash);
    expect(valid).toBe(true);
  });

  it('verifyPassword returns false for wrong password', async () => {
    const hash = await authService.hashPassword('correct');
    const valid = await authService.verifyPassword('wrong', hash);
    expect(valid).toBe(false);
  });
});

describe('generateAccessToken / verifyAccessToken', () => {
  it('generates a token that decodes to the correct payload', () => {
    const token = authService.generateAccessToken('user-123', 'test@example.com');
    const payload = authService.verifyAccessToken(token);
    expect(payload.id).toBe('user-123');
    expect(payload.email).toBe('test@example.com');
  });

  it('throws on a tampered token', () => {
    const token = authService.generateAccessToken('user-123', 'test@example.com');
    const tampered = token.slice(0, -4) + 'xxxx';
    expect(() => authService.verifyAccessToken(tampered)).toThrow();
  });

  it('throws when JWT_ACCESS_SECRET is not set', () => {
    const saved = process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_ACCESS_SECRET;
    expect(() => authService.generateAccessToken('u', 'e@e.com')).toThrow('JWT_ACCESS_SECRET env var is required');
    process.env.JWT_ACCESS_SECRET = saved;
  });
});

describe('generateRefreshToken', () => {
  it('returns a 64-character hex string', () => {
    const token = authService.generateRefreshToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it('generates unique tokens', () => {
    const a = authService.generateRefreshToken();
    const b = authService.generateRefreshToken();
    expect(a).not.toBe(b);
  });
});

describe('createRefreshTokenRecord', () => {
  it('calls prisma.refreshToken.create with correct expiresAt (~30 days)', async () => {
    const mockRecord = { id: 'rec-1', token: 'abc', userId: 'u-1', expiresAt: new Date(), revokedAt: null, createdAt: new Date() };
    mockPrisma.refreshToken.create.mockResolvedValue(mockRecord);

    const before = new Date();
    await authService.createRefreshTokenRecord('u-1', 'abc');
    const after = new Date();

    const call = mockPrisma.refreshToken.create.mock.calls[0][0];
    const expiresAt: Date = call.data.expiresAt;
    const diffDays = (expiresAt.getTime() - before.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(29.9);
    expect(diffDays).toBeLessThanOrEqual(30.1);
  });
});

describe('findValidRefreshToken', () => {
  it('returns the record when valid', async () => {
    const record = { id: 'r1', token: 'tok', userId: 'u', expiresAt: new Date(), revokedAt: null, createdAt: new Date() };
    mockPrisma.refreshToken.findFirst.mockResolvedValue(record);
    const result = await authService.findValidRefreshToken('tok');
    expect(result).toBe(record);
  });

  it('returns null when not found (revoked or expired)', async () => {
    mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
    const result = await authService.findValidRefreshToken('revoked-token');
    expect(result).toBeNull();
  });
});

describe('revokeRefreshToken', () => {
  it('calls prisma.refreshToken.updateMany with revokedAt', async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    await authService.revokeRefreshToken('some-token');
    const call = mockPrisma.refreshToken.updateMany.mock.calls[0][0];
    expect(call.where.token).toBe('some-token');
    expect(call.data.revokedAt).toBeInstanceOf(Date);
  });
});
