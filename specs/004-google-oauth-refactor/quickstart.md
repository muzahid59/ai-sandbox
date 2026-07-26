# Quickstart: Google OAuth Refactor

## Prerequisites

1. **Google Cloud Project** with Gmail API and Google Calendar API both enabled.
2. **OAuth Credentials** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) in `backend/.env`.
3. **Redirect URI** registered in Google Cloud Console: `http://localhost:5001/api/v1/auth/google/callback`.
4. **Encryption key** — generate `TOKEN_ENCRYPTION_KEY` (see Step 2 below).
5. Docker services running (`docker-compose up`) **or** local PostgreSQL + SearXNG.

---

## Setup Steps

### 1. Configure Google Cloud Console

In [Google Cloud Console](https://console.cloud.google.com):

1. Enable **Gmail API**: APIs & Services → Library → Search "Gmail API" → Enable.
2. Enable **Google Calendar API**: APIs & Services → Library → Search "Google Calendar API" → Enable.
3. Update **OAuth 2.0 Client**:
   - Go to APIs & Services → Credentials → your OAuth 2.0 Client ID.
   - Under "Authorized redirect URIs", add:
     ```
     http://localhost:5001/api/v1/auth/google/callback
     ```
   - Remove the old Gmail callback URI if present: `http://localhost:5001/api/v1/auth/gmail/callback`.

### 2. Generate Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output (64 hex characters) and add to `backend/.env`:

```env
TOKEN_ENCRYPTION_KEY=<your-64-char-hex-key>
```

### 3. Update backend/.env

Remove the legacy env var (no longer used):
```env
# REMOVE THIS LINE:
# GOOGLE_REFRESH_TOKEN=...
```

Add the new encryption key and verify these are present:
```env
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
TOKEN_ENCRYPTION_KEY=<your-64-char-hex-key>
```

### 4. Run Database Migration

```bash
cd backend
npx prisma migrate dev --name add-user-and-google-oauth-token
npx prisma db seed        # Seeds the dev user (id: 00000000-0000-0000-0000-000000000001)
```

### 5. Start the Server

```bash
cd backend
npm run dev
```

### 6. Connect Google Account

Open in your browser:
```
http://localhost:5001/api/v1/auth/google
```

Complete the Google OAuth consent flow (both Gmail and Calendar scopes). On success, you'll be redirected to:
```
http://localhost:3000?google=connected
```

The frontend will show a toast notification confirming the connection.

### 7. Verify Connection

```bash
curl http://localhost:5001/api/v1/auth/google/status
```

Expected (after auth):
```json
{
  "connected": true,
  "email": "you@gmail.com",
  "scopes": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/calendar.readonly"
  ],
  "connectedAt": "2026-07-26T10:00:00.000Z"
}
```

### 8. Use Google Tools in Chat

Open the chat UI at `http://localhost:3000` and try:

**Gmail tools**:
- "Show me my unread emails"
- "Search for emails from boss@example.com"
- "Draft an email to jane@example.com about Friday's meeting"

**Calendar tools**:
- "What's on my calendar today?"
- "Find any events next week"

---

## File Map

| File | Purpose |
|------|---------|
| `src/services/googleAuthService.ts` | Unified Google OAuth — token storage, retrieval, refresh, revocation |
| `src/routes/googleAuthRoutes.ts` | OAuth2 endpoints (initiate, callback, status, disconnect) |
| `src/types/context.ts` | `ToolExecutionContext` interface |
| `src/types/google.ts` | `GoogleConnectionStatus` and other Google-specific types |
| `src/tools/googleCalendar.ts` | Updated to use `googleAuthService.getAuthClient(context.userId)` |
| `src/tools/readEmails.ts` | Updated to use `context.userId` (no more hardcoded ID) |
| `src/tools/searchEmails.ts` | Updated to use `context.userId` |
| `src/tools/draftEmail.ts` | Updated to use `context.userId` |
| `src/tools/replyEmail.ts` | Updated to use `context.userId` |
| `src/tools/summarizeEmails.ts` | Updated to use `context.userId` |
| `src/services/toolRegistry.ts` | Updated: `execute(name, input, context)` |
| `src/services/toolExecutor.ts` | Updated: `runAgenticLoop(... context)` |
| `src/services/chatService.ts` | Updated: `processMessage(... userId)` |
| `src/controllers/messageController.ts` | Updated: passes `req.user!.id` to `processMessage` |
| `prisma/schema.prisma` | New `User` + `GoogleOAuthToken` models |
| `prisma/seed.ts` | Seeds dev user |
| `app/src/components/GoogleConnection/` | Frontend connect/disconnect UI |

## Removed Files / Config

| Removed | Reason |
|---------|--------|
| `backend/.gmail-tokens.json` | Replaced by database-backed `google_oauth_tokens` table |
| `src/routes/gmailAuthRoutes.ts` | Replaced by `googleAuthRoutes.ts` |
| `GOOGLE_REFRESH_TOKEN` env var | Calendar tool now reads from DB via `googleAuthService` |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Google OAuth not configured" | Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env` |
| "redirect_uri_mismatch" | Add `http://localhost:5001/api/v1/auth/google/callback` in Google Cloud Console |
| "TOKEN_ENCRYPTION_KEY not set" | Generate a 64-char hex key and add to `backend/.env` |
| "Google account not connected" in chat | Visit `http://localhost:5001/api/v1/auth/google` to authorize |
| "Your Google connection has expired. Please reconnect" | User revoked access in Google settings — reconnect via UI |
| Migration fails with FK violation | Run `npx prisma db seed` before testing to ensure dev user exists |
| Token refresh fails after server restart | Tokens are in DB — restart does not clear them. Check that `TOKEN_ENCRYPTION_KEY` matches what was used when tokens were stored |
