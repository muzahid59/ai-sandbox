# Conversational Gmail Authentication Flow

## Problem

When Gmail/Calendar tools are invoked without authentication, they throw a `ToolError` with a raw URL. The AI relays a generic error message, the user must manually copy-paste `http://localhost:5001/api/v1/auth/gmail` into a browser, complete Google consent, return to the app, and re-ask their question from scratch. There is no in-app guidance and no natural resume path.

## Solution

Change tool handlers to return a **successful tool result** (not an error) containing structured auth-needed instructions when Gmail is not connected. The AI model reads this result and responds conversationally — presenting the auth URL as a clickable link and asking the user to confirm when done. The user authenticates, says "done," and the AI retries the tool naturally in its next turn.

No frontend changes. No new endpoints. No agentic loop modifications.

## End-to-End Flow

1. User: "Check my unread emails"
2. AI calls `read_emails` tool
3. Tool detects `emailService.isConnected(userId)` is false
4. Tool returns (success, not error):
   ```
   ACTION_REQUIRED: Gmail is not connected.

   To access your emails, you need to connect your Gmail account.
   Authorization URL: http://localhost:5001/api/v1/auth/gmail

   Open the link above in your browser, sign in with Google, and grant access.
   Then let me know when you're done so I can proceed with your request.
   ```
5. AI responds conversationally: "I need access to your Gmail to do that. Please open this link to connect: http://localhost:5001/api/v1/auth/gmail — let me know when you're done!"
6. User opens URL, completes Google OAuth consent, sees "Gmail Connected" confirmation page
7. User returns to chat: "done"
8. AI retries `read_emails` tool — tokens now exist, tool succeeds
9. AI displays the email results

## Architecture

### What changes

**1. `emailService.ts` — Add `AuthRequiredError` and `buildAuthRequiredMessage()`**

```typescript
export class AuthRequiredError extends Error {
  constructor() {
    super('Gmail not connected');
    this.name = 'AuthRequiredError';
  }
}
```

The auth URL is the backend's own endpoint (`http://localhost:5001/api/v1/auth/gmail`), not a direct Google URL. The backend already handles the redirect to Google's consent screen. This keeps the tool output stable (no dynamic query params) and preserves the existing OAuth architecture.

Update `getAuthClient()` to throw `AuthRequiredError` instead of a generic `Error` when tokens are missing or expired-and-removed.

**2. All 6 tool handlers — Return auth result instead of throwing**

Each tool has the same pattern today:

```typescript
// Before (throws error)
if (!emailService.isConnected(userId)) {
  throw new ToolError('Gmail not connected. Visit http://localhost:5001/api/v1/auth/gmail to authorize.');
}
```

Replace with:

```typescript
// After (returns instructional result)
if (!emailService.isConnected(userId)) {
  return emailService.buildAuthRequiredMessage();
}
```

And in the catch block, handle `AuthRequiredError` (for mid-call token expiry):

```typescript
catch (err: any) {
  if (err instanceof AuthRequiredError) {
    return emailService.buildAuthRequiredMessage();
  }
  // ... existing error handling
}
```

**3. `emailService.ts` — Add `buildAuthRequiredMessage()` helper**

Centralizes the auth-needed message so all 6 tools return identical, well-structured text:

```typescript
buildAuthRequiredMessage(): string {
  const authUrl = 'http://localhost:5001/api/v1/auth/gmail';
  return [
    'ACTION_REQUIRED: Gmail is not connected.',
    '',
    'To access your emails and calendar, you need to connect your Google account.',
    `Authorization URL: ${authUrl}`,
    '',
    'Open the link above in your browser, sign in with Google, and grant access.',
    'Then let me know when you\'re done so I can proceed with your request.',
  ].join('\n');
}
```

### Why return a success result, not an error?

- `ToolError` results are marked as `is_error: true` in the tool result blocks. The AI model treats errors as failures and tends to apologize rather than guide the user.
- A successful result with clear instructions is treated as actionable information. The AI reads the instructions and follows them — presenting the URL conversationally and asking the user to confirm.
- The `ACTION_REQUIRED:` prefix gives the AI a clear signal that this is not normal output but requires user action.

### Files to modify

| File | Change |
|------|--------|
| `backend/src/services/emailService.ts` | Add `AuthRequiredError`, `buildAuthRequiredMessage()`. Update `getAuthClient()` to throw `AuthRequiredError`. |
| `backend/src/tools/readEmails.ts` | Return auth message instead of throwing `ToolError` |
| `backend/src/tools/searchEmails.ts` | Same |
| `backend/src/tools/summarizeEmails.ts` | Same |
| `backend/src/tools/draftEmail.ts` | Same |
| `backend/src/tools/replyEmail.ts` | Same |
| `backend/src/tools/googleCalendar.ts` | Same |

### Files NOT modified

- `backend/src/services/toolExecutor.ts` — agentic loop unchanged
- `backend/src/routes/gmailAuthRoutes.ts` — OAuth endpoints unchanged
- `backend/src/errors/index.ts` — `ToolError` class unchanged
- Frontend (`app/`) — no changes needed

## Testing

- **Unit tests**: Verify each tool returns the auth message string (not a `ToolError`) when `isConnected()` returns false.
- **Integration test**: Call `POST /api/v1/threads/:id/messages` with a message like "check my emails" without Gmail tokens. Verify the SSE stream contains a `tool_use_result` with `success: true` and the auth message text, followed by the AI's conversational response with the auth link.
- **Manual E2E**: Start the app, ask "read my emails" in chat, verify the AI shows the auth link, complete OAuth, say "done", verify the AI retries and shows emails.

## Scope boundaries

- This design does NOT add real user authentication (login/signup). The hardcoded dev user remains.
- This design does NOT add a settings/integrations UI. Connection management stays conversational.
- This design does NOT add a disconnect flow. Token revocation can be added later.
- The auth URL is the backend's `/api/v1/auth/gmail` endpoint, which redirects to Google. It is not a direct Google URL — this preserves the existing architecture.
