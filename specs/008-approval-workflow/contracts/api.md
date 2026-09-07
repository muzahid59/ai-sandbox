# API Contracts: Human-in-the-Loop Approval Workflow (008)

## New Endpoints

### POST /api/v1/actions/:id/approve

Approves a pending action, executes the tool, and streams the AI's follow-up response.

**Auth**: Bearer JWT (existing auth middleware)

**Path params**: `id` — PendingAction UUID

**Request body**: empty

**Response**: SSE stream (`Content-Type: text/event-stream`)

**Success SSE sequence**:
```
data: {"type": "tool_use_result", "tool_call_id": "abc123", "name": "send_email", "success": true, "output": "Email sent successfully"}
data: {"type": "delta", "text": "I've sent the email to Sarah confirming your 3pm meeting.", "msg_id": "msg_456"}
data: {"type": "done", "msg_id": "msg_456", "stop_reason": "end_turn", "tool_calls_count": 1}
```

**Error responses (JSON)**:

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `ACTION_NOT_FOUND` | PendingAction not found or not owned by user |
| 409 | `ACTION_ALREADY_RESOLVED` | Action is already approved, rejected, or expired |
| 410 | `ACTION_EXPIRED` | Action's `expiresAt` is in the past |
| 500 | `INTERNAL_ERROR` | Tool execution or AI call failed |

---

### POST /api/v1/actions/:id/reject

Rejects a pending action and streams the AI's cancellation acknowledgement.

**Auth**: Bearer JWT

**Path params**: `id` — PendingAction UUID

**Request body**: empty (binary reject — no reason field)

**Response**: SSE stream (`Content-Type: text/event-stream`)

**Success SSE sequence**:
```
data: {"type": "delta", "text": "I've cancelled that action. Let me know how you'd like to proceed.", "msg_id": "msg_789"}
data: {"type": "done", "msg_id": "msg_789", "stop_reason": "end_turn", "tool_calls_count": 0}
```

**Error responses (JSON)**:

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `ACTION_NOT_FOUND` | PendingAction not found or not owned by user |
| 409 | `ACTION_ALREADY_RESOLVED` | Action is already approved, rejected, or expired |

---

### GET /api/v1/actions/:id

Fetches a single pending action by ID (for polling / status check).

**Auth**: Bearer JWT

**Response**: `200 OK`
```json
{
  "id": "pa_uuid",
  "threadId": "thread_uuid",
  "toolName": "send_email",
  "arguments": {
    "to": "sarah@example.com",
    "subject": "Confirming 3pm meeting",
    "body": "Hi Sarah..."
  },
  "status": "pending",
  "expiresAt": "2026-09-07T10:15:00Z",
  "resolvedAt": null,
  "createdAt": "2026-09-07T10:05:00Z"
}
```

**Error**:

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `ACTION_NOT_FOUND` | Not found or not owned by user |

---

## Modified Endpoints

### GET /api/v1/threads/:id

Response gains `pendingAction` field:

```json
{
  "id": "thread_uuid",
  "title": "My Thread",
  "model": "gpt-4o",
  "status": "active",
  "pendingAction": {
    "id": "pa_uuid",
    "toolName": "send_email",
    "arguments": {
      "to": "sarah@example.com",
      "subject": "Confirming 3pm meeting",
      "body": "Hi Sarah, just confirming our 3pm meeting today."
    },
    "status": "pending",
    "expiresAt": "2026-09-07T10:15:00Z"
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

Returns `"pendingAction": null` when no pending action exists.

---

### POST /api/v1/threads/:id/messages

When a thread has an existing `pending` PendingAction, this endpoint now returns:

```json
HTTP 409 Conflict
{
  "code": "APPROVAL_PENDING",
  "message": "Please approve or reject the pending action before sending a new message."
}
```

---

## New SSE Event Types

### action_pending

Emitted when the agentic loop suspends waiting for approval. Sent before the `done` event.

```json
{
  "type": "action_pending",
  "action_id": "pa_uuid",
  "tool_name": "send_email",
  "arguments": {
    "to": "sarah@example.com",
    "subject": "Confirming 3pm meeting",
    "body": "Hi Sarah, just confirming our 3pm meeting today."
  },
  "expires_at": "2026-09-07T10:15:00Z"
}
```

### done (updated stop_reason)

When the loop suspends for approval, the `done` event uses a new `stop_reason`:

```json
{
  "type": "done",
  "msg_id": "assistant_msg_uuid",
  "stop_reason": "action_pending",
  "tool_calls_count": 0
}
```

---

## AgenticLoopResult (TypeScript — updated)

```typescript
interface AgenticLoopResult {
  finalText: string;
  toolCallRecords: ToolCallRecord[];
  suspended?: {
    pendingActionId: string;
    toolCall: ToolCall;
  };
}
```

When `suspended` is set, `finalText` is empty or contains any pre-tool text. The message controller checks for `suspended` and emits `action_pending` + `done` with `stop_reason: "action_pending"` instead of the normal `done`.

---

## AgenticLoopCallbacks (TypeScript — updated)

```typescript
interface AgenticLoopCallbacks {
  onDelta: (text: string) => void;
  onToolUseStart: (call: ToolCall) => void;
  onToolUseResult: (callId: string, name: string, result: ToolResult) => void;
  onApprovalRequired?: (pendingAction: { id: string; toolCall: ToolCall; expiresAt: Date }) => void;
}
```
