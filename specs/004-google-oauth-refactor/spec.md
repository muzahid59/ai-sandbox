# Feature Specification: Google OAuth Refactor

**Feature Branch**: `004-google-oauth-refactor`
**Created**: 2026-07-26
**Status**: Draft
**Input**: Close the gap between the current Google authentication system (env-var and flat-file based) and production-grade OAuth used by apps like ChatGPT, Gemini, and Copilot for Gmail and Google Calendar integration.

## Problem Statement

The current app handles Google authentication in two inconsistent, non-production-ready ways:

1. **Google Calendar**: Reads a single `GOOGLE_REFRESH_TOKEN` from the `.env` file. No per-user support, no token refresh logic, no UI flow. Users must run a CLI script and manually paste the token into `.env`.

2. **Gmail**: Stores tokens in a flat JSON file (`backend/.gmail-tokens.json`) keyed by user ID. Has OAuth routes and auto-refresh logic, but tools hardcode a single user ID (`00000000-0000-0000-0000-000000000001`). The file won't survive multi-instance or Docker deployments.

**How production apps handle this** (ChatGPT, Gemini, Copilot):
- Users click "Connect" in the app UI and complete OAuth consent in the browser
- Tokens are stored per-user in a database, encrypted at rest
- Token refresh happens silently; re-consent is triggered only when scopes change
- Each user connects independently with their own Google account
- Tools receive the authenticated user's identity from the request context — not from env vars or hardcoded IDs

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect Google Account (Priority: P0)

A user wants to connect their Google account to use Gmail and Calendar tools. They click a "Connect Google" button in the app, complete the OAuth consent screen, and return to the app with their account connected.

**Why this priority**: All Google-powered tools depend on authentication. Nothing works without it.

**Independent Test**: Click "Connect Google" in the UI, complete OAuth consent, and verify the app shows the connected Google account email. Then use a Gmail or Calendar tool and verify it works without any `.env` edits.

**Acceptance Scenarios**:

1. **Given** a user with no Google connection, **When** they click "Connect Google" in the app, **Then** the app redirects them to Google's OAuth consent screen requesting Gmail and Calendar scopes.
2. **Given** the user completes OAuth consent, **When** Google redirects back to the app, **Then** the app stores the tokens in the database linked to the user's account and redirects them back to the main chat UI with a query parameter (e.g., `?google=connected`). The frontend displays a brief toast notification confirming the connection.
3. **Given** a user with a connected Google account, **When** they visit the settings or connection status area, **Then** the app shows the connected Google email and a "Disconnect" option.
4. **Given** a user clicks "Disconnect," **When** the action completes, **Then** the app revokes the Google token and removes it from the database. Subsequent tool calls return "Google account not connected."

---

### User Story 2 - Unified Token Storage (Priority: P0)

All Google OAuth tokens are stored in the database per-user, replacing both the `.env` variable (Calendar) and the flat JSON file (Gmail). Tokens include the refresh token, access token, expiry, granted scopes, and the user's Google email.

**Why this priority**: Database storage is the foundation for multi-user support, Docker compatibility, and secure token management.

**Independent Test**: Connect a Google account, restart the server (or redeploy the Docker container), and verify tools still work without re-authorization.

**Acceptance Scenarios**:

1. **Given** a user completes OAuth, **When** the tokens are stored, **Then** they are persisted in a database table linked to the user's account — not in a file or environment variable.
2. **Given** the server restarts, **When** a tool is invoked, **Then** it retrieves the stored tokens from the database and works without re-authorization.
3. **Given** two users each connect their Google accounts, **When** each user invokes a tool, **Then** the correct user's tokens are used — there is no cross-user token leakage.
4. **Given** a connected user, **When** tokens are queried from the database, **Then** the refresh token is stored encrypted — not in plaintext.

---

### User Story 3 - Automatic Token Refresh (Priority: P0)

When a user's access token expires, the system silently refreshes it using the stored refresh token. The user never sees an auth error for routine expiration.

**Why this priority**: Access tokens expire every hour. Without silent refresh, users would need to re-authorize hourly.

**Independent Test**: Manually set a token's expiry to the past in the database, invoke a tool, and verify it succeeds (the token was refreshed behind the scenes).

**Acceptance Scenarios**:

1. **Given** an expired access token, **When** a tool is invoked, **Then** the system uses the refresh token to obtain a new access token, updates the database, and completes the tool call — the user sees no error.
2. **Given** a revoked refresh token (user revoked access in Google settings), **When** a tool is invoked, **Then** the system returns a clear message: "Your Google connection has expired. Please reconnect your account." — not a cryptic API error.
3. **Given** a successful token refresh, **When** the new tokens are stored, **Then** the updated access token and new expiry are persisted in the database for subsequent calls.

---

