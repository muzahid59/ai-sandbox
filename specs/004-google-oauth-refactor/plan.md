# Implementation Plan: Google OAuth Refactor

**Feature Branch**: `004-google-oauth-refactor`
**Spec**: `specs/004-google-oauth-refactor/spec.md`
**Status**: Ready for implementation

## Technical Context

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js + Express (ts-node) |
| Database | PostgreSQL + Prisma — `User` + `GoogleOAuthToken` models (new) |
| Encryption | AES-256-GCM via Node.js `crypto` built-in (no new deps) |
| AI Integration | Agentic tool loop (`toolExecutor.ts`, max 10 iterations) |
| Tool Pattern | `RunnableTool` interface extended with optional `ToolExecutionContext` param |
| Google API Client | `googleapis` npm package (already installed) |
| Replaced legacy | File-based Gmail tokens (`.gmail-tokens.json`) + `GOOGLE_REFRESH_TOKEN` env var |
| New env vars | `TOKEN_ENCRYPTION_KEY` (64-char hex = 32 bytes for AES-256) |
| Frontend | React 18 + CSS Modules — new `GoogleConnection` component |

**No new npm dependencies required.** All packages (`googleapis`, `@prisma/client`, Node.js `crypto`) already present.

## Constitution Check

### I. Code Quality (NON-NEGOTIABLE)

- **TypeScript**: All new code in `backend/src/`. New `googleAuthService.ts`, `googleAuthRoutes.ts`, `types/context.ts`, `types/google.ts`. No JS files added. ✅
- **Single responsibility**: `googleAuthService` handles OAuth and token management only. `emailService` handles Gmail API calls only. `googleCalendar` handles Calendar API calls only. Separate route file for auth. ✅
- **Structured logging**: All `googleAuthService` operations use `logger.child({ service: 'googleAuth' })`. No `console.log`. ✅
- **Dead code**: `gmailAuthRoutes.ts` removed entirely (no "just in case" retention). `.gmail-tokens.json` file handling removed from `emailService`. ✅
- **Linting**: `npm run lint` must pass in both `backend/` and `app/` before PR. ✅
- **Function size**: Token encryption/decryption helpers, `getAuthClient`, `saveTokens` — each stays under 50 lines. ✅

### II. Testing Standards

- **Unit tests**: `googleAuthService` encryption helpers, token CRUD, auto-refresh, revocation logic (mocked `googleapis` + mocked Prisma). ✅
- **Integration tests**: All 4 Google auth endpoints via supertest (initiate, callback, status, disconnect). ✅
- **Context propagation tests**: Verify `userId` flows from `messageController` → `toolRegistry.execute` → tool handler. ✅
- **Tool tests**: Updated Calendar and Gmail tool tests — mocked `googleAuthService.getAuthClient` instead of env vars / file. ✅
- **Deterministic**: No real Google API calls in tests — all mocked. No real DB — Prisma mocked via `jest.mock('../config/database')`. ✅
- **Coverage**: 80% line coverage minimum for new files. `googleAuthService` auth paths (token refresh, revocation error) at 100% branch. ✅

### III. User Experience Consistency

- **Loading states**: `GoogleConnection` component shows spinner during status fetch and connect/disconnect actions. ✅
- **Toast notification**: `App.tsx` detects `?google=connected` query param on mount, shows toast, removes param from URL. ✅
- **Error messages**: Tool errors for missing Google connection include a plain-language message + authorize URL (no stack traces in UI). ✅
- **Disconnect confirmation**: Disconnect button requires confirmation before revoking — prevents accidental disconnect. ✅
- **CSS Modules**: `GoogleConnection` component uses `GoogleConnection.module.css`. No global styles. ✅
- **Prop drilling**: `googleConnected` state lives in `App.tsx` and flows down as props per existing pattern. ✅

### IV. Performance Requirements

