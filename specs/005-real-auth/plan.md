# Implementation Plan: Real JWT Authentication

**Feature Branch**: `005-real-auth`
**Spec**: `specs/005-real-auth/spec.md`
**Status**: Ready for implementation

## Technical Context

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js + Express (ts-node) |
| Database | PostgreSQL + Prisma — `User` model modified, `RefreshToken` model added |
| Auth library | `jsonwebtoken` (HS256, access tokens only) |
| Password hashing | `bcryptjs`, cost factor 12 (pure JS, no native bindings) |
| Refresh token | Opaque hex string stored in `refresh_tokens` table; delivered via httpOnly cookie |
| Cookie parsing | `cookie-parser` middleware (new) |
| CORS | Updated to `credentials: true` + explicit `origin` (required for cookies) |
| Frontend routing | React Router v7 (already installed) — `<RequireAuth>` wrapper pattern |
| Frontend token storage | Access token: module-level variable; Refresh token: httpOnly cookie (not JS-accessible) |
| New env vars | `JWT_ACCESS_SECRET` |
| New npm deps (backend) | `jsonwebtoken`, `bcryptjs`, `cookie-parser` + their `@types` packages |
| New npm deps (frontend) | None |

## Constitution Check

### I. Code Quality (NON-NEGOTIABLE)

- **TypeScript**: All new code in `backend/src/`. New `authService.ts`, `authRoutes.ts`, and updated `auth.ts` middleware. No JS files added. ✅
- **Single responsibility**: `authService` owns password hashing, JWT operations, and refresh token CRUD. `authRoutes` handles HTTP concerns only. Updated middleware only reads and validates the JWT. ✅
- **Structured logging**: All auth operations use `logger.child({ service: 'auth' })`. No `console.log`. ✅
- **Dead code**: Hardcoded `HARDCODED_USER` constant removed; the stub auth test replaced entirely. ✅
- **Linting**: `npm run lint` must pass in both `backend/` and `app/` before PR. ✅
- **Function size**: Each method in `authService` (hashPassword, verifyPassword, generateAccessToken, etc.) stays well under 50 lines. ✅

### II. Testing Standards

- **Unit tests**: `authService.ts` — all methods covered: password hashing/verification, token generation/verification, refresh token CRUD, expiry logic. ✅
- **Integration tests**: All 4 auth endpoints via supertest with real request/response validation. ✅
- **Auth middleware test**: Updated to test real JWT verification (valid token → 200, missing token → 401, expired token → 401, tampered token → 401). ✅
- **Deterministic**: All tests mock Prisma (`jest.mock('../config/database')`). No real DB. No real token delays. ✅
- **SSE streaming**: Existing SSE tests must remain green — auth wraps the route but does not change SSE behavior. ✅
- **Coverage**: 80% line minimum. Auth paths (token verification, error cases) must have 100% branch coverage. ✅

### III. User Experience Consistency

- **Loading state**: App shows a loading screen during the initial silent refresh attempt. No flash of protected content. ✅
- **Login/Register forms**: Client-side validation before submission (no round-trips for obvious errors). ✅
- **Error messages**: Non-technical; "Invalid email or password" not "bcrypt comparison failed". No stack traces in UI. ✅
- **CSS Modules**: LoginPage and RegisterPage use `.module.css` files. No global styles added. ✅
- **Prop drilling**: Auth state (`user`, `isLoading`) lives in `App.tsx` and flows down. No new state management layer. ✅
- **Redirect flow**: After login/register → redirect to `/` (chat UI). On 401 + failed refresh → redirect to `/login`. ✅

### IV. Performance Requirements

- **DB indexes**: `refresh_tokens` has `@@index([token])` and `@@index([userId])` — token lookup is O(log n). ✅
- **bcrypt latency**: Cost 12 adds ~100ms per hash — acceptable for login/register, never on hot paths. ✅
- **No bundle size impact**: No new frontend dependencies. LoginPage and RegisterPage are lightweight form components. ✅
- **Silent refresh**: `POST /auth/refresh` is a single DB lookup + JWT sign — well within 200ms budget. ✅

### Quality Gates

