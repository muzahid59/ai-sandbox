# Research: Real JWT Authentication

## §1 — JWT Library: jsonwebtoken vs jose

**Decision**: `jsonwebtoken` + `@types/jsonwebtoken`

**Rationale**: `jsonwebtoken` is the established Node.js JWT library with full CommonJS support, which avoids ESM/CJS interop friction in this ts-node setup. `jose` is modern but ESM-first and can cause compatibility issues in ts-node projects without additional bundler configuration.

**Alternatives considered**: `jose` — rejected due to ESM/CJS interop complexity with ts-node.

---

## §2 — Password Hashing: bcryptjs vs bcrypt

**Decision**: `bcryptjs` + `@types/bcryptjs`, cost factor 12

**Rationale**: `bcryptjs` is a pure JavaScript implementation requiring no native bindings. This avoids build failures in Docker multi-arch environments (the Prisma schema already targets `linux-musl-openssl-3.0.x`, which signals native-binding sensitivity). Cost factor 12 is the industry standard for server-side registration/login flows.

**Alternatives considered**: `bcrypt` (C++ native) — rejected due to Docker build complexity with native addons.

---

## §3 — Refresh Token Strategy: Opaque vs JWT

**Decision**: Opaque random token (`crypto.randomBytes(32).toString('hex')`) stored in the `refresh_tokens` database table.

**Rationale**: FR-08 requires server-side storage so tokens can be invalidated on logout (FR-04). A JWT refresh token cannot be revoked without a denylist — which is equivalent complexity to a DB lookup. An opaque token is simpler, safer, and directly supports the `revokedAt` revocation pattern from the spec's `RefreshToken` entity.

**Alternatives considered**: JWT refresh token with a denylist — same complexity, higher implementation risk, harder to audit.

---

## §4 — Cookie Scope: httpOnly with SameSite=Strict

**Decision**: Refresh token cookie set with `httpOnly: true`, `sameSite: 'strict'`, `path: '/'`, `secure: process.env.NODE_ENV === 'production'`, `maxAge: 30 * 24 * 60 * 60 * 1000`.

**Rationale**: `httpOnly` prevents JavaScript access (primary XSS defense). `sameSite: 'strict'` prevents CSRF. `path: '/'` simplifies cookie deletion on logout and avoids path-mismatch bugs. `secure` is production-only because local dev runs HTTP.

**Alternatives considered**: `path: '/api/v1/auth'` — would scope cookie to auth endpoints only but complicates deletion. Rejected for simplicity.

---

## §5 — CORS: Wildcard vs Explicit Origin

**Decision**: Replace `cors()` with `cors({ origin: process.env.BASE_URL || 'http://localhost:3000', credentials: true })`.

**Rationale**: Browsers block cookies on responses with `Access-Control-Allow-Origin: *`. An explicit origin is required for `credentials: true` to function. `BASE_URL` already exists in `.env.example` and is used for OAuth redirects — no new env var needed for CORS.

---

## §6 — Access Token Storage: Module Variable vs React Context

**Decision**: Module-level variable in `app/src/services/authService.ts`.

**Rationale**: React Context adds lifecycle complexity (re-renders on every silent refresh, context provider nesting). A module-level singleton is invisible to React's render cycle — exactly what's needed for transparent background refresh. Components consume tokens only indirectly through `api.ts` calls.

**Alternatives considered**: React Context — creates unnecessary re-renders; `sessionStorage` — persists across tabs but not cross-tab security isolation; `localStorage` — XSS risk. All rejected per FR-15.

---

## §7 — Frontend Route Guard: Wrapper Component

**Decision**: `<RequireAuth>` wrapper component using React Router v7's `<Navigate>`.

**Rationale**: React Router v7 is already installed and uses `<Routes>`/`<Route>` in `App.tsx`. A wrapper component is idiomatic v7 — simpler than a HOC and works within the existing `prop-drilling` pattern (no new state management layer).

---

## §8 — User Model: passwordHash Nullable

**Decision**: `passwordHash String? @map("password_hash")` (nullable).

**Rationale**: The `User` model was introduced in feature 004. Making `passwordHash` nullable allows `prisma migrate dev` to run against existing rows without a default. Per A-05 (fresh start is acceptable), the dev should run `prisma migrate reset` to clear the database. New registered users always receive a non-null `passwordHash`.

**Alternatives considered**: Non-nullable with `@default("")` — introduces a security risk (empty hash); non-nullable without default — migration fails on existing rows. Both rejected.

---

## §9 — Concurrent Token Refresh: Promise Singleton

**Decision**: Module-level `refreshPromise` variable — the first caller initiates refresh and stores the promise; subsequent concurrent callers await the same promise.

```typescript
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
```

**Rationale**: This ensures exactly one `POST /auth/refresh` reaches the server per 401 burst. All concurrent requests retry with the new token once it resolves.

---

## §10 — New npm Dependencies Summary

| Package | Scope | Purpose |
|---------|-------|---------|
| `jsonwebtoken` | backend prod | JWT signing/verification |
| `@types/jsonwebtoken` | backend dev | TypeScript types |
| `bcryptjs` | backend prod | Password hashing (pure JS, no native) |
| `@types/bcryptjs` | backend dev | TypeScript types |
| `cookie-parser` | backend prod | Parse httpOnly cookies from requests |
| `@types/cookie-parser` | backend dev | TypeScript types |

**Frontend**: No new dependencies. `react-router-dom` v7 already installed.