### User Story 4 - User Context Flows to Tools (Priority: P0)

When a tool is executed, it receives the authenticated user's identity from the request context. Tools no longer hardcode a user ID or read from environment variables.

**Why this priority**: This is the structural gap that blocks per-user auth. Without it, tools cannot retrieve the correct user's tokens.

**Independent Test**: Log the user ID received by a tool handler during execution. Verify it matches the authenticated user making the request — not a hardcoded value.

**Acceptance Scenarios**:

1. **Given** a user sends a message that triggers a tool, **When** the tool handler executes, **Then** it receives the authenticated user's ID from the request context — not from a hardcoded constant.
2. **Given** the tool has the user's ID, **When** it needs Google credentials, **Then** it retrieves that specific user's tokens from the database.
3. **Given** two users are using the app concurrently, **When** each triggers a Google tool, **Then** each tool call uses the correct user's credentials without interference.

---

### User Story 5 - Combined Google Scopes (Priority: P1)

Gmail and Calendar use a single OAuth consent with combined scopes. The user connects once and gets both Gmail and Calendar access. If new scopes are needed later, the system triggers incremental consent.

**Why this priority**: Users should not need to connect Google twice for two services. This matches the pattern used by ChatGPT and Gemini.

**Independent Test**: Connect Google account once, then verify both a Gmail tool (read_emails) and a Calendar tool (google_calendar) work with the same stored credentials.

**Acceptance Scenarios**:

1. **Given** a user connects their Google account, **When** the OAuth consent screen appears, **Then** it requests scopes for both Gmail and Calendar in a single consent flow.
2. **Given** a user connected before a new scope was added, **When** they invoke a tool requiring the new scope, **Then** the system detects the missing scope and prompts the user to re-authorize with the additional scope — not a silent failure.
3. **Given** the granted scopes are stored with the token, **When** a tool checks for its required scope, **Then** it can determine whether re-authorization is needed before making the API call.

---

### User Story 6 - Connection Status in UI (Priority: P1)

The frontend shows whether the user's Google account is connected, which Google email is linked, and provides connect/disconnect controls.

**Why this priority**: Users need visibility into their connection status and the ability to manage it without backend knowledge.

**Independent Test**: Load the app with no Google connection — verify a "Connect Google" prompt is visible. Connect, then verify the connected email is shown. Disconnect, then verify the prompt returns.

**Acceptance Scenarios**:

1. **Given** no Google account is connected, **When** the user opens the app, **Then** a "Connect Google" option is visible in the UI (settings area or inline prompt when a Google tool fails).
2. **Given** a connected Google account, **When** the user views their settings, **Then** the connected Google email is displayed with a "Disconnect" option.
3. **Given** a tool returns a "not connected" error, **When** the error is displayed in the chat, **Then** it includes a clickable link or button to initiate the connection flow.

---

### Edge Cases