- Lint Gate: `npm run lint` (backend + frontend) — zero errors. ✅
- Type Gate: `npm run build` (backend) — zero TS errors. ✅
- Test Gate: `npm test` (backend + frontend) — all green. ✅
- Coverage Gate: 80% line coverage for all new files. ✅
- Security Gate: Passwords never stored plain; refresh tokens opaque and DB-revocable; httpOnly cookie prevents XSS token theft; no user enumeration in login errors; `JWT_ACCESS_SECRET` in `.env` (gitignored); tampered JWT returns 401 not 500. ✅

## Architecture Decisions

### AD-1: Opaque Refresh Token (Not JWT)

**Decision**: Refresh tokens are random hex strings stored in the `refresh_tokens` table with a `revokedAt` field.

**Why**: FR-08 requires server-side storage for revocation. A JWT refresh token cannot be revoked without a denylist, which is equivalent complexity. An opaque token is simpler, directly supports `revokedAt`, and aligns with the spec's `RefreshToken` entity definition.

**See**: `research.md` §3, `data-model.md` §Refresh Token

### AD-2: Access Token in Frontend Memory

**Decision**: Module-level variable in `authService.ts`. Never stored in `localStorage` or `sessionStorage`.

**Why**: FR-15 specifies memory storage to reduce XSS exposure. JavaScript in a compromised page cannot exfiltrate a token that was never written to any storage API.

**See**: `research.md` §6

### AD-3: Auth Routes Mounted Before authMiddleware

**Decision**: `authRoutes` mounted first (no middleware); `authMiddleware` applied after for all other `/api/v1` routes — matching the existing pattern for `googleAuthRoutes`.

**Why**: Auth endpoints issue tokens — they cannot require a token to access. The existing server.ts already demonstrates this pattern correctly.

**See**: `server.ts` lines 29–33

### AD-4: Promise Singleton for Concurrent Refresh

**Decision**: `let refreshPromise: Promise<string | null> | null` in `authService.ts` — first 401 initiates refresh; all concurrent 401s await the same promise.

**Why**: The spec (Edge Cases) explicitly calls out the concurrent refresh race condition. Without this, two simultaneous expired-token requests each call `POST /auth/refresh`, the first refresh revokes the token before the second completes (if rotation is added later), causing spurious logouts.

**See**: `research.md` §9

### AD-5: Logout is Fail-Open

**Decision**: `POST /auth/logout` always returns 200 and clears the cookie, even if no token is found in the DB.

**Why**: Spec User Story 4, scenario 4 — "if the server is temporarily unreachable, the frontend clears local auth state and takes the user to the login page anyway." The backend mirrors this: partial failures should not trap the user in a logged-in state.

### AD-6: CORS Updated to Explicit Origin

**Decision**: `cors({ origin: process.env.BASE_URL || 'http://localhost:3000', credentials: true })`.

**Why**: Browsers reject `credentials: 'include'` with `Access-Control-Allow-Origin: *`. The refresh token cookie cannot be sent without this change.

**See**: `research.md` §5

## Implementation Phases

### Phase 1: Install Dependencies

**Goal**: Install new npm packages in the backend. No frontend changes needed.

**Commands**:
```bash
cd backend
npm install jsonwebtoken bcryptjs cookie-parser
npm install --save-dev @types/jsonwebtoken @types/bcryptjs @types/cookie-parser
```

**Verification**: `npm ls jsonwebtoken bcryptjs cookie-parser` shows all three installed.

---

### Phase 2: Database Schema Changes

**Goal**: Add `passwordHash` to `User`; add `RefreshToken` model; run migration.

**Files to modify**:
1. `backend/prisma/schema.prisma`:
   - Add `passwordHash String? @map("password_hash")` to `User` model
   - Add `refreshTokens RefreshToken[]` relation to `User` model
   - Add new `RefreshToken` model (see `data-model.md` §Database Changes)

**Commands**:
```bash
cd backend
npx prisma migrate dev --name add-password-and-refresh-tokens
npx prisma generate
```

**Important**: If the `users` table already has rows from the 004 seed (dev user without `passwordHash`), run `npx prisma migrate reset` to clear existing data (acceptable per assumption A-05).

**Tests**: Migration integrity verified by `npx prisma migrate status`.

---

### Phase 3: Auth Service

**Goal**: Centralized service owning all auth primitives — password hashing, JWT generation/verification, and refresh token database CRUD.

**Files to create**:
1. `backend/src/services/authService.ts`

**Methods**:

