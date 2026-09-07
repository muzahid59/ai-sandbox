# Research: Human-in-the-Loop Approval Workflow (008)

## Loop Suspension Mechanism

**Decision**: Detect `requiresApproval: true` in the `ToolDefinition` at execution time inside `runAgenticLoop`. Instead of calling `toolRegistry.execute()`, save a `PendingAction` record, emit an `action_pending` SSE event, and return a suspended result immediately. The SSE stream closes with `stop_reason: "action_pending"`.

**Rationale**: There is no reliable way to truly pause a running async function and resume it from a separate HTTP request while surviving server restarts. The stateless approach (end stream, reconstruct on approval) is simpler, crash-safe, and consistent with the spec clarification that reconstruction from stored context is the correct behaviour.

**Alternatives considered**:
- Deferred promise pattern: create a `Promise` whose resolve function is stored in a Map, resolve it from the approve endpoint. Rejected — dies on server restart and makes the SSE connection dangle indefinitely.
- Job queue (pg-boss): full persistence of the loop state. Deferred to Phase 3.2 (scheduled tasks already plans for pg-boss).

---

## Loop Resumption on Approval

**Decision**: The approve endpoint reconstructs the agentic loop context from durable state only:
1. Load thread → model, systemPrompt
2. Load conversation messages up to and including the assistant message (`messageId`) from DB
3. The assistant message's `content` JSONB already contains the tool_use content blocks (persisted at suspension time)
4. Execute the tool via `toolRegistry.execute()`
5. Append tool_result as user message
6. Run one AI call (single iteration of the agentic loop) → stream response

**Key requirement**: At suspension time, the agentic loop must persist the assistant message's content blocks (including the tool_use block) to the DB before ending the SSE stream. This is a new step not currently in `handleSendMessage`.

**Rationale**: All required context already exists in the DB schema. No additional `PendingAction` fields needed. The approve endpoint becomes an SSE endpoint analogous to `handleSendMessage`.

---

## Background Expiry

**Decision**: A `setInterval` registered at server startup checks for expired pending actions every 60 seconds. For each expired action:
1. Transition status from `pending` to `expired`
2. Create a new assistant message in the thread: "The pending action expired before you responded. Please let me know how you'd like to proceed."
3. Log the expiry event via pino

**Rationale**: pg-boss (Postgres-backed job queue) is the right tool but is deferred to Phase 3.2 (scheduled tasks). A `setInterval` is sufficient for the 10-minute expiry window — worst case, an action expires up to 60 seconds late. No additional dependencies needed.

**Note**: The `setInterval` timer is lost on server restart. On restart, the expiry check runs within the first 60 seconds and catches any overdue pending actions. Effective TTL is therefore `expiresAt + up to 60s`.

---

## Per-Thread Approval Lock

**Decision**: Before starting a new agentic loop for a thread, check for an existing `pending` PendingAction on that thread. If one exists, reject the new message with `409 APPROVAL_PENDING` error and a user-readable message: "Please approve or reject the pending action above before sending a new message."

**Frontend implication**: The chat input is disabled client-side (FR5/FR2) when a pending action exists. The 409 is a server-side safety net for race conditions (e.g., two tabs open).

---

## SSE Architecture for Approve/Reject

**Decision**: Both `POST /api/v1/actions/:id/approve` and `POST /api/v1/actions/:id/reject` are SSE endpoints. They stream the AI's response back to the client exactly like `handleSendMessage`.

**Approve flow SSE events**:
```
data: {"type": "tool_use_result", "tool_call_id": "...", "name": "send_email", "success": true, "output": "..."}
data: {"type": "delta", "text": "I've sent the email to Sarah..."}
data: {"type": "done", "msg_id": "...", "stop_reason": "end_turn"}
```

**Reject flow SSE events**:
```
data: {"type": "delta", "text": "I've cancelled that action..."}
data: {"type": "done", "msg_id": "...", "stop_reason": "end_turn"}
```

**Rationale**: SSE for both gives the AI a chance to respond naturally. The client reuses its existing streaming handler. No new transport needed.

---

## Thread Response Includes Pending Action

**Decision**: `GET /api/v1/threads/:id` response includes a `pendingAction` field:
```json
{
  "pendingAction": {
    "id": "...",
    "toolName": "send_email",
    "arguments": { "to": "sarah@example.com", "subject": "..." },
    "status": "pending",
    "expiresAt": "2026-09-07T10:15:00Z"
  }
}
```
Returns `null` if no pending action exists.

**Rationale**: Enables the frontend to restore the approval card state on page reload without a separate API call. The thread response is already loaded when the user enters a thread.

---

## Tool Definition Flag

**Decision**: Add `requiresApproval?: boolean` to the `ToolDefinition` interface in `backend/src/types/index.ts`. Default is `false` (undefined treated as false). The `toolExecutor.ts` checks this flag before executing each tool call.

**Tool registration format**:
```typescript
export const definition: ToolDefinition = {
  name: 'send_email',
  description: '...',
  input_schema: { ... },
  requiresApproval: true,  // ← new field
};
```

---

## Stub Test Tool

**Decision**: Create `backend/src/tools/testApproval.ts` with `requiresApproval: true`. The handler echoes its `message` argument back. Registered in `backend/src/tools/index.ts` only (no real integration needed). Used during development to test the full approval workflow without a live email/calendar integration.

---

## Approval Card Positioning

**Decision**: The approval card is rendered as a standalone UI element inserted after the assistant message identified by `PendingAction.messageId`. It is not embedded inside a message bubble. The `ApprovalCard` component lives in `app/src/components/ApprovalCard/`. It is conditionally rendered in `MessageList` when `thread.pendingAction` is non-null.

---

## Human-Readable Argument Formatting

**Decision**: The `ApprovalCard` component formats arguments as key-value pairs using a per-tool display config. For unknown tools, it falls back to a formatted JSON display. Per-tool display names:
- `send_email` → "Send email"
- `delete_calendar_event` → "Delete calendar event"
- `create_calendar_event` → "Create calendar event"
- `test_approval` → "Test approval"
- Default: toolName (snake_case as-is)

Argument keys use title-case labels: `to` → "To", `subject` → "Subject", `body` → "Body", `message` → "Message".
