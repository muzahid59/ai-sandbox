# Tasks: Human-in-the-Loop Approval Workflow (008)

**Feature**: Human-in-the-Loop Approval Workflow
**Spec**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)
**Generated**: 2026-09-07

---

## User Stories (from spec.md)

| ID  | Story | Priority |
|-----|-------|----------|
| US1 | AI calls an approval-required tool → loop suspends, approval card appears | P1 |
| US2 | User approves → tool executes, AI streams follow-up | P1 |
| US3 | User rejects → action cancelled, AI acknowledges | P1 |
| US4 | Pending approval survives page reload | P2 |
| US5 | Pending actions auto-expire after 10 minutes | P2 |
| US6 | Non-flagged tools execute without approval (no regression) | P1 |
| US7 | Already-resolved action cannot be acted on again (idempotency) | P2 |

---

## Phase 1: Setup

- [X] T001 Add `PendingActionStatus` enum and `PendingAction` model to `backend/prisma/schema.prisma`
- [X] T002 Add `pendingActions` relation to `Thread` model in `backend/prisma/schema.prisma`
- [X] T003 Add `pendingAction` relation to `Message` model in `backend/prisma/schema.prisma`
- [X] T004 Add `pendingActions` relation to `User` model in `backend/prisma/schema.prisma`
- [X] T005 Run `npx prisma migrate dev --name add-pending-actions` and `npx prisma generate` in `backend/`

---

## Phase 2: Foundational (blocking prerequisites for all user stories)

- [X] T006 [P] Add `requiresApproval?: boolean` to `ToolDefinition` interface in `backend/src/types/index.ts`
- [X] T007 [P] Add `PendingAction` type to `shared/types/index.ts` (id, threadId, userId, messageId, toolName, toolCallId (optional — backend-only, not returned by API), arguments, status, expiresAt, resolvedAt, createdAt); include userId for reference and audit purposes; server enforces authorization
- [X] T008 [P] Add `action_pending` SSE event type and `ActionPendingEvent` interface to `shared/types/events.ts` (use `msg_id` field name to match existing SSE convention)
- [X] T009 [P] Add `suspended` field to `AgenticLoopResult` interface in `backend/src/types/index.ts`
- [X] T010 [P] Add `onApprovalRequired` callback to `AgenticLoopCallbacks` interface in `backend/src/types/index.ts`
- [X] T011 [P] Re-export `PendingAction` and `ActionPendingEvent` from `@shared/types` in `app/src/types/index.ts`
- [X] T012 Create `backend/src/services/pendingActionService.ts` with: `createPendingAction`, `getPendingAction`, `getThreadPendingAction`, `resolvePendingAction` (status transition with idempotency guard), `expireOverdue`
- [X] T013 Add `sendActionPending()` method to `backend/src/sse/sseWriter.ts`
- [X] T014 Create `backend/src/tools/testApproval.ts` with `requiresApproval: true`, echoes `message` argument
- [X] T015 Register `test_approval` tool in `backend/src/tools/index.ts`

---

## Phase 3: User Story 1 — Loop Suspension & Approval Card (P1)

**Goal**: When the AI calls an approval-required tool, the loop suspends, a `PendingAction` is persisted, the `action_pending` SSE event is emitted, and the frontend renders an approval card.

**Independent test criteria**: Send a message that triggers `test_approval` → approval card appears with tool name and arguments, chat input is disabled, no tool execution occurs.