```typescript
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/database';
import logger from '../config/logger';

const log = logger.child({ service: 'auth' });
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

export async function hashPassword(password: string): Promise<string>;
export async function verifyPassword(password: string, hash: string): Promise<boolean>;

export function generateAccessToken(userId: string, email: string): string;
  // jwt.sign({ id: userId, email }, getSecret(), { expiresIn: ACCESS_TOKEN_TTL })

export function verifyAccessToken(token: string): { id: string; email: string };
  // jwt.verify(token, getSecret()) — throws JsonWebTokenError on invalid

export function generateRefreshToken(): string;
  // crypto.randomBytes(32).toString('hex')

export async function createRefreshTokenRecord(userId: string, token: string): Promise<RefreshToken>;
  // prisma.refreshToken.create with expiresAt = now + 30 days

export async function findValidRefreshToken(token: string): Promise<RefreshToken | null>;
  // Find by token where revokedAt is null AND expiresAt > now

export async function revokeRefreshToken(token: string): Promise<void>;
  // prisma.refreshToken.updateMany where token = ... → set revokedAt = now
```

**Helper** (private):
```typescript
function getSecret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new Error('JWT_ACCESS_SECRET env var is required');
  return s;
}
```

**Tests**: `backend/tests/services/authService.test.ts`
- `hashPassword` produces a string that `verifyPassword` accepts
- `verifyPassword` returns false for wrong password
- `generateAccessToken` produces a token `verifyAccessToken` decodes to correct payload
- `verifyAccessToken` throws on tampered token
- `verifyAccessToken` throws on expired token (mock `jwt.verify` to throw `TokenExpiredError`)
- `generateRefreshToken` returns a 64-character hex string
- `createRefreshTokenRecord` calls prisma.refreshToken.create with correct expiresAt
- `findValidRefreshToken` returns null when token is revoked
- `findValidRefreshToken` returns null when token is expired
- `revokeRefreshToken` sets revokedAt on the DB record
- `getSecret` throws when `JWT_ACCESS_SECRET` is not set

---

### Phase 4: Auth Routes

**Goal**: Four HTTP endpoints for registration, login, token refresh, and logout.

**Files to create**:
1. `backend/src/routes/authRoutes.ts`

**Endpoints** (all under `/api/v1/auth`, no `authMiddleware` required):

#### POST /auth/register
```
1. Validate email + password (Zod schema)
2. Normalise email to lowercase
3. Check prisma.user.findUnique({ where: { email } }) → 409 if found
4. hash = await authService.hashPassword(password)
5. user = await prisma.user.create({ data: { email, passwordHash: hash } })
6. accessToken = authService.generateAccessToken(user.id, user.email)
7. refreshToken = authService.generateRefreshToken()
8. await authService.createRefreshTokenRecord(user.id, refreshToken)
9. res.cookie('refreshToken', refreshToken, cookieOptions)
10. return 201 { accessToken, user: { id, email } }
```

#### POST /auth/login
```
1. Validate email + password (Zod schema)
2. Normalise email to lowercase
3. user = await prisma.user.findUnique({ where: { email } })
4. If !user or !user.passwordHash → 401 invalid_credentials (same error always)
5. valid = await authService.verifyPassword(password, user.passwordHash)
6. If !valid → 401 invalid_credentials
7. accessToken = authService.generateAccessToken(user.id, user.email)
8. refreshToken = authService.generateRefreshToken()
9. await authService.createRefreshTokenRecord(user.id, refreshToken)
10. res.cookie('refreshToken', refreshToken, cookieOptions)
11. return 200 { accessToken, user: { id, email } }
```

#### POST /auth/refresh
```
1. token = req.cookies.refreshToken → 401 if missing
2. record = await authService.findValidRefreshToken(token) → 401 if null
3. user = await prisma.user.findUnique({ where: { id: record.userId } })
4. accessToken = authService.generateAccessToken(user.id, user.email)
5. return 200 { accessToken }
```

#### POST /auth/logout
```
1. token = req.cookies.refreshToken
2. If token: await authService.revokeRefreshToken(token) (ignore errors — fail-open)
3. res.clearCookie('refreshToken', cookieOptions)
4. return 200 { loggedOut: true }
```

**Cookie options helper** (shared constant in `authRoutes.ts`):
```typescript
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};
```

**Zod validation schema**:
```typescript
const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(1024),
});
```