- **OAuth callback failure**: If the OAuth callback fails (user denies consent, network error), the app shows a clear error and allows the user to retry — not a blank page or crash.
- **Multiple Google accounts**: If a user connects a different Google account than before, the new tokens replace the old ones. The previous connection is cleanly overwritten.
- **Token storage migration**: Legacy token sources (`.gmail-tokens.json` and `GOOGLE_REFRESH_TOKEN` env var) are removed. Users re-authorize through the new UI flow. No fallback chain or migration script.
- **Docker/multi-instance**: Token storage in the database works identically across Docker containers sharing the same database — no host filesystem dependency.
- **Concurrent requests**: Two simultaneous requests from the same user that both trigger token refresh should not corrupt the stored token. Only one refresh should occur.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a single OAuth2 flow that requests combined scopes for Gmail (`gmail.readonly`, `gmail.compose`) and Calendar (`calendar.readonly`) in one consent screen.
- **FR-002**: OAuth2 tokens MUST be stored in a database table linked to the user's account, containing: access token, refresh token, expiry timestamp, granted scopes, Google email, and creation date.
- **FR-003**: Both access tokens and refresh tokens MUST be stored encrypted in the database — not in plaintext.
- **FR-004**: The system MUST automatically refresh expired access tokens using the stored refresh token, update the database with new tokens, and retry the failed API call — with no user intervention.
- **FR-005**: When a refresh token is revoked or invalid, the system MUST return a user-friendly error message indicating re-authorization is needed, and MUST remove the invalid token from the database.
- **FR-006**: The tool execution pipeline MUST propagate the authenticated user's ID from the HTTP request context through to tool handlers. Tools MUST NOT hardcode user IDs.
- **FR-007**: The system MUST provide API endpoints for: initiating OAuth (`GET /api/v1/auth/google`), handling the callback (`GET /api/v1/auth/google/callback`), checking connection status (`GET /api/v1/auth/google/status`), and disconnecting (`DELETE /api/v1/auth/google`).
- **FR-008**: The disconnect endpoint MUST revoke the Google token (via Google's revoke endpoint) and remove the token record from the database.
- **FR-009**: The Calendar tool MUST be updated to retrieve tokens from the database (via user ID) instead of from environment variables.
- **FR-010**: The Gmail email service MUST be updated to retrieve tokens from the database instead of from the flat JSON file.
- **FR-011**: The system MUST store granted scopes with each token and MUST detect when a tool requires a scope not yet granted — triggering incremental consent rather than a silent API failure.
- **FR-012**: The frontend MUST display Google connection status (connected email or "not connected") and provide connect/disconnect controls.
- **FR-013**: When a Google tool fails due to missing authentication, the error response MUST include an authorization URL the frontend can use to initiate the OAuth flow.

### Non-Functional Requirements

- **NFR-001**: The OAuth flow (consent screen to connected state) MUST complete within 30 seconds under normal network conditions.
- **NFR-002**: Token retrieval from the database MUST add no more than 50ms of latency to tool calls compared to the current env-var/file approach.
- **NFR-003**: The token encryption method MUST use a standard algorithm (e.g., AES-256) with an encryption key stored separately from the database.
- **NFR-004**: The migration from file-based to database-backed tokens is a clean cutover — legacy token sources (`.gmail-tokens.json` and `GOOGLE_REFRESH_TOKEN` env var) are removed. Users MUST re-authorize through the new UI flow.
- **NFR-005**: The system MUST work identically in local development and Docker environments with no filesystem dependencies for token storage.

### Key Entities

- **User**: Database model representing an application user. Contains unique ID, email, display name, and timestamps. `GoogleOAuthToken` has a foreign key relationship to User. Seeded with the existing dev user on first migration.
- **GoogleOAuthToken**: Database record linked to a User via foreign key, containing: access token (encrypted), refresh token (encrypted), expiry timestamp, granted scopes (array), Google email, provider identifier, and timestamps (created/updated).
- **GoogleAuthService**: Centralized service handling OAuth flow initiation, callback processing, token storage, token retrieval, automatic refresh, and revocation. Replaces both the Calendar env-var approach and the Gmail flat-file approach.
- **ToolExecutionContext**: Extended context object that carries the authenticated user's ID from the HTTP request through the agentic loop into individual tool handlers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can connect their Google account through the app UI and use both Gmail and Calendar tools without editing any configuration files.
- **SC-002**: After connecting once, a user never needs to re-authorize unless they revoke access in Google settings or new scopes are required.
- **SC-003**: Two different users can each connect their own Google accounts and use Google tools independently with no cross-user token leakage.
- **SC-004**: Token refresh is invisible to the user — no auth errors for routine access token expiration.
- **SC-005**: The app works identically in Docker and local development with no filesystem dependencies for authentication state.
- **SC-006**: All Google tools (Gmail and Calendar) use the same token retrieval path — no tool reads from env vars or flat files.
- **SC-007**: A user can disconnect their Google account from the UI, and subsequent tool calls return a clear "not connected" message with a link to reconnect.

## Clarifications

### Session 2026-07-26

- Q: Should a User model be added to the database for GoogleOAuthToken foreign key, or use a plain string userId? → A: Add a User model to Prisma with a foreign key from GoogleOAuthToken. Seed with the dev user on first migration.
- Q: What migration strategy for existing file/env-based tokens? → A: Clean cutover — remove legacy token sources entirely. Users re-authorize through the new UI flow. No fallback chain or migration script.
- Q: Encrypt both access and refresh tokens, or only refresh token? → A: Encrypt both. A leaked access token is exploitable for up to an hour; encrypting both is industry standard with negligible performance cost.
- Q: Where should the OAuth callback redirect the user? → A: Back to the main chat UI with a query parameter (e.g., `?google=connected`). Frontend shows a toast notification confirming the connection.

## Assumptions

- A `User` model will be added to the Prisma schema with a foreign key relationship to `GoogleOAuthToken`. The existing hardcoded dev user is seeded on first migration. When real auth is implemented, the same User model carries over.
- The existing PostgreSQL database and Prisma ORM are used for token storage — no new database infrastructure is needed.
- Google Cloud project credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) remain in `.env` as application-level config. Only per-user tokens move to the database.
- An encryption key for token encryption will be stored as an environment variable (`TOKEN_ENCRYPTION_KEY`) — not in the database.
- The existing Gmail OAuth routes (`backend/src/routes/gmailAuthRoutes.ts`) will be replaced by the new unified Google auth routes, not extended alongside them.
- The flat JSON file (`.gmail-tokens.json`) and Calendar env var (`GOOGLE_REFRESH_TOKEN`) will be removed entirely. No fallback — users re-authorize through the new UI.
