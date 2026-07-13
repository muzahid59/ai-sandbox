# Contract: Gmail OAuth2 Endpoints

## GET /api/v1/auth/gmail

Initiates the Gmail OAuth2 authorization flow. Redirects the user to Google's consent screen.

**Auth**: Requires `authMiddleware` (uses `req.user.id` for token keying).

**Response**: HTTP 302 redirect to Google OAuth2 consent URL.

**Query Parameters**: None.

**Redirect URL pattern**:
```
https://accounts.google.com/o/oauth2/v2/auth?
  client_id={GOOGLE_CLIENT_ID}&
  redirect_uri=http://localhost:5001/api/v1/auth/gmail/callback&
  response_type=code&
  scope=https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose&
  access_type=offline&
  prompt=consent&
  state={userId}
```

**Error responses**:

| Status | Body | When |
|--------|------|------|
| 500 | `{"error": {"type": "internal_error", "message": "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."}}` | Missing env vars |

---

## GET /api/v1/auth/gmail/callback

Handles the OAuth2 callback from Google. Exchanges authorization code for tokens and stores them.

**Auth**: None (callback from Google, `state` param carries user ID).

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes | Authorization code from Google |
| `state` | string | Yes | User ID passed through OAuth flow |
| `error` | string | No | Error code if user denied access |

**Success response**: HTTP 200 with HTML page confirming authorization.

```html
<html>
<body>
  <h1>Gmail Connected</h1>
  <p>You can close this window and return to the chat.</p>
</body>
</html>
```

**Error responses**:

| Status | Body | When |
|--------|------|------|
| 400 | `{"error": {"type": "bad_request", "message": "Authorization denied by user."}}` | User clicked "Deny" |
| 400 | `{"error": {"type": "bad_request", "message": "Missing authorization code."}}` | No `code` param |
| 500 | `{"error": {"type": "internal_error", "message": "Token exchange failed."}}` | Google API error |

---

## GET /api/v1/auth/gmail/status

Returns the current Gmail connection status for the authenticated user.

**Auth**: Requires `authMiddleware`.

**Success response** (connected):

```json
{
  "connected": true,
  "email": "user@gmail.com",
  "scopes": ["gmail.readonly", "gmail.compose"],
  "connectedAt": "2026-07-12T10:00:00Z"
}
```

**Success response** (not connected):

```json
{
  "connected": false,
  "authorizeUrl": "/api/v1/auth/gmail"
}
```