**Tests**: `backend/tests/routes/auth.test.ts`
- `POST /auth/register` → 201 with accessToken + refreshToken cookie on valid input
- `POST /auth/register` → 400 on invalid email
- `POST /auth/register` → 400 on password < 8 chars
- `POST /auth/register` → 409 on duplicate email
- `POST /auth/login` → 200 with accessToken + refreshToken cookie on correct credentials
- `POST /auth/login` → 401 with `invalid_credentials` on wrong password
- `POST /auth/login` → 401 with `invalid_credentials` on unknown email (same message)
- `POST /auth/refresh` → 200 with new accessToken when cookie is valid
- `POST /auth/refresh` → 401 when no cookie present
- `POST /auth/refresh` → 401 when token is revoked
- `POST /auth/refresh` → 401 when token is expired
- `POST /auth/logout` → 200 and clears cookie
- `POST /auth/logout` → 200 even when no cookie present (fail-open)

---

### Phase 5: Update Auth Middleware

**Goal**: Replace the hardcoded user stub with real JWT verification.

**Files to modify**:
1. `backend/src/middleware/auth.ts`

**New implementation**:
```typescript
import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/authService';
import logger from '../config/logger';

const log = logger.child({ service: 'authMiddleware' });

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { type: 'unauthorized', message: 'Authentication required' },
    });
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch (err) {
    log.debug({ err }, 'Token verification failed');
    return res.status(401).json({
      error: { type: 'unauthorized', message: 'Authentication required' },
    });
  }
}
```

**Files to modify**:
2. `backend/tests/middleware/auth.test.ts` — full rewrite:
   - Returns 401 with structured error when `Authorization` header is missing
   - Returns 401 when `Authorization` header is malformed (not `Bearer ...`)
   - Returns 401 when token is expired
   - Returns 401 when token signature is tampered
   - Returns 200 and injects `req.user` when token is valid

---

### Phase 6: Update Server Setup

**Goal**: Wire cookie-parser, update CORS, mount auth routes (before authMiddleware), add new env vars.

**Files to modify**:
1. `backend/src/server.ts`:

```typescript
import cookieParser from 'cookie-parser';
import { authRoutes } from './routes/authRoutes';

// CORS must be before all routes
app.use(cors({
  origin: process.env.BASE_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());          // NEW — parse httpOnly cookies
app.use(requestLogger);

// Auth routes (no authMiddleware — they issue tokens)
app.use('/api/v1/auth', authRoutes);    // NEW

// Google OAuth (also before authMiddleware — callback must be public)
app.use('/api/v1', googleAuthRoutes);

// Protected routes
app.use('/api/v1', authMiddleware);
app.use('/api/v1', threadRoutes);
app.use('/api/v1', messageRoutes);
```

2. `backend/.env.example`:
   - Add `JWT_ACCESS_SECRET=` with generation hint: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

---

### Phase 7: Frontend Auth Service

**Goal**: Module-level token store with `fetchWithAuth` — an authenticated fetch wrapper that silently refreshes on 401 with race-prevention.

**Files to create**:
1. `app/src/services/authService.ts`

```typescript
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

export interface AuthUser {
  id: string;
  email: string;
}

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void { accessToken = token; }
export function getAccessToken(): string | null { return accessToken; }

async function doRefresh(): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) { accessToken = null; return null; }
  const data = await res.json();
  accessToken = data.accessToken;
  return accessToken;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function tryRestoreSession(): Promise<AuthUser | null> {
  const token = await refreshAccessToken();
  if (!token) return null;
  // Decode payload (no signature verification needed — server already verified)
  const [, payload] = token.split('.');
  const decoded = JSON.parse(atob(payload));
  return { id: decoded.id, email: decoded.email };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Login failed');
  }
  const data = await res.json();
  setAccessToken(data.accessToken);
  return data.user;
}

export async function register(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Registration failed');
  }
  const data = await res.json();
  setAccessToken(data.accessToken);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } finally {
    setAccessToken(null);
  }
}

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(url, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) throw new AuthExpiredError();
    headers.set('Authorization', `Bearer ${newToken}`);
    return fetch(url, { ...options, headers, credentials: 'include' });
  }
  return res;
}

export class AuthExpiredError extends Error {
  constructor() { super('Session expired'); }
}
```