- **DB index**: `google_oauth_tokens` has `@@index([userId])` — token lookup is O(log n) by user. ✅
- **Token retrieval latency**: Single indexed DB query + AES decryption < 50ms (NFR-002). ✅
- **No bundle size impact**: No new frontend npm packages. `GoogleConnection` component is minimal. ✅
- **Token refresh**: Refresh only triggered when `expiryTimestamp` is past — no unnecessary Google API calls. ✅

### Quality Gates

- Lint Gate: `npm run lint` (backend + frontend) — zero errors. ✅
- Type Gate: `npm run build` (backend) — zero TS errors. ✅
- Test Gate: `npm test` (backend + frontend) — all green. ✅
- Coverage Gate: 80% line coverage for all new files. ✅
- Security Gate: No hardcoded secrets; tokens encrypted at rest (AES-256-GCM); `TOKEN_ENCRYPTION_KEY` in `.env` (gitignored); no SSRF in OAuth redirect; Zod-validated tool inputs; `state` param validated in callback. ✅

## Architecture Decisions

### AD-1: ToolExecutionContext Propagation

**Decision**: Thread `userId` explicitly through function signatures via a `ToolExecutionContext` object.

Chain of changes:
```
req.user.id (messageController)
  → processMessage(..., userId) (chatService)
  → runAgenticLoop(..., context: ToolExecutionContext) (toolExecutor)
  → toolRegistry.execute(name, input, context) (toolRegistry)
  → tool.run(parsed.data, context?) (RunnableTool)
```

`RunnableTool.run(input, context?)` keeps context optional — tools that don't need userId (calculator, fetchUrl, web_search, getCurrentDate) ignore the parameter. Only Gmail and Calendar tools use `context.userId`.

**See**: `research.md` §1, `data-model.md` §ToolExecutionContext

### AD-2: AES-256-GCM Token Encryption

**Decision**: `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string` helpers in `googleAuthService.ts`. Format: `base64(iv):base64(ciphertext):base64(authTag)`. Random 12-byte IV per encryption call.

**See**: `research.md` §2

### AD-3: Unified Google Auth Route (`/api/v1/auth/google`)

**Decision**: New `googleAuthRoutes.ts` requests combined Gmail + Calendar scopes in one consent. Callback redirects to `${BASE_URL}?google=connected`. Old `gmailAuthRoutes.ts` is deleted.

**See**: `research.md` §3, `contracts/google-auth-endpoints.md`

### AD-4: GoogleAuthService Singleton

**Decision**: `backend/src/services/googleAuthService.ts` is the sole owner of Google OAuth credentials in the database. `emailService` delegates auth-client creation to it. `googleCalendar` also calls `googleAuthService.getAuthClient(userId)`.

**See**: `research.md` §4

### AD-5: Callback Redirect Behavior

**Decision**: `GET /api/v1/auth/google/callback` → `res.redirect(`${BASE_URL}?google=connected`)`. Frontend `App.tsx` reads the query param on mount, shows a toast, then removes the param from the URL with `history.replaceState`.

**See**: `research.md` §5

### AD-6: Clean Cutover (No Migration Script)

**Decision**: `.gmail-tokens.json` and `GOOGLE_REFRESH_TOKEN` are removed without fallback. Users re-authorize through the new UI.

**See**: `research.md` §6

### AD-7: User Model Scope

**Decision**: `User` model added to Prisma. `GoogleOAuthToken.userId` is a FK to `User.id`. `Thread.userId` remains a plain string (no FK change in this feature).

**See**: `research.md` §7

## Implementation Phases

### Phase 1: Database Foundation

**Goal**: Add `User` + `GoogleOAuthToken` Prisma models; seed dev user; add `TOKEN_ENCRYPTION_KEY` to env.

**Files to create**:
1. `backend/prisma/seed.ts` — Upserts dev user `{ id: '00000000-0000-0000-0000-000000000001', email: 'dev@localhost', displayName: 'Dev User' }`. Idempotent (upsert).

