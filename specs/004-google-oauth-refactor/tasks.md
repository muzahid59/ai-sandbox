# Tasks: Google OAuth Refactor

**Feature Branch**: `004-google-oauth-refactor`
**Spec**: `specs/004-google-oauth-refactor/spec.md`
**Plan**: `specs/004-google-oauth-refactor/plan.md`
**Generated**: 2026-07-26

---

## Phase 1: Setup — Database Foundation

**Goal**: Add Prisma models for `User` and `GoogleOAuthToken`, seed the dev user, and update environment configuration. These changes are prerequisites for all subsequent phases.

**Independent test**: Run `npx prisma migrate status` — no pending migrations. Run `npx prisma db seed` — dev user `00000000-0000-0000-0000-000000000001` exists in the `users` table.

- [X] T001 Add `User` model (`id`, `email`, `displayName`, `createdAt`, `updatedAt`) and `GoogleOAuthToken` model (`id`, `userId` FK, `accessToken`, `refreshToken`, `expiryTimestamp`, `scopes`, `googleEmail`, `createdAt`, `updatedAt`, `@@index([userId])`) to `backend/prisma/schema.prisma`
- [X] T002 Create `backend/prisma/seed.ts` to upsert dev user `{ id: '00000000-0000-0000-0000-000000000001', email: 'dev@localhost', displayName: 'Dev User' }` — idempotent via `upsert`
- [X] T003 Add `"prisma": { "seed": "ts-node prisma/seed.ts" }` to `backend/package.json` to enable `npx prisma db seed`
- [X] T004 Update `backend/.env.example`: add `TOKEN_ENCRYPTION_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">` and remove `GOOGLE_REFRESH_TOKEN` line

---

## Phase 2: Foundational — Core Type Definitions

**Goal**: Define the TypeScript interfaces used across all new services and updated tools. Must be completed before any service or tool implementation.

**Independent test**: `npm run build` in `backend/` resolves `ToolExecutionContext` and `GoogleConnectionStatus` types without errors.

- [X] T005 Create `backend/src/types/context.ts` exporting `ToolExecutionContext` interface with `userId: string` field
- [X] T006 [P] Create `backend/src/types/google.ts` exporting discriminated union `GoogleConnectionStatus` (connected: true → email, scopes, connectedAt; connected: false → authorizeUrl) and internal `TokenRecord` interface (accessToken, refreshToken, expiryTimestamp, scopes, googleEmail)

---

## Phase 3: US2 + US3 — Unified Token Storage & Automatic Token Refresh

**Goal**: Implement `googleAuthService.ts` — the centralized Google OAuth service with AES-256-GCM encrypted DB-backed token storage and silent auto-refresh. Replaces both the Calendar env-var approach and the Gmail flat-file approach.

**Independent test**: Manually set `expiryTimestamp` to the past in the database, invoke a tool that calls `googleAuthService.getAuthClient(userId)`, and verify the tool succeeds and the DB reflects a refreshed token. No `.env` edits required.

- [X] T007 [US2] Create `backend/src/services/googleAuthService.ts` as a singleton with: `encrypt(plaintext)` / `decrypt(ciphertext)` using AES-256-GCM with random 12-byte IV (format: `base64(iv):base64(ciphertext):base64(authTag)`); `getEncryptionKey()` reading `TOKEN_ENCRYPTION_KEY` from env and throwing on missing or invalid; `saveTokens(userId, credentials, googleEmail)` encrypting both tokens before upsert; `getTokens(userId)` decrypting on read, returning null when not found; `revokeTokens(userId)` calling Google revoke endpoint then deleting DB record (succeeds even if Google revoke fails); `isConnected(userId)` checking DB presence; `getConnectionStatus(userId)` returning `GoogleConnectionStatus`; `buildAuthorizeUrl(userId)` returning consent URL with combined gmail.readonly, gmail.compose, calendar.readonly scopes and `state=userId`; `handleCallback(code, userId)` exchanging code, fetching Google email via userinfo, calling `saveTokens`; `hasScope(userId, requiredScope)` checking stored scopes array
- [X] T008 [US2] Create `backend/tests/services/googleAuthService.test.ts` covering: encrypt→decrypt roundtrip equals original; `getEncryptionKey` throws when env var missing or not 64-char hex; `saveTokens` writes ciphertext (not plaintext) to DB; `getTokens` decrypts correctly and returns null for unknown userId; `isConnected` returns false when no record exists; `getConnectionStatus` returns authorizeUrl when not connected; `buildAuthorizeUrl` URL includes all three scopes
- [X] T009 [US3] Add auto-refresh and revocation error handling inside `getAuthClient(userId)` in `backend/src/services/googleAuthService.ts`: check `expiryTimestamp < now`, call `oauth2Client.refreshAccessToken()`, call `saveTokens` with new credentials; on refresh failure (revoked token) delete DB record and throw `ToolError` with message "Your Google connection has expired. Please reconnect your account."; add corresponding tests to `backend/tests/services/googleAuthService.test.ts`