**Tests**: `app/src/services/authService.test.ts`
- `tryRestoreSession` returns user when refresh succeeds
- `tryRestoreSession` returns null when refresh fails
- `login` stores access token and returns user on success
- `login` throws with server error message on failure
- `register` stores access token and returns user on success
- `logout` clears access token even if server returns error
- `fetchWithAuth` adds Authorization header when token present
- `fetchWithAuth` calls refreshAccessToken on 401 and retries
- `fetchWithAuth` throws AuthExpiredError when refresh fails
- concurrent calls to `refreshAccessToken` only make one fetch (promise singleton)

---

### Phase 8: Update API Client

**Goal**: Replace `fetch` with `fetchWithAuth` for all calls that require authentication. Add error boundary for `AuthExpiredError` that redirects to login.

**Files to modify**:
1. `app/src/api.ts`:
   - Import `fetchWithAuth, AuthExpiredError` from `./services/authService`
   - Replace all `fetch(`${API_URL}/api/v1/...`)` calls with `fetchWithAuth(`${API_URL}/api/v1/...`)`
   - In the `sendMessage` SSE function, pass `credentials: 'include'` and the Authorization header
   - Keep Google status/disconnect calls authenticated (they already hit `/api/v1/auth/google/...`)
   - Note: `sendMessage` SSE uses a streaming `ReadableStream` — add `Authorization` header and handle 401 before streaming starts

---

### Phase 9: Login and Registration Pages

**Goal**: Two form-based pages accessible without authentication.

**Files to create**:
1. `app/src/pages/LoginPage.tsx`
   - Form: email input, password input, submit button
   - Client-side validation: email format + password length before submit
   - On submit: call `authService.login()` → on success, call `onLogin(user)` prop → navigate to `/`
   - Error display: plain-language error below form
   - Link to register page

2. `app/src/pages/LoginPage.module.css`

3. `app/src/pages/RegisterPage.tsx`
   - Form: email input, password input, submit button
   - Client-side validation: same rules as backend (email format, 8–1024 chars)
   - On submit: call `authService.register()` → on success, call `onLogin(user)` prop
   - Error display: plain-language error below form
   - Link to login page

4. `app/src/pages/RegisterPage.module.css`

**Props interface** (shared):
```typescript
interface AuthPageProps {
  onLogin: (user: AuthUser) => void;
}
```

**Tests**: `app/src/pages/LoginPage.test.tsx`
- Renders email and password inputs
- Submit button is disabled while form is submitting
- Shows error message from authService on failure
- Calls `onLogin` prop with user on success

`app/src/pages/RegisterPage.test.tsx` — same pattern

---

### Phase 10: Route Guards and App.tsx Update

**Goal**: Wrap protected routes; handle initial session restore; redirect unauthenticated users.

**Files to create**:
1. `app/src/components/RequireAuth/RequireAuth.tsx`
   ```typescript
   // If user is null and not loading → <Navigate to="/login" replace />
   // If isLoading → show loading spinner
   // Otherwise → render children
   ```

**Files to modify**:
1. `app/src/App.tsx`:
   - Add state: `const [user, setUser] = useState<AuthUser | null>(null)` and `const [authLoading, setAuthLoading] = useState(true)`
   - On mount `useEffect`: call `authService.tryRestoreSession()` → set `user` + set `authLoading = false`
   - Add `handleLogin(user: AuthUser)` — sets `user` state
   - Add `handleLogout()` — calls `authService.logout()`, clears `user`, navigates to `/login`
   - Update `<Routes>`:
     ```tsx
     <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
     <Route path="/register" element={<RegisterPage onLogin={handleLogin} />} />
     <Route path="/*" element={
       <RequireAuth user={user} isLoading={authLoading}>
         <ChatLayout ... onLogout={handleLogout} />
       </RequireAuth>
     } />
     ```
   - Add "Log out" button/action to the sidebar (passed as `onLogout` prop)
   - Handle `AuthExpiredError` from `api.ts` calls: catch in `fetchThreads` effect → call `handleLogout()`

2. `app/src/index.tsx` (or wherever `<BrowserRouter>` / `<RouterProvider>` is configured):
   - Verify React Router v7's `<BrowserRouter>` wraps `<App>` correctly

---

### Phase 11: Safety Verification

**Goal**: Validate all edge cases from the spec before the feature is considered complete.

**Verification checklist**:

