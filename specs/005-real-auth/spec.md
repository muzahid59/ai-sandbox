# Feature Specification: Real User Authentication

**Feature Branch**: `005-real-auth`
**Created**: 2026-07-27
**Status**: Draft
**Input**: Replace the hardcoded single dev-user in the Express middleware with a real JWT-based authentication system. Users must be able to register, log in, stay logged in across page refreshes, and log out. This is Phase 1.1 of the project roadmap and a hard prerequisite for all multi-user features.

---

## Background & Problem Statement

Currently every API request is treated as the same hardcoded user (`00000000-0000-0000-0000-000000000001`, `dev@localhost`). This means:

- There is no concept of separate users — all threads and Google OAuth tokens belong to one fake identity
- The app cannot be shared or tested with real accounts
- Google OAuth token storage is functional but untestable with multiple users
- Every downstream feature (memory, scheduled tasks, shared threads) is blocked

This feature replaces the placeholder with a real identity system while keeping the existing Google OAuth and tool infrastructure intact.

---

## Scope

**In scope:**
- Email + password registration and login
- Short-lived access tokens and long-lived refresh tokens
- Silent token refresh (transparent to the user)
- Logout (single device)
- Protecting all existing `/api/v1` routes behind real auth
- Login and signup UI in the frontend
- Persisting login state across page refreshes

**Out of scope:**
- Social login (Google Sign-In, GitHub) — Google OAuth remains a separate "connect your Gmail" flow, not a login mechanism
- Multi-device logout / session management dashboard
- Password reset via email
- Email verification on signup
- Role-based access control (RBAC)
- Rate limiting on auth endpoints (future hardening)

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — New User Registration (Priority: P0)

A visitor to the app creates an account by providing an email address and password. The system validates the input, creates the account, and immediately logs them in — no separate "verify your email" step.

**Why this priority**: Registration is the entry point. Without it, no real users can exist.

**Independent Test**: Submit a valid email and password to the registration endpoint; verify a user record is created and auth tokens are returned in the response.

**Acceptance Scenarios**:

1. **Given** a visitor provides a valid email and a password meeting minimum requirements, **When** they submit the registration form, **Then** their account is created, they are logged in, and they land on the main chat UI.
2. **Given** a visitor provides an email that is already registered, **When** they submit the registration form, **Then** they receive a clear error "An account with this email already exists" — no account is created.
3. **Given** a visitor provides a password shorter than 8 characters, **When** they submit the form, **Then** they receive a validation error before the request reaches the server.
4. **Given** a visitor provides an invalid email format (missing `@`), **When** they submit the form, **Then** they receive a validation error before the request reaches the server.
5. **Given** a successful registration, **When** the user later returns to the app, **Then** they can log in with the same email and password.

---

### User Story 2 — Returning User Login (Priority: P0)

A registered user enters their email and password to access the app. On success they land on the chat UI with their previous threads visible. On failure they see a clear error without exposing whether the email exists.

**Why this priority**: Login is the core gate. Without it the app is inaccessible to real users.

**Independent Test**: Log in with valid credentials and verify threads belonging to that user are returned. Log in with wrong password and verify a generic error (not "wrong password for this email").

**Acceptance Scenarios**:

1. **Given** a registered user provides correct email and password, **When** they log in, **Then** they are taken to the chat UI and their existing threads are shown.
2. **Given** a user provides an incorrect password, **When** they submit login, **Then** they see "Invalid email or password" — the error does not distinguish between wrong email and wrong password.
3. **Given** a user provides an unregistered email, **When** they submit login, **Then** they see "Invalid email or password" — same error as wrong password (no user enumeration).
4. **Given** a user successfully logs in, **When** they close the browser tab and return within the session lifetime, **Then** they are still logged in without re-entering credentials.
5. **Given** a user is already logged in, **When** they navigate to `/login`, **Then** they are redirected to the chat UI.

---

### User Story 3 — Staying Logged In (Silent Token Refresh) (Priority: P0)

A user's session persists across page refreshes and browser restarts without them noticing any re-authentication. When their short-lived access token expires, the app silently obtains a new one using the stored refresh token.

**Why this priority**: Without this, users are logged out every 15 minutes — the app becomes unusable.

**Independent Test**: Let the access token expire (or mock expiry), make an API call, and verify the call succeeds transparently — no login prompt shown to the user.

**Acceptance Scenarios**:

