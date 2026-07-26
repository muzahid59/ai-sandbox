import { encrypt, decrypt, getEncryptionKey } from '../../src/services/googleAuthService';

const VALID_KEY = 'a'.repeat(64);

describe('GoogleAuthService — encryption helpers', () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it('encrypt → decrypt roundtrip equals original', () => {
    const original = 'my-secret-access-token';
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it('two encryptions of the same plaintext produce different ciphertexts (random IV)', () => {
    const original = 'same-token';
    const a = encrypt(original);
    const b = encrypt(original);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(original);
    expect(decrypt(b)).toBe(original);
  });

  it('encrypted value has iv:ciphertext:authTag format', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0));
  });
});

describe('GoogleAuthService — getEncryptionKey', () => {
  it('throws when TOKEN_ENCRYPTION_KEY is missing', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => getEncryptionKey()).toThrow('TOKEN_ENCRYPTION_KEY');
  });

  it('throws when TOKEN_ENCRYPTION_KEY is not 64 chars', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'tooshort';
    expect(() => getEncryptionKey()).toThrow('TOKEN_ENCRYPTION_KEY');
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it('returns a 32-byte Buffer when key is valid', () => {
    process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const key = getEncryptionKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });
});

describe('GoogleAuthService — DB operations', () => {
  const mockUpsert = jest.fn().mockResolvedValue({});
  const mockFindUnique = jest.fn();
  const mockDeleteMany = jest.fn().mockResolvedValue({});

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../src/config/database', () => ({
      __esModule: true,
      default: {
        googleOAuthToken: {
          upsert: mockUpsert,
          findUnique: mockFindUnique,
          deleteMany: mockDeleteMany,
        },
        user: {},
      },
    }));
    process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('saveTokens writes ciphertext (not plaintext) to DB', async () => {
    const { googleAuthService } = await import('../../src/services/googleAuthService');
    const plainAccessToken = 'plain-access-token';
    const plainRefreshToken = 'plain-refresh-token';

    await googleAuthService.saveTokens(
      'user-1',
      {
        access_token: plainAccessToken,
        refresh_token: plainRefreshToken,
        expiry_date: Date.now() + 3600 * 1000,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      },
      'user@gmail.com',
    );

    expect(mockUpsert).toHaveBeenCalled();
    const call = mockUpsert.mock.calls[0][0];
    expect(call.create.accessToken).not.toBe(plainAccessToken);
    expect(call.create.refreshToken).not.toBe(plainRefreshToken);
    expect(call.create.googleEmail).toBe('user@gmail.com');
  });

  it('getTokens returns null for unknown userId', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const { googleAuthService } = await import('../../src/services/googleAuthService');
    const result = await googleAuthService.getTokens('unknown-user');
    expect(result).toBeNull();
  });

  it('getTokens decrypts tokens correctly', async () => {
    const plainAccess = 'access-token-value';
    const plainRefresh = 'refresh-token-value';
    const encryptedAccess = encrypt(plainAccess);
    const encryptedRefresh = encrypt(plainRefresh);

    mockFindUnique.mockResolvedValueOnce({
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      expiryTimestamp: new Date(Date.now() + 3600 * 1000),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      googleEmail: 'user@gmail.com',
    });

    const { googleAuthService } = await import('../../src/services/googleAuthService');
    const tokens = await googleAuthService.getTokens('user-1');
    expect(tokens).not.toBeNull();
    expect(tokens!.accessToken).toBe(plainAccess);
    expect(tokens!.refreshToken).toBe(plainRefresh);
  });

  it('isConnected returns false when no record exists', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const { googleAuthService } = await import('../../src/services/googleAuthService');
    const result = await googleAuthService.isConnected('unknown-user');
    expect(result).toBe(false);
  });

  it('getConnectionStatus returns authorizeUrl when not connected', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const { googleAuthService } = await import('../../src/services/googleAuthService');
    const status = await googleAuthService.getConnectionStatus('user-1');
    expect(status.connected).toBe(false);
    if (!status.connected) {
      expect(status.authorizeUrl).toContain('accounts.google.com');
    }
  });

  it('buildAuthorizeUrl includes all three required scopes', async () => {
    const { googleAuthService } = await import('../../src/services/googleAuthService');
    const url = googleAuthService.buildAuthorizeUrl('user-1');
    expect(url).toContain('gmail.readonly');
    expect(url).toContain('gmail.compose');
    expect(url).toContain('calendar.readonly');
  });
});

describe('GoogleAuthService — getAuthClient auto-refresh', () => {
  const mockFindUnique = jest.fn();
  const mockUpsert = jest.fn().mockResolvedValue({});
  const mockDeleteMany = jest.fn().mockResolvedValue({});

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../src/config/database', () => ({
      __esModule: true,
      default: {
        googleOAuthToken: {
          upsert: mockUpsert,
          findUnique: mockFindUnique,
          deleteMany: mockDeleteMany,
        },
      },
    }));
    process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('throws ToolError when no token record exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { googleAuthService } = await import('../../src/services/googleAuthService');
    await expect(googleAuthService.getAuthClient('no-user')).rejects.toMatchObject({
      name: 'ToolError',
    });
  });
});