**Files to modify**:
1. `backend/prisma/schema.prisma` — Add `User` and `GoogleOAuthToken` models (see `data-model.md` §Database Models).
2. `backend/package.json` — Add `"prisma": { "seed": "ts-node prisma/seed.ts" }` to enable `npx prisma db seed`.
3. `backend/.env.example` — Add `TOKEN_ENCRYPTION_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">`. Remove `GOOGLE_REFRESH_TOKEN` line.

**Commands to run**:
```bash
cd backend
npx prisma migrate dev --name add-user-and-google-oauth-token
npx prisma db seed
npx prisma generate
```

**Tests**: Migration integrity verified by running `npx prisma migrate status` in CI.

---

### Phase 2: GoogleAuthService

**Goal**: Centralized Google OAuth service with encrypted DB-backed token storage, auto-refresh, and revocation.

**Files to create**:
1. `backend/src/types/context.ts` — `ToolExecutionContext` interface.
2. `backend/src/types/google.ts` — `GoogleConnectionStatus`, `TokenRecord` types.
3. `backend/src/services/googleAuthService.ts` — Singleton with:
   - `encrypt(plaintext: string): string` — AES-256-GCM, returns `iv:ciphertext:authTag`
   - `decrypt(ciphertext: string): string` — reverse of encrypt
   - `getEncryptionKey(): Buffer` — reads `TOKEN_ENCRYPTION_KEY`, validates 64-char hex, throws if missing
   - `saveTokens(userId, credentials, googleEmail)` — encrypt + upsert to `google_oauth_tokens`
   - `getTokens(userId): TokenRecord | null` — decrypt from DB; returns null if not found
   - `revokeTokens(userId)` — calls `googleapis` revoke endpoint + deletes DB record
   - `isConnected(userId): Promise<boolean>` — checks DB for token record
   - `getConnectionStatus(userId): Promise<GoogleConnectionStatus>` — returns status object
   - `getAuthClient(userId): Promise<OAuth2Client>` — gets tokens, auto-refreshes if expired, updates DB
   - `buildAuthorizeUrl(userId): string` — returns OAuth consent URL with combined scopes + state
   - `handleCallback(code, userId): Promise<void>` — exchanges code, fetches Google email, calls saveTokens

**Tests**: `backend/tests/services/googleAuthService.test.ts`
- Encryption roundtrip (encrypt → decrypt = original)
- `getEncryptionKey` throws when env var missing or wrong length
- `saveTokens` encrypts before writing to DB (verify ciphertext ≠ plaintext)
- `getTokens` decrypts correctly; returns null for unknown userId
- `getAuthClient` refreshes expired access token and updates DB
- `getAuthClient` throws `ToolError` when refresh fails (revoked token)
- `revokeTokens` calls Google revoke and deletes DB record; succeeds even if Google revoke fails
- `isConnected` returns false when no record exists
- `buildAuthorizeUrl` includes all three scopes

---

### Phase 3: Unified Google Auth Routes

**Goal**: Replace `gmailAuthRoutes.ts` with `googleAuthRoutes.ts` offering 4 production-grade endpoints.

**Files to create**:
1. `backend/src/routes/googleAuthRoutes.ts` — Express router with:
   - `GET /auth/google` (authMiddleware) → calls `googleAuthService.buildAuthorizeUrl(req.user!.id)` → `res.redirect`
   - `GET /auth/google/callback` (no auth, state carries userId) → calls `googleAuthService.handleCallback(code, userId)` → redirects to `${BASE_URL}?google=connected`
   - `GET /auth/google/status` (authMiddleware) → calls `googleAuthService.getConnectionStatus(req.user!.id)` → JSON
   - `DELETE /auth/google` (authMiddleware) → calls `googleAuthService.revokeTokens(req.user!.id)` → `{ disconnected: true }`

**Files to modify**:
1. `backend/src/server.ts` — Mount `googleAuthRoutes` under `/api/v1`; remove `gmailAuthRoutes` mount.

**Files to delete**:
1. `backend/src/routes/gmailAuthRoutes.ts` — Replaced entirely by `googleAuthRoutes.ts`.

