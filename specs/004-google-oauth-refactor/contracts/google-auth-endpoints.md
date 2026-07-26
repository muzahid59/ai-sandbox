# Contract: Google Auth Endpoints

All endpoints are mounted under `/api/v1` in `backend/src/server.ts`.

---

## GET /api/v1/auth/google

Initiates the unified Google OAuth2 authorization flow. Requests combined Gmail + Calendar scopes. Redirects to Google's consent screen.

**Auth**: Requires `authMiddleware` (injects `req.user.id`).

**Response**: HTTP 302 redirect to Google OAuth2 consent URL.

**Redirect URL pattern**:
```
https://accounts.google.com/o/oauth2/v2/auth?
  client_id={GOOGLE_CLIENT_ID}&
  redirect_uri={BASE_URL_BACKEND}/api/v1/auth/google/callback&
  response_type=code&
  scope=https://www.googleapis.com/auth/gmail.readonly
        https://www.googleapis.com/auth/gmail.compose
        https://www.googleapis.com/auth/calendar.readonly&
  access_type=offline&
  prompt=consent&
  state={userId}
```

**Error responses**:

| Status | Body | When |
|--------|------|------|
| 500 | `{"error": {"type": "internal_error", "message": "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."}}` | Missing env vars |

---

## GET /api/v1/auth/google/callback

Handles the OAuth2 callback from Google. Exchanges authorization code for tokens, encrypts and stores them in the database, and redirects the user back to the frontend.

**Auth**: None (callback from Google; `state` param carries user ID).

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes | Authorization code from Google |
| `state` | string | Yes | User ID passed through the OAuth state param |
| `error` | string | No | Error code if user denied access (e.g., `access_denied`) |

**Success response**: HTTP 302 redirect to `{BASE_URL}?google=connected`

Example: `http://localhost:3000?google=connected`

**Error responses**:

| Status | Body | When |
|--------|------|------|
| 302 | Redirect to `{BASE_URL}?google=error=denied` | User clicked "Deny" on consent screen |
| 302 | Redirect to `{BASE_URL}?google=error=failed` | Token exchange or DB storage failed |
| 400 | `{"error": {"type": "bad_request", "message": "Missing authorization code."}}` | No `code` param |
| 400 | `{"error": {"type": "bad_request", "message": "Missing state parameter."}}` | No `state` param |

**On success, stored in DB** (`google_oauth_tokens`):
- `accessToken` (encrypted)
- `refreshToken` (encrypted)
- `expiryTimestamp`
- `scopes` (array, from Google's token response)
- `googleEmail` (fetched from `gmail.users.getProfile` or Calendar's `userinfo`)

---

## GET /api/v1/auth/google/status

Returns the current Google connection status for the authenticated user.

**Auth**: Requires `authMiddleware`.

**Success response (connected)**:

```json
HTTP 200
{
  "connected": true,
  "email": "user@gmail.com",
  "scopes": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/calendar.readonly"
  ],
  "connectedAt": "2026-07-26T10:00:00.000Z"
}
```

**Success response (not connected)**:

```json
HTTP 200
{
  "connected": false,
  "authorizeUrl": "/api/v1/auth/google"
}
```

**Error responses**:

| Status | Body | When |
|--------|------|------|
| 500 | `{"error": {"type": "internal_error", "message": "..."}}` | DB read failure |

---

## DELETE /api/v1/auth/google

Revokes the user's Google OAuth token (calls Google's revoke endpoint) and removes the token record from the database.

**Auth**: Requires `authMiddleware`.

**Success response**:

```json
HTTP 200
{
  "disconnected": true
}
```

**Error responses**:

| Status | Body | When |
|--------|------|------|
| 404 | `{"error": {"type": "not_found", "message": "No Google account connected."}}` | User has no token record |
| 500 | `{"error": {"type": "internal_error", "message": "..."}}` | Google revoke API or DB failure |

**Behavior on Google revoke failure**: If Google's revoke endpoint returns an error (e.g., token already revoked), the DB record is still deleted — the disconnect succeeds from the user's perspective.

---

## Tool Error Response (Google Not Connected)

When a Google tool (Gmail or Calendar) is invoked without a connected Google account, it returns a `ToolError` with the following format, which the frontend can parse to show a connect prompt:

```json
{
  "is_error": true,
  "output": "Google account not connected. Visit /api/v1/auth/google to connect your account.",
  "authorizeUrl": "/api/v1/auth/google"
}
```

The `authorizeUrl` field is part of the tool error content string — the frontend parses it to render a clickable "Connect Google" link in the chat bubble (FR-013).
