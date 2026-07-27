# Auth API Endpoints Contract

**Base path**: `/api/v1/auth`

Auth endpoints are mounted **before** `authMiddleware` — they issue tokens and do not require a pre-existing valid token. The `POST /auth/refresh` and `POST /auth/logout` endpoints rely on the `refreshToken` httpOnly cookie rather than an `Authorization` header.

---

## POST /api/v1/auth/register

Register a new user account. Immediately returns auth tokens on success.

### Request

```
POST /api/v1/auth/register
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Validation** (enforced both client-side and server-side):

| Field | Rule |
|-------|------|
| `email` | Valid email format; normalised to lowercase |
| `password` | 8–1024 characters |

### Success Response — 201 Created

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com"
  }
}
```

**Set-Cookie**: `refreshToken=<hex64>; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`

### Error Responses

| Status | `error.type` | Condition |
|--------|-------------|-----------|
| 400 | `validation_error` | Invalid email format or password violates length rule |
| 409 | `email_taken` | Email already registered |

```json
{
  "error": {
    "type": "email_taken",
    "message": "An account with this email already exists"
  }
}
```

---

## POST /api/v1/auth/login

Authenticate with email and password.

### Request

```
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

### Success Response — 200 OK

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com"
  }
}
```

**Set-Cookie**: `refreshToken=<hex64>; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`

### Error Responses

| Status | `error.type` | Condition |
|--------|-------------|-----------|
| 400 | `validation_error` | Missing or malformed request body |
| 401 | `invalid_credentials` | Wrong email or wrong password (identical error — no user enumeration) |

```json
{
  "error": {
    "type": "invalid_credentials",
    "message": "Invalid email or password"
  }
}
```

---

## POST /api/v1/auth/refresh

Exchange a valid refresh token (httpOnly cookie) for a new access token.

### Request

No body required. The refresh token is read from the `refreshToken` cookie automatically.

```
POST /api/v1/auth/refresh
Cookie: refreshToken=<hex64>
```

### Success Response — 200 OK

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Error Responses

| Status | `error.type` | Condition |
|--------|-------------|-----------|
| 401 | `invalid_token` | No cookie present, token not found in DB, expired, or revoked |

```json
{
  "error": {
    "type": "invalid_token",
    "message": "Your session has expired, please log in again"
  }
}
```

---

## POST /api/v1/auth/logout

Revoke the current session's refresh token. **Fail-open**: always returns 200 and clears the cookie, even if the token is missing or already revoked (per spec User Story 4, scenario 4).

### Request

No body required. The refresh token is read from the `refreshToken` cookie.

```
POST /api/v1/auth/logout
Cookie: refreshToken=<hex64>
```

### Success Response — 200 OK

```json
{ "loggedOut": true }
```

**Set-Cookie**: `refreshToken=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`

---

## Protected Route Error Format

All `/api/v1` routes except auth endpoints return 401 when the request lacks a valid access token.

### Conditions That Return 401

- `Authorization` header missing
- Token format is not `Bearer <token>`
- Token signature is invalid (tampered)
- Token is expired

### Error Body

```json
{
  "error": {
    "type": "unauthorized",
    "message": "Authentication required"
  }
}
```

---

## Cookie Specification

| Property | Value |
|----------|-------|
| Name | `refreshToken` |
| HttpOnly | `true` — JavaScript cannot read it |
| SameSite | `Strict` — only sent on same-site requests (CSRF protection) |
| Path | `/` |
| Secure | `true` in production, `false` in development |
| MaxAge | `2592000` seconds (30 days) |
| Cleared on logout | `Max-Age=0` |