- [X] T016 [US1] Modify `runAgenticLoop` in `backend/src/services/toolExecutor.ts` to detect `requiresApproval` on `ToolDefinition`, call `createPendingAction`, invoke `onApprovalRequired` callback, and return suspended `AgenticLoopResult`
- [X] T017 [US1] Update `handleSendMessage` in `backend/src/controllers/messageController.ts` to handle suspended result: persist assistant message content blocks (including tool_use block), emit `action_pending` SSE event via `sendActionPending`, emit `done` with `stop_reason: "action_pending"`
- [X] T018 [US1] Add 409 `APPROVAL_PENDING` guard to `POST /api/v1/threads/:id/messages` in `backend/src/controllers/messageController.ts` — check for existing pending action on thread before starting agentic loop
- [X] T019 [US1] Add `approveAction` and `rejectAction` SSE streaming API methods to `app/src/api.ts`
- [X] T020 [US1] Add `getThread` response type update to include `pendingAction` field in `app/src/api.ts`
- [X] T021 [US1] Add `pendingAction` state per thread in `app/src/App.tsx` — update on `action_pending` SSE event, clear on approve/reject completion
- [X] T022 [US1] Create `app/src/components/ApprovalCard/ApprovalCard.tsx` — renders tool name as human-readable display name (derive via `formatToolName` utility: capitalize, replace underscores with spaces, e.g. `send_email` → "Send email"), formatted arguments, Approve/Reject buttons, status badge (Pending/Approved/Rejected/Expired), loading states, ARIA labels
- [X] T023 [US1] Create `app/src/components/ApprovalCard/ApprovalCard.module.css` — styling for approval card component
- [X] T050 [US1] Add argument formatting utility in `app/src/components/ApprovalCard/formatArguments.ts` — generic key-value renderer that displays arguments as labeled fields (e.g. "Recipient: sarah@example.com") instead of raw JSON; accept an optional per-tool formatter map for custom display
- [X] T051 [US1,US2,US3] Add performance assertions to integration endpoint tests in `backend/tests/routes/actions.test.ts` (for T045): verify approve/reject requests complete within 3 seconds (measured from request to first SSE delta); verify no regression on existing message endpoint performance
- [X] T052 [US1,US2,US3] Add performance assertions to frontend component tests in `app/src/components/ApprovalCard/ApprovalCard.test.tsx` (for T048): verify card renders within 100ms of receiving `action_pending` event; verify button loading states respond within 50ms
- [X] T024 [US1] Insert `ApprovalCard` in `app/src/components/MessageList/MessageList.tsx` after the assistant message matching `pendingAction.messageId`
- [X] T025 [US1] Disable chat input in `app/src/components/ChatInput/ChatInput.tsx` when `pendingAction?.status === 'pending'` with explanatory hint message

---

## Phase 4: User Story 2 — Approve Flow (P1)

**Goal**: User clicks Approve → tool executes, AI streams a follow-up response, card updates to "Approved".

**Independent test criteria**: Trigger approval card via `test_approval`, click Approve → tool result SSE event arrives, AI streams confirmation, card shows "Approved", chat input re-enables.

- [X] T026 [US2] Create `backend/src/controllers/actionController.ts` with `approveAction` handler: validate ownership (404 if not found/not owned), check status is `pending` (409 if resolved, 410 if expired), transition to `approved`, execute tool via `toolRegistry.execute`, reconstruct conversation context from DB, run AI call, stream response via SSE
- [X] T027 [US2] Create `backend/src/controllers/actionController.ts` `rejectAction` handler (stub — completed in Phase 5 US3)
- [X] T028 [US2] Create `backend/src/routes/actionRoutes.ts` with `POST /api/v1/actions/:id/approve`, `POST /api/v1/actions/:id/reject`, `GET /api/v1/actions/:id`
- [X] T029 [US2] Mount action routes in `backend/src/server.ts` with auth middleware
- [X] T040 [US2] Add `GET /api/v1/actions/:id` handler to `backend/src/controllers/actionController.ts` for status polling
- [X] T030 [US2] Wire Approve button in `ApprovalCard` to call `approveAction` SSE endpoint in `app/src/components/ApprovalCard/ApprovalCard.tsx`, handle streaming response, update card status to "Approved" on success

---

## Phase 5: User Story 3 — Reject Flow (P1)

**Goal**: User clicks Reject → action is cancelled, AI acknowledges, card updates to "Rejected".