- [ ] `GET /api/v1/threads` with no token → 401 `{"error":{"type":"unauthorized",...}}`
- [ ] `GET /api/v1/threads` with tampered token → 401 (not 500)
- [ ] `GET /api/v1/threads` with expired token → 401 (not 500)
- [ ] User A logs in, User B logs in; User A's `GET /api/v1/threads` returns only User A's threads
- [ ] User A connects Gmail; User B making an email tool call uses User B's OAuth tokens (not User A's)
- [ ] `POST /auth/register` with `User@Example.COM` and then login with `user@example.com` → same account (email normalised)
- [ ] `POST /auth/register` with 1025-character password → 400 validation error
- [ ] `POST /auth/logout`; replay the refresh token cookie → 401 `invalid_token`
- [ ] Let access token expire; make API call; verify silent refresh happens, request succeeds, no login prompt
- [ ] Simulate two concurrent API calls hitting 401 simultaneously → only one `POST /auth/refresh` reaches the server
- [ ] Navigate to `/` without being logged in → redirect to `/login`
- [ ] Navigate to `/login` while already logged in → redirect to `/` (chat UI)
- [ ] Close browser, reopen → auto-login via refresh token cookie

---

## File Summary

### New Files (11)

| File | Description |
|------|-------------|
| `backend/src/services/authService.ts` | Password hashing, JWT ops, refresh token CRUD |
| `backend/src/routes/authRoutes.ts` | Register, login, refresh, logout endpoints |
| `backend/tests/services/authService.test.ts` | Unit tests for auth service |
| `backend/tests/routes/auth.test.ts` | Integration tests for auth endpoints |
| `app/src/services/authService.ts` | Frontend token store + fetchWithAuth + refresh singleton |
| `app/src/services/authService.test.ts` | Frontend auth service tests |
| `app/src/pages/LoginPage.tsx` | Login form component |
| `app/src/pages/LoginPage.module.css` | Login page styles |
| `app/src/pages/RegisterPage.tsx` | Registration form component |
| `app/src/pages/RegisterPage.module.css` | Registration page styles |
| `app/src/components/RequireAuth/RequireAuth.tsx` | Route guard wrapper |

### Modified Files (7)

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add `passwordHash` to `User`; add `RefreshToken` model |
| `backend/src/middleware/auth.ts` | Replace hardcoded user with real JWT verification |
| `backend/src/server.ts` | Add cookie-parser; update CORS; mount `authRoutes` |
| `backend/.env.example` | Add `JWT_ACCESS_SECRET` |
| `backend/tests/middleware/auth.test.ts` | Full rewrite for real JWT verification |
| `app/src/api.ts` | Replace `fetch` with `fetchWithAuth`; add auth headers to SSE |
| `app/src/App.tsx` | Add auth state, session restore, route guards, logout |

### Unchanged Files

- `backend/src/controllers/threadController.ts` — Already scopes by `req.user!.id`. No changes needed.
- `backend/src/controllers/messageController.ts` — Already uses `req.user!.id`. No changes needed.
- `backend/src/services/googleAuthService.ts` — Keyed by `userId`; real user IDs flow through automatically.
- `backend/src/services/chatService.ts` — No changes needed.
- `backend/src/services/toolExecutor.ts` — No changes needed.
- All non-auth tools — No changes needed.
- All SSE infrastructure — No changes needed.

## Dependencies Between Phases

```
Phase 1 (Install deps)
    │
    ▼
Phase 2 (DB Schema)
    │
    ▼
Phase 3 (Auth Service) ──→ Phase 4 (Auth Routes) ──→ Phase 6 (Server Setup)
    │                                                        │
    ▼                                                        ▼
Phase 5 (Update Middleware) ──────────────────────→ Phase 7 (Backend Tests complete)
                                                            │
                    ┌───────────────────────────────────────┘
                    ▼
Phase 8 (Frontend Auth Service) ──→ Phase 9 (Update API Client)
    │
    ▼
Phase 10 (Login/Register Pages) ──→ Phase 11 (Route Guards + App.tsx)
    │
    ▼
Phase 12 (Safety Verification)
```

Phases 3 and 5 can proceed in parallel. Phase 4 requires Phase 3. Phase 6 requires Phases 4 and 5. Frontend phases (8–11) can begin after Phase 6 is complete and can proceed largely in parallel with each other.
