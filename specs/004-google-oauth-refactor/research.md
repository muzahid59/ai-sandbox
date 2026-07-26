# Research: Google OAuth Refactor

## 1. ToolExecutionContext Propagation Strategy

**Decision**: Thread `userId` explicitly through function signatures via a typed `ToolExecutionContext` object, modifying `toolRegistry.execute()`, `runAgenticLoop()`, `chatService.processMessage()`, and the `RunnableTool.run()` interface.

**Rationale**:
- Explicit propagation is type-safe and easy to trace — no hidden magic.
- Avoids the complexity of AsyncLocalStorage (ALS), which would require Node.js `als.run()` wrapping at request entry and `als.getStore()` calls inside tools — harder to test and surprising to readers unfamiliar with ALS.
- The `RunnableTool.run(input, context?)` signature keeps the `context` optional, so tools that don't need userId (calculator, web_search, fetchUrl) require no changes.
- The signature chain: `messageController` (has `req.user.id`) → `chatService.processMessage(userId)` → `runAgenticLoop(context)` → `toolRegistry.execute(name, input, context)` → `tool.run(parsed.data, context)`.

**Alternatives considered**:
- **AsyncLocalStorage**: Node.js ALS provides implicit context — tools call `getExecutionContext()` without any parameter change. Pros: zero function signature changes. Cons: requires ALS wrapping at request entry, harder to unit test (must mock ALS store), behavior is non-obvious without familiarity with the pattern.
- **Request-scoped registry**: Create a new ToolRegistry instance per request with userId bound. Cons: complicates the singleton registration pattern; all tools would need re-registration per request.

## 2. Token Encryption Algorithm

**Decision**: AES-256-GCM using Node.js built-in `crypto` module. Encryption key stored as `TOKEN_ENCRYPTION_KEY` (64-char hex = 32 bytes) in environment variables.

**Rationale**:
- AES-256-GCM is the industry standard for symmetric encryption of short secrets (access tokens, refresh tokens). GCM mode provides authenticated encryption — both confidentiality and integrity.
- Node.js `crypto.createCipheriv('aes-256-gcm', ...)` is available without any npm dependency.
- A random 12-byte IV is generated per encryption and stored alongside the ciphertext (base64-encoded: `iv:ciphertext:authTag` format). This ensures identical tokens encrypt to different ciphertexts.
- The key is 32 bytes (256 bits). Stored as a 64-character hex string in `.env` for readability.

**Alternatives considered**:
- **`bcrypt`/`scrypt`**: Hash functions, not reversible — unsuitable for tokens that must be decrypted for API calls.
- **AES-256-CBC**: No authentication tag — vulnerable to padding oracle attacks. GCM is strictly superior.
- **External key management (e.g., AWS KMS)**: Appropriate for production but out of scope for local dev. `TOKEN_ENCRYPTION_KEY` in `.env` is the correct level of security for this project.

## 3. Combined OAuth Scopes Strategy

**Decision**: Single OAuth2 consent requesting Gmail + Calendar scopes together: `gmail.readonly`, `gmail.compose`, `calendar.readonly`.

**Rationale**:
- FR-001 and FR-011 specify combined scopes in one consent screen.
- Users connect once, both Gmail and Calendar tools become available immediately.
- Scopes are stored alongside the token record so tools can check whether a required scope was granted (FR-011 incremental consent detection).
- The `googleAuthService` includes a `hasScope(userId, requiredScope)` method that tools call before making API requests.

**Alternatives considered**:
- **Separate Gmail and Calendar OAuth flows**: Two "Connect" buttons, two separate token records. Rejected: spec explicitly requires a unified flow (User Story 5).
- **Broader scopes (gmail.modify, calendar.events)**: More permission than needed. Rejected: least-privilege principle.

## 4. GoogleAuthService Architecture

**Decision**: New singleton service `backend/src/services/googleAuthService.ts` handles all Google OAuth concerns: initiation, callback processing, token storage/retrieval (encrypted, DB-backed), auto-refresh, revocation, and scope checking. The existing `emailService.ts` is refactored to delegate auth-client creation to `googleAuthService`.

**Rationale**:
- Single responsibility: `emailService` handles Gmail API operations; `googleAuthService` handles auth and credentials.
- Both Calendar and Gmail tools share the same `getAuthClient(userId)` call — one service, one code path, no divergence.
- The existing `emailService`'s file-based token methods (`getTokens`, `saveTokens`, `removeTokens`, `createOAuth2Client`) are removed and replaced by delegation to `googleAuthService`.

**Alternatives considered**:
- **Merge into emailService**: emailService grows to include Calendar auth, violating single responsibility. Rejected.
- **Separate CalendarAuthService + GmailAuthService**: Duplicates token storage logic. Rejected.

## 5. OAuth Callback Redirect Behavior

**Decision**: After successful OAuth callback, redirect to `http://localhost:3000?google=connected`. Frontend detects query param and shows a toast notification. The OAuth popup/tab is closed or reused.

**Rationale**:
- Matches spec Clarification: "Back to the main chat UI with a query parameter (e.g., `?google=connected`). Frontend shows a toast notification confirming the connection."
- The redirect is server-side (`res.redirect(...)`) — no HTML response page needed.
- The callback redirects to the `BASE_URL` env var (defaulting to `http://localhost:3000`) with `?google=connected`, making it environment-agnostic.

**Alternatives considered**:
- **HTML success page ("Gmail Connected. You can close this window")**: Used by the current Gmail OAuth flow. Rejected: spec specifies redirect back to main UI, not a standalone page.
- **Popup window pattern**: Frontend opens OAuth URL in a popup, polls for a `postMessage`. More complex, requires CORS changes. Rejected as over-engineering.

## 6. Legacy Token Migration Strategy

**Decision**: Clean cutover — no migration script. The file `backend/.gmail-tokens.json` and the env var `GOOGLE_REFRESH_TOKEN` are removed entirely. Users re-authorize through the new UI flow.

**Rationale**:
- Spec Clarification (2026-07-26): "Clean cutover — remove legacy token sources entirely. Users re-authorize through the new UI flow. No fallback chain or migration script."
- NFR-004 confirms this: "migration from file-based to database-backed tokens is a clean cutover."
- For a local dev environment with a single hardcoded user, re-authorizing once is trivially low friction.

**Alternatives considered**:
- **Migration script**: Read `.gmail-tokens.json` + `GOOGLE_REFRESH_TOKEN`, encrypt, insert into DB. Adds complexity; unnecessary given single-user dev context and the spec's explicit direction against it.

## 7. User Model Addition Strategy

**Decision**: Add a `User` model to the Prisma schema with the dev user seeded via a migration seed file (`backend/prisma/seed.ts`). The existing `Thread.userId` plain string field is NOT converted to a foreign key in this feature.

**Rationale**:
- Spec Clarification: "Add a User model to Prisma with a foreign key relationship to `GoogleOAuthToken`. Seed with the dev user on first migration."
- The `GoogleOAuthToken` model references `User` via a FK, satisfying the per-user requirement.
- Keeping `Thread.userId` as a plain string avoids a risky schema change affecting existing Thread + Message data — converting it to a FK would require all existing rows to have a matching User record, and that's a separate refactor.
- Seeding the dev user ID `00000000-0000-0000-0000-000000000001` ensures the FK constraint is satisfied immediately.
