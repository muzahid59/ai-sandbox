# Implementation Plan: Human-in-the-Loop Approval Workflow (008)

**Feature ID**: 008
**Status**: Ready for task generation
**Created**: 2026-09-07
**Spec**: [spec.md](spec.md)

---

## Technical Context

### Current Architecture

- **Backend**: Express.js + TypeScript (`backend/src/`), Prisma ORM v5.22.0, PostgreSQL 16
- **Frontend**: React 18 + TypeScript (`app/src/`), CSS Modules, prop-drilling state management
- **AI Integration**: Multi-provider via `ai_factory.js` (OpenAI, Google, DeepSeek, Ollama)
- **Tool System**: `ToolRegistry` singleton (`backend/src/services/toolRegistry.ts`), `ToolDefinition` interface (`backend/src/types/index.ts`), `runAgenticLoop` function (`backend/src/services/toolExecutor.ts`)
- **SSE Streaming**: `SSEWriter` utility, event types: `message_created`, `delta`, `tool_use_start`, `tool_use_result`, `done`, `error`
- **Auth**: JWT-based via `backend/src/middleware/auth.ts`, `req.user` injected on all `/api/v1` routes
- **Message Flow**: `handleSendMessage` → `processMessage` (chatService) → `runAgenticLoop` (toolExecutor)

### Key Integration Points

| Integration Point | File | What Changes |
|---|---|---|
| Tool definition type | `backend/src/types/index.ts` | Add `requiresApproval?: boolean` to `ToolDefinition` |
| Agentic loop | `backend/src/services/toolExecutor.ts` | Detect `requiresApproval`, save PendingAction, return suspended result |
| Message controller | `backend/src/controllers/messageController.ts` | Handle suspended result; emit `action_pending` SSE; update assistant message with tool_use blocks; block new messages when pending action exists |
| Thread controller | `backend/src/controllers/threadController.ts` | Include `pendingAction` in thread response |
| Prisma schema | `backend/prisma/schema.prisma` | Add `PendingAction` model, `PendingActionStatus` enum, relations |
| New service | `backend/src/services/pendingActionService.ts` | CRUD + lock check + expiry logic |
| New controller | `backend/src/controllers/actionController.ts` | Approve + reject SSE handlers |
| New routes | `backend/src/routes/actionRoutes.ts` | POST approve, POST reject, GET action |
| New tool | `backend/src/tools/testApproval.ts` | Stub `requiresApproval: true` tool |
| Tool registry | `backend/src/tools/index.ts` | Register `test_approval` |
| Server startup | `backend/src/server.ts` | Register expiry interval + action routes |
| SSE writer | `backend/src/sse/sseWriter.ts` | Add `sendActionPending()` method |
| Frontend API client | `app/src/api.ts` | `approveAction()`, `rejectAction()` (SSE), `getThread` response type update |
| Frontend types | `app/src/types/index.ts` + `shared/types/` | `PendingAction` type, `action_pending` SSE event type |
| Frontend state | `app/src/App.tsx` | `pendingAction` per thread in thread state |
| New component | `app/src/components/ApprovalCard/` | `ApprovalCard.tsx` + `.module.css` |
| Message list | `app/src/components/MessageList/MessageList.tsx` | Insert `ApprovalCard` after the triggering message |
| Chat input | `app/src/components/ChatInput/ChatInput.tsx` | Disable when `pendingAction` is pending |

### Dependencies Introduced

None. No new npm packages required.

---

## Constitution Check

### I. Code Quality (NON-NEGOTIABLE)
- ✅ All new code in TypeScript under `backend/src/`
- ✅ Single responsibility: `pendingActionService` (CRUD), `actionController` (HTTP), `toolExecutor` (loop logic), `ApprovalCard` (UI)
- ✅ Structured pino logging for all approval lifecycle events (created, approved, rejected, expired)
- ✅ No dead code

### II. Testing Standards
- ✅ Unit tests for `pendingActionService` (CRUD, lock check, expiry transition)
- ✅ Integration tests for all three action endpoints (approve, reject, GET)
- ✅ Integration test for 409 when pending action exists on message send
- ✅ SSE sequence tests for approve and reject flows
- ✅ Frontend component tests for `ApprovalCard` (renders arguments, buttons disable on resolve, status badges)
- ✅ Tests for loop suspension in `toolExecutor` (mock `requiresApproval` tool, assert PendingAction created + loop returns suspended)