---

## Phase 4: US4 — User Context Flows to Tools

**Goal**: Thread `userId` explicitly from the HTTP request context through the agentic loop into individual tool handlers. Zero behavior change for tools that don't need userId.

**Independent test**: Log `context?.userId` inside any Gmail tool handler, send a message that triggers it, and verify the logged ID matches the authenticated user's ID — not a hardcoded value.

- [X] T010 [US4] Update `RunnableTool<T>` interface in `backend/src/tools/types.ts`: change `run` signature to `run(input: T, context?: ToolExecutionContext): Promise<string>` and add import of `ToolExecutionContext` from `'../types/context'`
- [X] T011 [P] [US4] Update `ToolRegistry.execute` in `backend/src/services/toolRegistry.ts` to accept `context: ToolExecutionContext` as third argument and pass it to `tool.run(parsed.data, context)`
- [X] T012 [P] [US4] Update `runAgenticLoop` in `backend/src/services/toolExecutor.ts` to accept `context: ToolExecutionContext` and pass it to `toolRegistry.execute(toolCall.name, toolCall.arguments, context)` in each iteration
- [X] T013 [P] [US4] Update `chatService.processMessage` in `backend/src/services/chatService.ts` to accept `userId: string`, build `context = { userId }`, and pass it to `runAgenticLoop`
- [X] T014 [US4] Update `messageController.handleSendMessage` in `backend/src/controllers/messageController.ts` to pass `req.user!.id` as `userId` argument to `processMessage`
- [X] T015 [US4] Update `backend/src/tools/googleCalendar.ts`: remove `getAuthClient()` function that reads `GOOGLE_REFRESH_TOKEN` from env; update `run(input, context?)` to call `googleAuthService.getAuthClient(context?.userId ?? '')` and throw `ToolError` with reconnect message when `!context?.userId`; import `googleAuthService`
- [X] T016 [P] [US4] Update `backend/src/tools/readEmails.ts`: replace hardcoded userId constant with `context?.userId`; throw `ToolError` with reconnect URL when userId missing
- [X] T017 [P] [US4] Update `backend/src/tools/searchEmails.ts`: replace hardcoded userId constant with `context?.userId`; throw `ToolError` with reconnect URL when userId missing
- [X] T018 [P] [US4] Update `backend/src/tools/draftEmail.ts`: replace hardcoded userId constant with `context?.userId`; throw `ToolError` with reconnect URL when userId missing
- [X] T019 [P] [US4] Update `backend/src/tools/replyEmail.ts`: replace hardcoded userId constant with `context?.userId`; throw `ToolError` with reconnect URL when userId missing
- [X] T020 [P] [US4] Update `backend/src/tools/summarizeEmails.ts`: replace hardcoded userId constant with `context?.userId`; throw `ToolError` with reconnect URL when userId missing
- [X] T021 [US4] Refactor `backend/src/services/emailService.ts`: remove `createOAuth2Client()`, `getScopes()`, `getTokens/saveTokens/removeTokens/isConnected` file-based methods; update all Gmail API methods to call `googleAuthService.getAuthClient(userId)` for auth-client creation instead of managing tokens internally
- [X] T022 [US4] Create `backend/tests/services/toolExecutionContext.test.ts` verifying `userId` from `req.user.id` arrives unchanged at `tool.run()` context parameter, and that non-Google tools (e.g. calculator) still execute correctly when context is passed

---

## Phase 5: US1 — Connect Google Account

**Goal**: Replace `gmailAuthRoutes.ts` with production-grade `googleAuthRoutes.ts` exposing 4 OAuth2 endpoints. Handles consent initiation, callback processing, status query, and disconnect.

**Independent test**: Click "Connect Google" in the UI, complete OAuth consent, and verify the app redirects to `http://localhost:3000?google=connected`. Verify `GET /api/v1/auth/google/status` returns `{ connected: true, email: "..." }`. Verify a Gmail or Calendar tool works without any `.env` edits.