**Tests**: `backend/tests/routes/googleAuth.test.ts`
- `GET /auth/google` → 302 redirect to accounts.google.com URL
- `GET /auth/google` → 500 when `GOOGLE_CLIENT_ID` missing
- `GET /auth/google/callback` with valid code + state → 302 redirect to frontend
- `GET /auth/google/callback` with `error=access_denied` → 302 to frontend with error param
- `GET /auth/google/callback` missing code → 400
- `GET /auth/google/callback` missing state → 400
- `GET /auth/google/status` connected → 200 with email + scopes
- `GET /auth/google/status` not connected → 200 with `authorizeUrl`
- `DELETE /auth/google` → 200 `{ disconnected: true }`
- `DELETE /auth/google` when not connected → 404

---

### Phase 4: ToolExecutionContext Propagation

**Goal**: Thread `userId` from HTTP request through to tool handlers. Zero behavior change for tools that don't need it.

**Files to modify**:
1. `backend/src/tools/types.ts` — Update `RunnableTool<T>` interface: `run(input: T, context?: ToolExecutionContext): Promise<string>`. Import `ToolExecutionContext` from `../types/context`.
2. `backend/src/services/toolRegistry.ts` — Update `execute(name, input, context: ToolExecutionContext): Promise<ToolResult>`. Pass `context` to `tool.run(parsed.data, context)`.
3. `backend/src/services/toolExecutor.ts` — Update `runAgenticLoop(... context: ToolExecutionContext)`. Pass `context` to `toolRegistry.execute(toolCall.name, toolCall.arguments, context)`.
4. `backend/src/services/chatService.ts` — Update `processMessage(thread, content, selectedTools, callbacks, userId: string)`. Build `context = { userId }` and pass to `runAgenticLoop`.
5. `backend/src/controllers/messageController.ts` — Pass `req.user!.id` as `userId` to `processMessage(thread, content, selectedTools, callbacks, req.user!.id)`.

**Tests**: `backend/tests/services/toolExecutionContext.test.ts`
- Verify `userId` from `req.user.id` arrives at `tool.run()` context parameter
- Verify tools that ignore context still execute correctly

---

### Phase 5: Update Google Tools

**Goal**: All Gmail and Calendar tools use `context.userId` to fetch tokens via `googleAuthService`.

**Files to modify**:
1. `backend/src/tools/googleCalendar.ts`:
   - Remove `getAuthClient()` function (reads `GOOGLE_REFRESH_TOKEN` from env)
   - Update `run(input, context?)` to call `googleAuthService.getAuthClient(context?.userId ?? '')` 
   - Throw `ToolError` with reconnect message if `!context?.userId`
   - Import `googleAuthService` from `'../services/googleAuthService'`

2. `backend/src/tools/readEmails.ts` — Remove hardcoded `userId` constant; use `context?.userId` in `emailService` calls.
3. `backend/src/tools/searchEmails.ts` — Same pattern as `readEmails.ts`.
4. `backend/src/tools/summarizeEmails.ts` — Same pattern.
5. `backend/src/tools/draftEmail.ts` — Same pattern.
6. `backend/src/tools/replyEmail.ts` — Same pattern.

7. `backend/src/services/emailService.ts`:
   - Remove `createOAuth2Client()` method (auth now owned by `googleAuthService`)
   - Remove `getScopes()` method (scopes are in `googleAuthService`)
   - Remove `getTokens/saveTokens/removeTokens/isConnected/getAuthClient` file-based methods
   - Update all Gmail API methods that create an auth client to accept an `OAuth2Client` directly (passed in by the tool, obtained from `googleAuthService`)
   - Keep all Gmail API methods (`listEmails`, `searchEmails`, `getEmail`, `createDraft`, `createReplyDraft`) — these stay but their `getAuthClient(userId)` calls are replaced with a passed-in client
   - OR simpler: keep `getAuthClient(userId)` in emailService but delegate to `googleAuthService.getAuthClient(userId)`