1. **Given** a logged-in user whose access token has expired, **When** they send a chat message or load their threads, **Then** the app silently refreshes the token and the action completes — no interruption shown.
2. **Given** a logged-in user who closes and reopens the browser, **When** the app loads, **Then** they are automatically logged in using the stored refresh token.
3. **Given** a refresh token that has been revoked (e.g., user logged out on another device), **When** the app attempts silent refresh, **Then** the user is redirected to the login page with a message "Your session has expired, please log in again."
4. **Given** two simultaneous requests trigger a token refresh race condition, **When** both complete, **Then** only one refresh call is made to the server and both requests succeed.

---

### User Story 4 — Logout (Priority: P1)

A logged-in user can explicitly log out. Their session is invalidated on the server so the refresh token cannot be reused. They are taken to the login page.

**Why this priority**: Logout is a basic security requirement. Without it, stolen refresh tokens are valid forever.

**Independent Test**: Log in, copy the refresh token, log out, attempt to use the copied refresh token to get a new access token — verify it is rejected.

**Acceptance Scenarios**:

1. **Given** a logged-in user clicks "Log out," **When** the logout action completes, **Then** they are taken to the login page and cannot access protected routes.
2. **Given** a user has logged out, **When** someone attempts to use the invalidated refresh token, **Then** the server rejects it with an authentication error — a new login is required.
3. **Given** a user is logged out, **When** they navigate to any protected route directly, **Then** they are redirected to the login page.
4. **Given** a logout action, **When** the server is temporarily unreachable, **Then** the frontend clears local auth state and takes the user to the login page anyway (fail-open on logout).

---

### User Story 5 — Protected Routes (Priority: P0)

All existing `/api/v1` routes require a valid authenticated user. Requests without a valid token are rejected. The user's real identity flows through to tool execution (e.g. Google OAuth tokens are fetched by real user ID, not the hardcoded ID).

**Why this priority**: Without this, the auth system is decorative — the existing data is still world-readable.

**Independent Test**: Make a request to `GET /api/v1/threads` without an Authorization header; verify HTTP 401 is returned with a structured error body.

**Acceptance Scenarios**:

1. **Given** a request to any `/api/v1` route with no Authorization header, **When** the server processes it, **Then** it returns HTTP 401 with a structured error: `{"error": {"type": "unauthorized", "message": "Authentication required"}}`.
2. **Given** a request with a tampered or expired access token, **When** the server processes it, **Then** it returns HTTP 401 — not a 500 or silent success.
3. **Given** a valid access token for user A, **When** user A requests their threads, **Then** only user A's threads are returned — never user B's.
4. **Given** user A connects their Gmail account, **When** user B makes an email tool call, **Then** user B's email tool call uses user B's OAuth tokens — not user A's.
5. **Given** an authenticated request, **When** the auth middleware processes it, **Then** `req.user.id` is the real user's UUID from the database — not the hardcoded dev ID.

---

## Functional Requirements *(mandatory)*

### Authentication Endpoints

| ID | Requirement |
|----|-------------|
| FR-01 | The system must provide a registration endpoint that accepts email and password and returns auth tokens on success |
| FR-02 | The system must provide a login endpoint that accepts email and password and returns auth tokens on success |
| FR-03 | The system must provide a token refresh endpoint that accepts a valid refresh token and returns a new access token |
| FR-04 | The system must provide a logout endpoint that invalidates the refresh token provided in the request |
| FR-05 | All auth endpoints must return structured JSON error responses consistent with the existing API error format |

### Token Behaviour

| ID | Requirement |
|----|-------------|
| FR-06 | Access tokens must have a short lifetime (15 minutes) |
| FR-07 | Refresh tokens must have a long lifetime (30 days) |
| FR-08 | Refresh tokens must be stored server-side so they can be invalidated on logout |
| FR-09 | Passwords must never be stored in plain text — they must be hashed with a slow hashing algorithm |
| FR-10 | Access tokens must carry the user's ID as a claim so any route can identify the requester |

### Route Protection

| ID | Requirement |
|----|-------------|
| FR-11 | All `/api/v1` routes (except auth endpoints) must reject requests that do not carry a valid access token |
| FR-12 | The auth middleware must inject the authenticated user object (`id`, `email`) into the request for downstream handlers |
| FR-13 | Data returned from any endpoint must be scoped to the authenticated user — no cross-user data leakage |

### Frontend

