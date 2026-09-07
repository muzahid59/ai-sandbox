# Quickstart: Human-in-the-Loop Approval Workflow (008)

## Prerequisites

- Docker running with all services (`docker-compose up`)
- OR local PostgreSQL on port 5433 with `backend/.env` configured
- `OPENAI_API_KEY` set in `backend/.env`

## Setup

### 1. Run the database migration

```bash
cd backend
npx prisma migrate dev --name add-pending-actions
npx prisma generate
```

### 2. Start the backend

```bash
cd backend
npm run dev
```

### 3. Start the frontend

```bash
cd app
npm start
```

## Testing the Approval Workflow

The `test_approval` stub tool is registered in development. It requires approval and has no real side effects — it just echoes its `message` argument back.

### Manual test via chat

1. Open a thread in the chat UI.
2. Send a message: **"Use the test approval tool with message 'hello world'"**
3. The AI will call `test_approval`. Instead of executing, the chat input disables and an approval card appears showing:
   - Action: "Test approval"
   - Message: "hello world"
   - Approve / Reject buttons
4. Click **Approve** — the tool executes, the card updates to "Approved", and the AI streams a confirmation.
5. Click **Reject** instead — the card updates to "Rejected" and the AI acknowledges the cancellation.

### Test timeout (reduce TTL for dev)

Set `PENDING_ACTION_TTL_SECONDS=60` in `backend/.env` to use a 1-minute timeout instead of 10 minutes. The background expiry check runs every 60 seconds.

### Test page-reload persistence

1. Trigger an approval card (steps 1-3 above).
2. Refresh the browser.
3. Return to the thread — the approval card re-appears in pending state.

### Test 409 lock

1. Trigger an approval card.
2. Open the browser console and run:
   ```js
   fetch('/api/v1/threads/{threadId}/messages', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', Authorization: 'Bearer {token}' },
     body: JSON.stringify({ content: [{ type: 'text', text: 'hello' }] })
   }).then(r => r.json()).then(console.log)
   ```
3. Expect: `{ code: "APPROVAL_PENDING", message: "Please approve or reject the pending action before sending a new message." }`

## Postman

Import `docs/postman/chat-thread-api.postman_collection.json` for the new approval endpoints:
- `POST /api/v1/actions/:id/approve` (SSE)
- `POST /api/v1/actions/:id/reject` (SSE)
- `GET /api/v1/actions/:id`

## Adding a Real Approval-Required Tool

When `send_email` is implemented in Phase 4.2, add `requiresApproval: true` to its definition:

```typescript
// backend/src/tools/sendEmail.ts
export const definition: ToolDefinition = {
  name: 'send_email',
  description: '...',
  input_schema: { ... },
  requiresApproval: true,
};
```

No other changes required — the framework picks up the flag automatically.