**Tests**:
- `backend/tests/tools/googleCalendar.test.ts` — Update to mock `googleAuthService.getAuthClient` instead of env var
- `backend/tests/tools/readEmails.test.ts` — Update to pass `context` with `userId`; mock `googleAuthService`
- `backend/tests/tools/searchEmails.test.ts` — Same
- `backend/tests/tools/draftEmail.test.ts` — Same
- `backend/tests/tools/replyEmail.test.ts` — Same

---

### Phase 6: Remove Legacy Token Sources

**Goal**: Clean cutover — no legacy storage mechanisms remain.

**Files to modify/delete**:
1. `backend/src/services/emailService.ts` — Remove all file-based token CRUD:
   - Remove `TOKEN_FILE` constant
   - Remove `readTokenFile()`, `writeTokenFile()` private methods
   - Remove `import fs from 'fs'`, `import path from 'path'`
2. `backend/.gitignore` — Remove `.gmail-tokens.json` entry (file no longer exists).
3. `backend/.env.example` — Remove `GOOGLE_REFRESH_TOKEN` line; confirm `TOKEN_ENCRYPTION_KEY` is present.

**Files to delete**:
1. `backend/.gmail-tokens.json` (if it exists on disk — gitignored but may be present locally).

**Verification checklist**:
- [ ] No reference to `.gmail-tokens.json` anywhere in `backend/src/`
- [ ] No reference to `GOOGLE_REFRESH_TOKEN` in `backend/src/`
- [ ] `emailService.ts` has no `fs` or `path` imports
- [ ] `googleCalendar.ts` has no `process.env.GOOGLE_REFRESH_TOKEN`

---

### Phase 7: Frontend Connection UI

**Goal**: Show Google connection status in the app UI with connect/disconnect controls.

**Files to create**:
1. `app/src/components/GoogleConnection/GoogleConnection.tsx` — Component with:
   - On mount: fetches `GET /api/v1/auth/google/status`
   - Connected state: shows connected email + "Disconnect" button
   - Not connected state: shows "Connect Google" button linking to `/api/v1/auth/google`
   - Disconnect: calls `DELETE /api/v1/auth/google`, refreshes status
   - Loading state: spinner during API calls
   - Error state: plain-language error message with retry option
2. `app/src/components/GoogleConnection/GoogleConnection.module.css` — CSS Module styles

**Files to modify**:
1. `app/src/App.tsx`:
   - On mount, check for `?google=connected` query param → show toast notification → remove param via `history.replaceState`
   - Render `<GoogleConnection />` in sidebar or settings area (per existing prop-drilling pattern)
2. `app/src/api.ts` — Add `getGoogleConnectionStatus()` and `disconnectGoogle()` API calls.

**Tests**: `app/src/components/GoogleConnection/GoogleConnection.test.tsx`
- Renders "Connect Google" when not connected
- Renders connected email + disconnect button when connected
- Clicking "Connect Google" navigates to `/api/v1/auth/google`
- Clicking "Disconnect" calls DELETE endpoint and shows not-connected state
- Shows spinner during loading
- Shows error state on API failure

---

### Phase 8: Safety & Edge Case Verification

**Goal**: Validate all edge cases from the spec.

**Verification checklist**:
- [ ] OAuth callback failure (user denies) → redirects to `${BASE_URL}?google=error=denied`, frontend shows error (not blank page)
- [ ] Concurrent token refresh → `getAuthClient` uses an upsert (no double-refresh race condition)
- [ ] Multiple Google account connect → new tokens overwrite old tokens (upsert behavior)
- [ ] Docker/multi-instance → tokens in DB work across containers sharing same PostgreSQL
- [ ] Missing `TOKEN_ENCRYPTION_KEY` → server startup throws clear error (not a silent null)
- [ ] Revoked refresh token → tool returns "Your Google connection has expired. Please reconnect." (not a cryptic API error)
- [ ] Scope check → `googleAuthService.hasScope(userId, requiredScope)` throws `ToolError` with reconnect URL when scope missing
- [ ] Two users each use Google tools → each gets their own tokens (no cross-user leakage)
- [ ] `Token refresh → DB updated → subsequent calls use new token` (no stale in-memory token)

