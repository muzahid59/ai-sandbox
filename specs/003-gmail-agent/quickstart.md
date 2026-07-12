# Quickstart: Gmail Automation Agent

## Prerequisites

1. **Google Cloud Project** with Gmail API enabled (reuses existing project from Google Calendar setup).
2. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env` (already configured for Calendar).
3. **OAuth redirect URI** registered in Google Cloud Console: `http://localhost:5001/api/v1/auth/gmail/callback`.
4. Docker services running (`docker-compose up`) or local PostgreSQL + SearXNG.

## Setup Steps

### 1. Enable Gmail API

In Google Cloud Console → APIs & Services → Enable "Gmail API" on the existing project.

### 2. Add OAuth Redirect URI

In Google Cloud Console → Credentials → OAuth 2.0 Client → Add authorized redirect URI:
```
http://localhost:5001/api/v1/auth/gmail/callback
```

### 3. Start the Server

```bash
cd backend
npm run dev
```

### 4. Authorize Gmail

Visit in your browser:
```
http://localhost:5001/api/v1/auth/gmail
```

Complete the Google OAuth consent flow. On success, you'll see "Gmail Connected" and can close the tab.

### 5. Use Gmail Tools in Chat

Open the chat UI at `http://localhost:3000` and try:

- "Show me my unread emails"
- "Find emails from john@example.com about the project update"
- "Summarize my inbox"
- "Draft an email to jane@example.com about rescheduling our meeting to Friday"
- "Reply to Sarah's email about the deadline"

## File Map

| File | Purpose |
|------|---------|
| `src/services/emailService.ts` | Gmail API client, OAuth token management, all Gmail operations |
| `src/routes/gmailAuthRoutes.ts` | OAuth2 flow endpoints (initiate, callback, status) |
| `src/tools/readEmails.ts` | `read_emails` tool |
| `src/tools/searchEmails.ts` | `search_emails` tool |
| `src/tools/summarizeEmails.ts` | `summarize_emails` tool |
| `src/tools/draftEmail.ts` | `draft_email` tool |
| `src/tools/replyEmail.ts` | `reply_email` tool |
| `src/tools/index.ts` | Tool registration (add new tools here) |
| `.gmail-tokens.json` | OAuth tokens (gitignored, created on first auth) |

## Verification

Check Gmail connection status:
```bash
curl http://localhost:5001/api/v1/auth/gmail/status
```

Expected (before auth):
```json
{"connected": false, "authorizeUrl": "/api/v1/auth/gmail"}
```

Expected (after auth):
```json
{"connected": true, "email": "you@gmail.com", "scopes": ["gmail.readonly", "gmail.compose"]}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Google OAuth not configured" | Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env` |
| "redirect_uri_mismatch" | Add `http://localhost:5001/api/v1/auth/gmail/callback` in Google Cloud Console |
| "Gmail not connected" error in chat | Visit `http://localhost:5001/api/v1/auth/gmail` to authorize |
| Token refresh fails | User may have revoked access in Google Account settings. Re-authorize. |
| 429 rate limit | Gmail API quota exceeded. Wait a few minutes, or check quota in Cloud Console. |