- [X] T023 [US1] Create `backend/src/routes/googleAuthRoutes.ts` with Express router: `GET /auth/google` (authMiddleware) → `googleAuthService.buildAuthorizeUrl(req.user!.id)` → `res.redirect`; `GET /auth/google/callback` (no auth, state=userId) → `googleAuthService.handleCallback(code, userId)` → redirect to `${BASE_URL}?google=connected`; on `error=access_denied` → redirect to `${BASE_URL}?google=error=denied`; missing code/state → 400; `GET /auth/google/status` (authMiddleware) → `googleAuthService.getConnectionStatus(req.user!.id)` → JSON; `DELETE /auth/google` (authMiddleware) → `googleAuthService.revokeTokens(req.user!.id)` → `{ disconnected: true }`; not connected → 404
- [X] T024 [US1] Update `backend/src/server.ts`: mount `googleAuthRoutes` under `/api/v1`; remove `gmailAuthRoutes` mount
- [X] T025 [US1] Delete `backend/src/routes/gmailAuthRoutes.ts` — fully replaced by `googleAuthRoutes.ts`
- [X] T026 [US1] Create `backend/tests/routes/googleAuth.test.ts` covering: `GET /auth/google` → 302 to accounts.google.com; `GET /auth/google` → 500 when `GOOGLE_CLIENT_ID` missing; `GET /auth/google/callback` with valid code+state → 302 to frontend; `GET /auth/google/callback` with `error=access_denied` → 302 with error param; missing code → 400; missing state → 400; `GET /auth/google/status` connected → 200 with email+scopes; not connected → 200 with authorizeUrl; `DELETE /auth/google` → 200 `{ disconnected: true }`; not connected → 404

---

## Phase 6: US5 — Combined Google Scopes

**Goal**: A single OAuth consent requests Gmail and Calendar scopes together. The system detects missing scopes and triggers incremental consent rather than a silent failure.

**Independent test**: Connect Google once, then verify both `read_emails` and `google_calendar` tools succeed with the same stored credentials. Add a scope not in the initial grant, invoke a tool requiring it, and verify the error includes a reconnect URL with the missing scope.

- [X] T027 [US5] Implement scope detection in `backend/src/services/googleAuthService.ts`: `hasScope(userId, requiredScope)` throws `ToolError` with `authorizeUrl` when the required scope is absent from the stored `scopes` array; `buildAuthorizeUrl` always includes all three scopes: `gmail.readonly`, `gmail.compose`, `calendar.readonly`
- [X] T028 [P] [US5] Add `googleAuthService.hasScope(context.userId, requiredScope)` guard to `backend/src/tools/googleCalendar.ts` (scope: `calendar.readonly`) and to all Gmail tools in `backend/src/tools/` (scope: `gmail.readonly` or `gmail.compose` as appropriate) — runs before the API call and throws `ToolError` with reconnect URL when scope missing

---

## Phase 7: US6 — Connection Status in UI

**Goal**: The frontend shows Google connection status with connect/disconnect controls. App detects the `?google=connected` redirect and shows a toast notification.

**Independent test**: Load the app with no Google connection — verify a "Connect Google" option is visible. Connect, then verify the connected email displays. Disconnect, then verify the prompt returns.

- [X] T029 [US6] Create `app/src/components/GoogleConnection/GoogleConnection.tsx`: on mount fetch `GET /api/v1/auth/google/status`; connected state shows connected email + "Disconnect" button with confirmation dialog; not-connected state shows "Connect Google" button linking to `/api/v1/auth/google`; loading spinner during API calls; plain-language error state with retry
- [X] T030 [P] [US6] Create `app/src/components/GoogleConnection/GoogleConnection.module.css` with CSS Module styles for the component (connected/disconnected/loading/error states)
- [X] T031 [US6] Update `app/src/App.tsx`: on mount detect `?google=connected` query param → show toast notification → remove param via `history.replaceState`; render `<GoogleConnection />` in sidebar or settings area per existing prop-drilling pattern
- [X] T032 [P] [US6] Add `getGoogleConnectionStatus(): Promise<GoogleConnectionStatus>` and `disconnectGoogle(): Promise<void>` API calls to `app/src/api.ts`

---

## Phase 8: Polish & Cross-Cutting Concerns

**Goal**: Clean cutover from all legacy token sources. Verify no residual references to `.gmail-tokens.json` or `GOOGLE_REFRESH_TOKEN`. Confirm lint and build gates pass.