### III. User Experience Consistency
- ✅ Approve/Reject buttons show loading state while processing
- ✅ Chat input disabled with explanatory message while pending action exists
- ✅ Approval card status badge updates immediately on action (Pending → Approved/Rejected/Expired)
- ✅ CSS Modules for `ApprovalCard`
- ✅ All interactive elements keyboard-navigable with ARIA labels
- ✅ Non-technical error messages for all failure states

### IV. Performance Requirements
- ✅ Pending action creation adds <5ms to the existing message flow (one DB insert)
- ✅ Approve/reject endpoints meet the 3-second first-delta target (tool execution + AI call)
- ✅ No impact on existing tool paths — `requiresApproval` check is a short-circuit before `toolRegistry.execute()`
- ✅ Expiry scan is a lightweight indexed query (expiresAt index), runs every 60s

### Quality Gates
- ✅ Lint, Type, Test, Coverage gates enforced
- ✅ No SSRF risk — tool arguments are not used as URLs in this feature
- ✅ Authorization enforced: userId checked before approve/reject; cross-user access returns 404 (not 403) to avoid leaking existence

---

## Phase 0: Research (Complete)

All unknowns resolved in [research.md](research.md):
- Loop suspension: detect `requiresApproval`, save PendingAction, return suspended result, close SSE with `stop_reason: "action_pending"`
- Loop resumption: approve endpoint reconstructs context from DB (thread history + assistant message content blocks + tool_result), runs one AI call
- Background expiry: `setInterval` every 60s (pg-boss deferred to Phase 3.2)
- Per-thread lock: 409 `APPROVAL_PENDING` if existing pending action on thread
- SSE for approve/reject: both endpoints stream the AI's response
- Thread response: includes `pendingAction` field for reload persistence
- Tool definition flag: `requiresApproval?: boolean` on `ToolDefinition`
- Stub test tool: `test_approval` with no side effects

---

## Phase 1: Design & Contracts (Complete)

- [data-model.md](data-model.md) — `PendingAction` entity, `PendingActionStatus` enum, Prisma schema, state machine
- [contracts/api.md](contracts/api.md) — approve/reject/get endpoints, modified thread endpoint, new SSE event types, updated TypeScript interfaces
- [quickstart.md](quickstart.md) — dev setup, manual test steps, TTL override

---

## Implementation Sequence

### Backend (dependency order)

1. **Schema** — Add `PendingAction` model + enum + relations to `schema.prisma`, run migration
2. **Types** — Add `requiresApproval` to `ToolDefinition`; add `PendingAction` + `action_pending` SSE types to `shared/types/`
3. **Service** — `pendingActionService.ts`: `createPendingAction`, `getPendingAction`, `getThreadPendingAction`, `resolvePendingAction` (approve/reject/expire), `expireOverdue`
4. **Tool executor** — Modify `runAgenticLoop` to detect `requiresApproval`, call `createPendingAction`, call `onApprovalRequired` callback, return suspended result
5. **SSE writer** — Add `sendActionPending()` method
6. **Message controller** — Handle `suspended` result from `runAgenticLoop`; emit `action_pending`; update assistant message with tool_use content blocks; add 409 guard at message send
7. **Thread controller** — Include `pendingAction` in `GET /api/v1/threads/:id` response
8. **Test tool** — `testApproval.ts` + register in `index.ts`
9. **Action controller** — `approveAction` (SSE): load PendingAction, execute tool, reconstruct context, run AI call, stream; `rejectAction` (SSE): mark rejected, run AI acknowledgement, stream
10. **Action routes** — Mount under `/api/v1/actions`; register in `server.ts` with auth middleware
11. **Expiry** — Register `setInterval` in `server.ts` startup
12. **Tests** — Unit + integration + SSE tests

### Frontend (dependency order)

13. **Shared types** — `PendingAction` interface, `action_pending` SSE event type in `shared/types/`
14. **API client** — `approveAction(actionId)`, `rejectAction(actionId)` in `api.ts` (SSE streaming); update `getThread` return type
15. **App state** — Thread objects carry `pendingAction: PendingAction | null`; update state on `action_pending` SSE event
16. **ApprovalCard** — `ApprovalCard.tsx` + `ApprovalCard.module.css`: renders arguments, Approve/Reject buttons, status badge, loading states
17. **MessageList** — Insert `ApprovalCard` after the message with `id === pendingAction.messageId`
18. **ChatInput** — Disable input + show hint message when `pendingAction?.status === 'pending'`
19. **Frontend tests** — `ApprovalCard.test.tsx`
20. **Postman** — Update collection with new endpoints