**Independent test criteria**: Trigger approval card, click Reject → AI streams cancellation acknowledgement, card shows "Rejected", chat input re-enables.

- [X] T031 [US3] Complete `rejectAction` handler in `backend/src/controllers/actionController.ts`: validate ownership (404), check status is `pending` (409), transition to `rejected`, construct rejection context for AI, run AI call with tool_result indicating rejection, stream acknowledgement response via SSE
- [X] T032 [US3] Wire Reject button in `ApprovalCard` to call `rejectAction` SSE endpoint in `app/src/components/ApprovalCard/ApprovalCard.tsx`, handle streaming response, update card status to "Rejected" on success

---

## Phase 6: User Story 4 — Reload Persistence (P2)

**Goal**: Pending approval card re-appears after browser refresh.

**Independent test criteria**: Trigger approval card, refresh browser, return to thread → card re-appears in pending state with correct arguments.

- [X] T033 [US4] Include `pendingAction` field in `GET /api/v1/threads/:id` response in `backend/src/controllers/threadController.ts` — query for pending action on thread, return null if none
- [X] T034 [US4] Restore `pendingAction` state from thread response on thread load in `app/src/App.tsx` — populate card state when thread data includes a pending action

---

## Phase 7: User Story 5 — Auto-Expiry (P2)

**Goal**: Pending actions older than 10 minutes auto-reject.

**Independent test criteria**: Set `PENDING_ACTION_TTL_SECONDS=60`, trigger approval card, wait > 60 seconds → card updates to "Expired".

- [X] T035 [US5] Register `setInterval` in `backend/src/server.ts` startup that calls `pendingActionService.expireOverdue()` every 60 seconds
- [X] T036 [US5] In `expireOverdue` method of `backend/src/services/pendingActionService.ts`, transition overdue `pending` actions to `expired`, create assistant message in thread noting the expiry, log via pino
- [X] T049 [US5] Add client-side polling in `app/src/components/ApprovalCard/ApprovalCard.tsx` — when card status is `pending`, poll `GET /api/v1/actions/:id` every 30 seconds; if status changes to `expired`, update card state, re-enable chat input, and refresh the thread's message list to display the server-generated expiry notification message (created by T036); clear interval on unmount or when status is no longer `pending` (depends on T040, T022)

---

## Phase 8: User Story 7 — Idempotency (P2)

**Goal**: Already-resolved actions cannot be acted on again.

**Independent test criteria**: Approve an action, attempt to approve again → 409 error. Reject a resolved action → 409 error.

- [X] T037 [US7] Verify idempotency guard in `approveAction` and `rejectAction` handlers in `backend/src/controllers/actionController.ts` — return 409 `ACTION_ALREADY_RESOLVED` for non-pending actions
- [X] T038 [US7] Handle 409 error in `ApprovalCard` UI in `app/src/components/ApprovalCard/ApprovalCard.tsx` — display terminal status when action is already resolved

---

## Phase 9: User Story 6 — Non-Flagged Tool Regression Safety (P1)

**Goal**: Existing tools (`web_search`, `fetch_url`) continue to execute immediately without approval.

**Independent test criteria**: Send a message triggering `web_search` → executes normally, no approval card, no suspension.

- [X] T039 [US6] Verify `runAgenticLoop` in `backend/src/services/toolExecutor.ts` skips approval logic when `requiresApproval` is `false` or `undefined` — existing tools unaffected

---

## Phase 9A: Testing (Constitution Principle II)