- [X] T033 Remove `TOKEN_FILE` constant, `readTokenFile()`, `writeTokenFile()` private methods, and `import fs from 'fs'` / `import path from 'path'` from `backend/src/services/emailService.ts` (file-based token storage is fully replaced by `googleAuthService`)
- [X] T034 Remove `.gmail-tokens.json` entry from `backend/.gitignore`; delete `backend/.gmail-tokens.json` from disk if it exists locally
- [X] T035 Verify zero references to `.gmail-tokens.json` or `GOOGLE_REFRESH_TOKEN` in `backend/src/` (grep check); verify `emailService.ts` has no `fs` or `path` imports; verify `googleCalendar.ts` has no `process.env.GOOGLE_REFRESH_TOKEN`
- [X] T036 [P] Run `npm run lint` in both `backend/` and `app/` — zero errors before PR
- [X] T037 [P] Run `npm run build` in `backend/` — zero TypeScript compilation errors before PR

---

## Dependency Graph

```
Phase 1: Setup (T001–T004)
    │
    ├──────────────────────────────────┐
    ▼                                  ▼
Phase 2: Foundational Types (T005–T006)
    │
    ▼
Phase 3: US2+US3 Token Storage & Auto-Refresh (T007–T009)
    │
    ├──────────────────┬───────────────┐
    ▼                  ▼               ▼
Phase 4: US4         Phase 5: US1   Phase 6: US5
Context (T010–T022)  Auth Routes    Scopes (T027–T028)
    │                (T023–T026)        │
    │                    │              │
    └────────────────────┴──────────────┘
                         │
                         ▼
                  Phase 7: US6 Frontend (T029–T032)
                         │
                         ▼
                  Phase 8: Polish (T033–T037)
```

**Phases 4, 5, and 6 can proceed in parallel after Phase 3 completes.**
**Within Phase 4:** T011–T013 can run in parallel; T014 depends on T013; T015–T021 can run in parallel after T010.
**Within Phase 5:** T024 and T025 can run in parallel after T023.
**Phase 7 can start after Phase 5 (API routes must exist for status/disconnect calls).**

---

## Parallel Execution Examples

### Phase 4 (US4) — After Phase 3 completes, run in parallel:
```
Stream 1: T010 → T014 (types.ts → messageController chain)
Stream 2: T011 (toolRegistry.ts)
Stream 3: T012 (toolExecutor.ts)
Stream 4: T013 (chatService.ts)
Stream 5: T015–T021 (all Gmail/Calendar tool updates)
Stream 6: T022 (toolExecutionContext.test.ts)
```

### Phase 5 + 6 (US1 + US5) — Run concurrently with Phase 4:
```
Stream A: T023 → T024, T025 in parallel → T026
Stream B: T027, T028 in parallel
```

### Phase 7 (US6) — After Phase 5 completes:
```
Stream 1: T029 (GoogleConnection.tsx)
Stream 2: T030 (GoogleConnection.module.css)
Stream 3: T031 (App.tsx)
Stream 4: T032 (api.ts)
```

---

## Implementation Strategy

**MVP scope** (complete all P0 user stories — US1–US4):
1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: US2+US3 (GoogleAuthService)
4. Phase 4: US4 (ToolExecutionContext)
5. Phase 5: US1 (Auth Routes)
6. Polish subset: T033–T035 (cleanup + verification)

**Full delivery** adds US5 (combined scopes — Phase 6) and US6 (connection status UI — Phase 7).

**Suggested increment order**:
1. Phases 1–3 → backend auth foundation working, testable with `curl`
2. Phase 4 → tools use real user context
3. Phase 5 → connect/disconnect flow end-to-end via `curl`
4. Phase 6 → scope handling for multi-service use
5. Phase 7 → UI polished and self-serve
6. Phase 8 → clean cutover verified, ready for PR

---

## Summary

| Metric | Count |
|--------|-------|
| Total tasks | 37 |
| Phase 1 (Setup) | 4 |
| Phase 2 (Foundational) | 2 |
| Phase 3 (US2+US3 Token Storage & Refresh) | 3 |
| Phase 4 (US4 User Context) | 13 |
| Phase 5 (US1 Connect Google) | 4 |
| Phase 6 (US5 Combined Scopes) | 2 |
| Phase 7 (US6 Connection Status UI) | 4 |
| Phase 8 (Polish) | 5 |
| Parallelizable tasks [P] | 18 |
| Test tasks | 5 (T008, T009, T022, T026, partial T009) |

**New files**: 9 (googleAuthService.ts, googleAuthRoutes.ts, context.ts, google.ts, seed.ts, GoogleConnection.tsx, GoogleConnection.module.css, googleAuthService.test.ts, googleAuth.test.ts, toolExecutionContext.test.ts)
**Modified files**: 13
**Deleted files**: 1 (gmailAuthRoutes.ts)