---

## File Summary

### New Files (9)

| File | Description |
|------|-------------|
| `backend/src/types/context.ts` | `ToolExecutionContext` interface |
| `backend/src/types/google.ts` | `GoogleConnectionStatus`, `TokenRecord` types |
| `backend/src/services/googleAuthService.ts` | Centralized Google OAuth — DB-backed, encrypted |
| `backend/src/routes/googleAuthRoutes.ts` | 4 OAuth endpoints (initiate, callback, status, disconnect) |
| `backend/prisma/seed.ts` | Seeds dev user into `users` table |
| `app/src/components/GoogleConnection/GoogleConnection.tsx` | Frontend connect/disconnect UI |
| `app/src/components/GoogleConnection/GoogleConnection.module.css` | Component styles |
| `backend/tests/services/googleAuthService.test.ts` | Unit tests for auth service |
| `backend/tests/routes/googleAuth.test.ts` | Integration tests for auth endpoints |

### Modified Files (13)

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add `User` + `GoogleOAuthToken` models |
| `backend/package.json` | Add `prisma.seed` script |
| `backend/.env.example` | Add `TOKEN_ENCRYPTION_KEY`, remove `GOOGLE_REFRESH_TOKEN` |
| `backend/src/tools/types.ts` | Add optional `context?: ToolExecutionContext` to `run()` |
| `backend/src/services/toolRegistry.ts` | `execute(name, input, context)` — pass context to tools |
| `backend/src/services/toolExecutor.ts` | `runAgenticLoop(... context)` — thread context |
| `backend/src/services/chatService.ts` | `processMessage(... userId)` — build context |
| `backend/src/controllers/messageController.ts` | Pass `req.user!.id` to `processMessage` |
| `backend/src/services/emailService.ts` | Remove file-based token methods; delegate auth to `googleAuthService` |
| `backend/src/tools/googleCalendar.ts` | Use `googleAuthService.getAuthClient(context.userId)` |
| `backend/src/tools/readEmails.ts` + 4 other Gmail tools | Use `context.userId` instead of hardcoded ID |
| `backend/src/server.ts` | Mount `googleAuthRoutes`; remove `gmailAuthRoutes` |
| `app/src/App.tsx` | Handle `?google=connected` toast; render `<GoogleConnection />` |

### Deleted Files (1)

| File | Reason |
|------|--------|
| `backend/src/routes/gmailAuthRoutes.ts` | Replaced by `googleAuthRoutes.ts` |

### Updated Test Files (5)

| File | Covers |
|------|--------|
| `backend/tests/services/googleAuthService.test.ts` | Encryption, token CRUD, auto-refresh, revocation |
| `backend/tests/routes/googleAuth.test.ts` | All 4 OAuth endpoints |
| `backend/tests/services/toolExecutionContext.test.ts` | userId propagation through loop |
| `backend/tests/tools/googleCalendar.test.ts` | Updated to mock `googleAuthService` |
| `backend/tests/tools/readEmails.test.ts` + Gmail tool tests | Updated with `context` parameter |

### Unchanged Files

- `backend/src/services/contextService.ts` — No changes
- `backend/src/providers/` — No changes
- `backend/src/sse/` — No changes
- All non-Google tools (`calculator`, `webSearch`, `fetchUrl`, `getCurrentDate`) — `run(input, context?)` accepts context but ignores it

## Dependencies Between Phases

```
Phase 1 (DB Schema + Seed)
    │
    ▼
Phase 2 (GoogleAuthService) ──→ Phase 3 (Auth Routes)
    │
    ▼
Phase 4 (ToolExecutionContext) ──→ Phase 5 (Update Tools) ──→ Phase 6 (Remove Legacy)
                                                                     │
                                                                     ▼
Phase 7 (Frontend UI) ──────────────────────────────────────→ Phase 8 (Safety Verification)
```

Phases 3 and 4 can proceed in parallel after Phase 2. Phase 6 must follow Phase 5. Phase 8 is the final cross-cutting check.
