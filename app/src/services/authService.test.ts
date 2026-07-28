import {
  setAccessToken,
  getAccessToken,
  refreshAccessToken,
  tryRestoreSession,
  login,
  register,
  logout,
  fetchWithAuth,
  AuthExpiredError,
} from './authService';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
  setAccessToken(null);
});

describe('getAccessToken / setAccessToken', () => {
  it('starts null and can be set', () => {
    expect(getAccessToken()).toBeNull();
    setAccessToken('my-token');
    expect(getAccessToken()).toBe('my-token');
  });
});

function makeJwt(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

describe('tryRestoreSession', () => {
  it('returns user when refresh succeeds', async () => {
    const token = makeJwt({ id: 'u-1', email: 'a@b.com' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: token }),
    });

    const user = await tryRestoreSession();
    expect(user).toEqual({ id: 'u-1', email: 'a@b.com' });
    expect(getAccessToken()).toBe(token);
  });

  it('returns null when refresh fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const user = await tryRestoreSession();
    expect(user).toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});

describe('login', () => {
  it('stores access token and returns user on success', async () => {
    const token = makeJwt({ id: 'u-2', email: 'login@test.com' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: token, user: { id: 'u-2', email: 'login@test.com' } }),
    });

    const user = await login('login@test.com', 'password123');
    expect(user).toEqual({ id: 'u-2', email: 'login@test.com' });
    expect(getAccessToken()).toBe(token);
  });

  it('throws with server error message on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: 'Invalid email or password' } }),
    });

    await expect(login('x@y.com', 'badpass')).rejects.toThrow('Invalid email or password');
  });
});

describe('register', () => {
  it('stores access token and returns user on success', async () => {
    const token = makeJwt({ id: 'u-3', email: 'reg@test.com' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: token, user: { id: 'u-3', email: 'reg@test.com' } }),
    });

    const user = await register('reg@test.com', 'password123');
    expect(user).toEqual({ id: 'u-3', email: 'reg@test.com' });
    expect(getAccessToken()).toBe(token);
  });
});

describe('logout', () => {
  it('clears access token even if server returns error', async () => {
    setAccessToken('existing-token');
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await logout();
    expect(getAccessToken()).toBeNull();
  });
});

describe('fetchWithAuth', () => {
  it('adds Authorization header when token is present', async () => {
    setAccessToken('my-access-token');
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true });

    await fetchWithAuth('http://api/test');

    const call = mockFetch.mock.calls[0];
    expect(call[1].headers.get('Authorization')).toBe('Bearer my-access-token');
  });

  it('calls refreshAccessToken on 401 and retries with new token', async () => {
    setAccessToken('expired-token');
    const newToken = makeJwt({ id: 'u-1', email: 'a@b.com' });

    mockFetch
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: newToken }),
      })
      .mockResolvedValueOnce({ status: 200, ok: true });

    const res = await fetchWithAuth('http://api/protected');
    expect(res.status).toBe(200);
    const retryCall = mockFetch.mock.calls[2];
    expect(retryCall[1].headers.get('Authorization')).toBe(`Bearer ${newToken}`);
  });

  it('throws AuthExpiredError when refresh fails after 401', async () => {
    setAccessToken('expired-token');

    mockFetch
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ ok: false });

    await expect(fetchWithAuth('http://api/protected')).rejects.toThrow(AuthExpiredError);
  });

  it('concurrent calls to refreshAccessToken only make one fetch', async () => {
    setAccessToken('expired-token');
    const newToken = makeJwt({ id: 'u-1', email: 'a@b.com' });

    mockFetch
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: newToken }),
      })
      .mockResolvedValueOnce({ status: 200, ok: true })
      .mockResolvedValueOnce({ status: 200, ok: true });

    await Promise.all([fetchWithAuth('http://api/a'), fetchWithAuth('http://api/b')]);

    const refreshCalls = mockFetch.mock.calls.filter((c) =>
      (c[0] as string).includes('/auth/refresh')
    );
    expect(refreshCalls).toHaveLength(1);
  });
});