- [X] T044 [US1,US2,US3] Write unit tests for `pendingActionService` in `backend/tests/services/pendingActionService.test.ts`: createPendingAction, getPendingAction, getThreadPendingAction, resolvePendingAction (approve/reject/expire transitions), expireOverdue batch, idempotency guard (reject transition on already-resolved action) (depends on T012)
- [X] T045 [US1,US2,US3,US7] Write integration tests for action endpoints in `backend/tests/routes/actions.test.ts`: POST approve (200 SSE stream, 404 not found/not owned, 409 already resolved, 410 expired), POST reject (200 SSE stream, 404, 409), GET action (200, 404) (depends on T026-T032, T040)
- [X] T046 [US1] Write integration test for 409 `APPROVAL_PENDING` guard on `POST /api/v1/threads/:id/messages` in `backend/tests/routes/messages.test.ts` — send message when thread has pending action → 409 (depends on T018)
- [X] T047 [US1] Write unit tests for `runAgenticLoop` suspension in `backend/tests/services/toolExecutor.test.ts`: mock tool with `requiresApproval: true` → assert PendingAction created, `onApprovalRequired` callback invoked, result has `suspended` field; mock tool without flag → assert immediate execution (depends on T016)
- [X] T048 [US1,US2,US3,US7] Write frontend component tests for `ApprovalCard` in `app/src/components/ApprovalCard/ApprovalCard.test.tsx`: renders tool name and formatted arguments, Approve/Reject buttons visible in pending state, buttons disabled in resolved states, status badge shows correct state (Pending/Approved/Rejected/Expired), loading state on button click, ARIA labels present (depends on T022)

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T041 Add structured pino logging for all approval lifecycle events (created, approved, rejected, expired) in `backend/src/services/pendingActionService.ts` and `backend/src/controllers/actionController.ts`
- [X] T042 Update Postman collection at `docs/postman/chat-thread-api.postman_collection.json` with new approval endpoints (approve, reject, GET action)
- [X] T043 Support `PENDING_ACTION_TTL_SECONDS` env var in `backend/.env` (default 600) for configurable expiry timeout

---

## Dependencies

```
T001-T005 (Schema) ──► T006-T015 (Foundational) ──► T016-T025 (US1: Suspension + Card)
                                                          │
                                                          ├──► T026-T030 (US2: Approve)
                                                          │        │
                                                          │        └──► T031-T032 (US3: Reject)
                                                          │
                                                          ├──► T033-T034 (US4: Reload Persistence)
                                                          │
                                                          ├──► T035-T036 (US5: Auto-Expiry)
                                                          │
                                                          └──► T039 (US6: Regression Safety)

T026-T032 (Approve + Reject) ──► T037-T038 (US7: Idempotency)

T012 ──► T044 (Service tests)
T026-T032, T040 ──► T045 (Endpoint tests)
T018 ──► T046 (409 guard test)
T016 ──► T047 (Loop suspension tests)
T022 ──► T048 (ApprovalCard tests)
T022 ──► T049 (Expiry polling) [T040 now in Phase 4]

T041-T043 (Polish) — after all user story phases
```

---

## Parallel Execution Opportunities

### Within Phase 2 (Foundational)
T006, T007, T008, T009, T010, T011 can all run in parallel — independent type/interface changes in different files.

### Within Phase 3 (US1)
- T019 + T020 (frontend API) can run in parallel with T016 + T017 + T018 (backend loop changes)
- T022 + T023 (ApprovalCard component) can start after types are defined, parallel with backend work

### Across Phases
- US4 (Reload Persistence: T033-T034), US5 (Auto-Expiry: T035-T036), and US6 (Regression Safety: T039) can all run in parallel after US1 completes
- US7 (Idempotency: T037-T038) can run after US2 + US3 complete

---

## Implementation Strategy

**MVP**: Phase 1 (Setup) + Phase 2 (Foundational) + Phase 3 (US1) — delivers the suspension + approval card rendering. This is independently testable: the user can see the approval card appear but cannot yet approve/reject.

**Increment 1**: Phase 4 (US2: Approve) — the core approve flow works end-to-end.

**Increment 2**: Phase 5 (US3: Reject) — reject flow completes the core interaction.

**Increment 3**: Phases 6-9 (US4-US7) — persistence, expiry, idempotency, regression safety. These can be parallelized.

**Final**: Phase 10 (Polish) — logging, Postman, env config.