| ID | Requirement |
|----|-------------|
| FR-14 | The frontend must provide a login page and a registration page accessible without authentication |
| FR-15 | The frontend must store the access token in memory (not localStorage) to reduce XSS exposure |
| FR-16 | The frontend must store the refresh token in an httpOnly cookie to prevent JavaScript access |
| FR-17 | The frontend must automatically attempt token refresh when it receives a 401 response, then retry the original request |
| FR-18 | On successful login or registration, the user must be redirected to the main chat UI |
| FR-19 | On token refresh failure, the frontend must clear auth state and redirect to the login page |

---

## Success Criteria *(mandatory)*

| # | Criterion | Measurement |
|---|-----------|-------------|
| SC-01 | Users can register and be fully operational within 30 seconds | Timed end-to-end test from form submission to first chat message |
| SC-02 | Users remain logged in across browser restarts without re-entering credentials | Open app after closing browser; verify automatic login without prompt |
| SC-03 | A logged-out session's refresh token is rejected on any subsequent use | Replay captured refresh token after logout; verify 401 response |
| SC-04 | No request to a protected route succeeds without valid credentials | Automated test: hit all `/api/v1` routes without a token; all return 401 |
| SC-05 | User A cannot access User B's threads, messages, or OAuth tokens | Create two accounts, verify complete data isolation |
| SC-06 | Token refresh is invisible to the user — no login prompt during normal use | Let access token expire during active session; verify no interruption |

---

## Key Entities *(mandatory)*

### User

| Field | Description |
|-------|-------------|
| `id` | UUID primary key |
| `email` | Unique, lowercase, validated email address |
| `passwordHash` | Slow-hashed password (bcrypt) — never the raw password |
| `createdAt` | Account creation timestamp |
| `updatedAt` | Last modification timestamp |

### RefreshToken

| Field | Description |
|-------|-------------|
| `id` | UUID primary key |
| `token` | Cryptographically random opaque string |
| `userId` | Foreign key → User |
| `expiresAt` | Absolute expiry timestamp (30 days from issuance) |
| `revokedAt` | Null until logout/revocation; set to timestamp on revocation |
| `createdAt` | Issuance timestamp |

---

## Dependencies *(mandatory)*

| Dependency | Type | Notes |
|------------|------|-------|
| Phase 1.1 (this feature) | Blocking | Hard prerequisite for Phase 2 (Memory), Phase 3 (Approval Workflow, Scheduled Tasks), Phase 4 (Integrations) |
| Existing Google OAuth system | Compatible | `googleAuthService` is already keyed by `userId`; no changes needed once real user IDs flow through |
| Existing thread/message system | Compatible | `Thread` and `Message` models already have `userId` foreign keys; data isolation is a query-layer change |
| Existing tool infrastructure | Compatible | `ToolExecutionContext` already carries `userId`; email tools will resolve real OAuth tokens automatically |
| Postgres database | Required | Already in use via Prisma |

---

## Assumptions *(mandatory)*

| # | Assumption |
|---|------------|
| A-01 | Email + password is the only login method in this phase; social login (Google Sign-In) is explicitly out of scope |
| A-02 | A single active refresh token per user is acceptable; multi-device session management is a future concern |
| A-03 | Email verification on signup is not required in this phase — any valid email format is accepted |
| A-04 | Password reset (forgot password) is out of scope; it requires an email sending capability not yet in place |
| A-05 | The existing hardcoded dev user data (threads, messages) will not be migrated — this is a sandbox and a fresh start is acceptable |
| A-06 | The refresh token is delivered and stored as an httpOnly cookie; the access token is kept in memory on the frontend |
| A-07 | The CORS configuration already set in the Express server is compatible with cookie-based refresh tokens (credentials: true) |

---

## Edge Cases *(optional)*

- **Concurrent refresh**: Two in-flight requests both receive 401 and both try to refresh simultaneously — only one refresh should reach the server; the other should wait for the first to complete.
- **Refresh token reuse after revocation**: A refresh token replayed after logout must be rejected even if the 30-day window has not elapsed.
- **Registration with mixed-case email**: `User@Example.com` and `user@example.com` must be treated as the same account — emails are normalised to lowercase on storage and lookup.
- **Very long passwords**: No artificial upper bound (within reason — reject over 1024 characters to prevent bcrypt DoS).
- **Tampered JWT**: A token with a valid structure but invalid signature must be rejected as 401, not 500.
