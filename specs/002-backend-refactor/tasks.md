# Tasks: Backend Architecture Refactor

**Input**: Design documents from `/specs/002-backend-refactor/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/sse-events.md, quickstart.md

**Tests**: New shared utilities (provider utils, SSEWriter) receive unit tests as specified in plan.md. Existing tests must pass unmodified (FR-009, SC-005).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Create new directory structure for modules introduced by this refactor

- [ ] T001 Create new directories: backend/src/prompts/, backend/src/sse/, backend/tests/sse/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create all new modules, interfaces, and shared utilities that user stories depend on. No existing behavior is changed in this phase — only new files are created and minimal re-exports added.

**Serves**: US5 (SSEWriter, SSE types), US6 (PromptLoader, prompt files), US2 (shared conversion utils), US4 (ProviderRegistration types), US3 (correlation ID propagation), US1 (incrementThreadTokens relocation)

- [ ] T002 [P] Define ProviderRegistration, ModelConfig, and ProviderCapabilities interfaces with register() export convention in backend/src/providers/types.ts
- [ ] T003 [P] Create SSE event type definitions (MessageStartEvent, DeltaEvent, ToolUseStartEvent, ToolUseResultEvent, MessageStopEvent, ErrorEvent) in backend/src/sse/types.ts
- [ ] T004 [P] Create shared message conversion utilities (extractTextContent, mapToolResult, buildToolCallContentBlock) in backend/src/providers/utils.ts
- [ ] T005 [P] Create default tool-capable system prompt as a parameterized template literal (date, timezone) in backend/src/prompts/default.ts
- [ ] T006 [P] Create simple non-tool system prompt as a parameterized template literal in backend/src/prompts/simple.ts
- [ ] T007 Create prompt loader getSystemPrompt({ supportsTools, date?, timezone? }) in backend/src/prompts/index.ts
- [ ] T008 Create SSEWriter class with typed event methods (sendMessageStart, sendDelta, sendToolUseStart, sendToolUseResult, sendMessageStop, sendError, end) and client disconnect protection in backend/src/sse/sseWriter.ts
- [ ] T009 Re-export SSE types from backend/src/types/events.ts pointing to backend/src/sse/types.ts for backward compatibility
- [ ] T010 [P] Update requestLogger middleware to attach correlation ID (req.id) for downstream propagation in backend/src/middleware/requestLogger.ts
- [ ] T011 [P] Move incrementThreadTokens function from messageService to threadService and update import in call site in backend/src/services/threadService.ts
- [ ] T012 Write unit tests for extractTextContent, mapToolResult, and buildToolCallContentBlock including unknown content block passthrough in backend/tests/providers/utils.test.ts
- [ ] T013 Write unit tests for SSEWriter including event formatting, connection state tracking, and write-after-close protection in backend/tests/sse/sseWriter.test.ts

**Checkpoint**: All new modules exist and pass their tests. No existing behavior changed yet.

---

## Phase 3: User Story 1 — Controller Simplification (Priority: P1) :dart: MVP

**Goal**: Slim controllers to ~25-line handlers that only validate, delegate, and format responses. All business logic moves to services.

**Independent Test**: A developer can read `handleSendMessage` and understand the flow in under 2 minutes without cross-referencing service internals.

### Implementation for User Story 1

- [ ] T014 [US1] Decompose contextService.buildContextWindow into focused helper methods (lookupCache, fetchMessages, applyTokenBudget, enforceMinimumMessages, enforceRoleAlternation, validateLastRole) in backend/src/services/contextService.ts
- [ ] T015 [US1] Refactor chatService to use PromptLoader for system prompts and accept SSEWriter callbacks for event emission, removing embedded prompt text and inline res.write calls in backend/src/services/chatService.ts
- [ ] T016 [US1] Slim messageController.handleSendMessage to ~25 lines: validate input, create SSEWriter, delegate to chatService, handle completion in backend/src/controllers/messageController.ts
- [ ] T017 [US1] Standardize threadController error handling: replace all manual res.status().json() patterns with throw AppError exclusively in backend/src/controllers/threadController.ts
- [ ] T018 [US1] Update contextService tests to cover decomposed helper methods (lookupCache, fetchMessages, applyTokenBudget, enforceRoleAlternation) in backend/tests/services/contextService.test.ts

**Checkpoint**: Controllers are slim orchestrators. `handleSendMessage` is ~25 lines. All existing tests pass unmodified.

---

## Phase 4: User Story 2 — Eliminate Duplicate Provider Logic (Priority: P1)

**Goal**: All message format conversion (text extraction, tool result mapping) lives in one shared location. Providers contain only provider-specific API calls.

**Independent Test**: Add a mock provider with zero message-conversion code — all format translation handled by shared utilities from backend/src/providers/utils.ts.

### Implementation for User Story 2

- [ ] T019 [P] [US2] Refactor OpenAI provider to use extractTextContent and mapToolResult from shared utils, removing inline text-block filtering and tool result detection in backend/src/providers/openai.ts
- [ ] T020 [P] [US2] Refactor Google provider to use extractTextContent and mapToolResult from shared utils, removing inline text-block filtering and tool result detection in backend/src/providers/google.ts
- [ ] T021 [P] [US2] Refactor Ollama provider to use extractTextContent and mapToolResult from shared utils, removing inline text-block filtering and tool result detection in backend/src/providers/ollama.ts

**Checkpoint**: Text extraction logic (`.filter(b => b.type === 'text')...`) exists in exactly one location. Each provider's `chatCompletion` contains only provider-specific API calls.

---

## Phase 5: User Story 3 — Add Comprehensive Logging (Priority: P2)

**Goal**: Every significant operation produces a structured log entry with operation name, entity IDs, correlation ID, and duration at info level.

**Independent Test**: Process a message with tool calls and verify that every operation (thread lookup, message creation, provider call, tool execution, response completion) produces a structured log entry with timing data.

### Implementation for User Story 3

- [ ] T022 [P] [US3] Add structured logging with operation name, entity IDs, duration, and child logger (requestId) to all five threadController handlers in backend/src/controllers/threadController.ts
- [ ] T023 [P] [US3] Add error logging with err object, statusCode, and correlation ID to errorHandler middleware in backend/src/middleware/errorHandler.ts
- [ ] T024 [P] [US3] Add operation timing (Date.now delta) and correlation ID via logger.child({ requestId }) to messageController handlers in backend/src/controllers/messageController.ts
- [ ] T025 [US3] Enhance tool execution logging with tool name, duration, input size, output size, success/failure status, and correlation ID in backend/src/services/toolExecutor.ts

**Checkpoint**: Thread controller has structured logging (was zero). All controller operations include duration. Correlation ID traces from controller through tool execution.

---

## Phase 6: User Story 4 — Provider Registration Pattern (Priority: P2)

**Goal**: A new AI provider is added by creating a single file — no modifications to any existing file required.

**Independent Test**: Add a new provider by creating one file. Verify it appears in the registry without modifying providers/index.ts.

### Implementation for User Story 4

- [ ] T026 [P] [US4] Add register() export function returning ProviderRegistration { name, models, capabilities, factory } to OpenAI provider in backend/src/providers/openai.ts
- [ ] T027 [P] [US4] Add register() export function returning ProviderRegistration { name, models, capabilities, factory } to Google provider in backend/src/providers/google.ts
- [ ] T028 [P] [US4] Add register() export function returning ProviderRegistration { name, models, capabilities, factory } to Ollama provider in backend/src/providers/ollama.ts
- [ ] T029 [US4] Implement auto-registration: scan providers/ directory for .ts files (excluding index.ts, types.ts, utils.ts), call each register(), populate MODEL_REGISTRY and factory map, reject duplicate names in backend/src/providers/index.ts
- [ ] T030 [US4] Update server.ts to call provider auto-registration at startup and log registered providers in backend/src/server.ts

**Checkpoint**: Removing a provider file and restarting → provider absent, no errors. Adding a file with register() → provider available. Duplicate name → startup error.

---

## Phase 7: User Story 5 — SSE Response Abstraction (Priority: P3)

**Goal**: SSE event formatting is encapsulated in a reusable abstraction. Controllers write semantic events, not raw strings.

**Independent Test**: Change the SSE event format in one place (backend/src/sse/sseWriter.ts) and verify all events update consistently, without touching the controller.

**Status**: Fully implemented by earlier phases:

| Acceptance Criterion | Implemented By |
|---|---|
| Controller uses SSEWriter, not raw res.write | T008 (create SSEWriter), T016 (controller integration) |
| All events follow consistent format from one location | T003 (SSE types), T008 (SSEWriter methods) |
| Write-after-close handled gracefully | T008 (disconnect protection), T013 (tests) |

No additional tasks required.

---

## Phase 8: User Story 6 — System Prompt Separation (Priority: P3)

**Goal**: System prompts are managed outside service logic, loadable by model capability profile. No embedded prompt text in services.

**Independent Test**: Update a system prompt's wording in backend/src/prompts/default.ts and verify the change takes effect without modifying any service file.

**Status**: Fully implemented by earlier phases:

| Acceptance Criterion | Implemented By |
|---|---|
| ChatService contains no embedded prompt text | T005, T006 (prompt files), T007 (loader), T015 (chatService refactor) |
| Capability-based prompt selection (no hardcoded model checks) | T007 (supportsTools flag), T015 (chatService uses getSystemPrompt) |

No additional tasks required.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final verification that the refactor maintains all contracts and meets success criteria

- [ ] T031 [P] Run full backend test suite to verify all existing tests pass without modification (SC-005)
- [ ] T032 [P] Audit all functions to verify none exceeds 50 lines (SC-006) and no controller handler exceeds 30 lines (SC-001)
- [ ] T033 Run quickstart.md verification checklist: API contracts, SSE event sequence, tool calling, provider verification, logging verification
- [ ] T034 Verify message format conversion code exists in exactly one shared location with zero duplication across providers (SC-002)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Foundational (T007 for PromptLoader, T008 for SSEWriter, T011 for incrementThreadTokens)
- **US2 (Phase 4)**: Depends on Foundational (T004 for shared utils). Independent of US1.
- **US3 (Phase 5)**: Depends on Foundational (T010 for correlation ID). Best done after US1 (T016, T017 — controllers are cleaner to add logging to)
- **US4 (Phase 6)**: Depends on Foundational (T002 for ProviderRegistration types). Best done after US2 (T019-T021 — providers already refactored)
- **US5 (Phase 7)**: No tasks — completed by Foundational + US1
- **US6 (Phase 8)**: No tasks — completed by Foundational + US1
- **Polish (Phase 9)**: Depends on all user story phases being complete

### Intra-Phase Dependencies (Foundational)

```
Group 1 [P]: T002, T003, T004, T005, T006, T010, T011  (all independent, parallel)
Group 2:     T007 (after T005+T006), T008 (after T003), T009 (after T003)
Group 3:     T012 (after T004), T013 (after T008)
```

### Intra-Phase Dependencies (US1)

```
T014 (contextService decompose) — independent, can start first
T015 (chatService refactor) — independent of T014
T016 (messageController slim) — after T015 (chatService API must be finalized)
T017 (threadController errors) — independent of T014-T016
T018 (contextService tests) — after T014
```

### User Story Independence

- **US1 and US2** are both P1 and can be implemented in **parallel** after Foundational completes (they touch different files)
- **US3 and US4** are both P2 and can be implemented in **parallel** (US3 touches controllers/middleware, US4 touches providers/index/server)
- **US5 and US6** have no additional tasks — satisfied by Foundational + US1

### Edge Cases (from spec)

| Edge Case | Handled By |
|---|---|
| Duplicate provider name at registration | T029 — reject with startup error |
| Unknown content block type in conversion | T004 — passthrough without error (forward compatibility) |
| Write after SSE connection closed by client | T008 — connection state tracking, graceful no-op |

---

## Parallel Opportunities

### Foundational Phase

```
Parallel group 1: T002, T003, T004, T005, T006, T010, T011
Then:             T007 (needs T005+T006), T008 (needs T003), T009 (needs T003)
Then:             T012 (needs T004), T013 (needs T008)
```

### US1 + US2 (can run concurrently — different file sets)

```
Agent A (US1): T014 → T015 → T016 → T017 → T018
Agent B (US2): T019, T020, T021 (all parallel — different files)
```

### US3 + US4 (can run concurrently — different file sets)

```
Agent A (US3): T022, T023, T024 (parallel) → T025
Agent B (US4): T026, T027, T028 (parallel) → T029 → T030
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (**CRITICAL — blocks all stories**)
3. Complete Phase 3: US1 — Controller Simplification
4. **STOP and VALIDATE**: Run test suite, check controller line counts, verify SSE event sequence
5. Controllers are clean, prompts externalized, SSE abstracted — ready for demo

### Incremental Delivery

1. Setup + Foundational → all new modules exist and tested
2. US1 (Controller Simplification) → slim controllers, clean services (MVP)
3. US2 (Provider Dedup) → shared utils integrated, zero duplication
4. US3 (Logging) → full observability with correlation IDs
5. US4 (Auto-Registration) → open/closed provider pattern
6. Polish → full verification against success criteria

### Parallel Team Strategy

With two developers after Foundational:
- **Developer A**: US1 → US3 (controllers → logging on those controllers)
- **Developer B**: US2 → US4 (providers → auto-registration of those providers)

---

## Summary

| Metric | Value |
|---|---|
| Total tasks | 34 |
| Setup | 1 |
| Foundational | 12 |
| US1 (P1) | 5 |
| US2 (P1) | 3 |
| US3 (P2) | 4 |
| US4 (P2) | 5 |
| US5 (P3) | 0 (covered by Foundational + US1) |
| US6 (P3) | 0 (covered by Foundational + US1) |
| Polish | 4 |
| Parallel opportunities | 3 major (Foundational groups, US1+US2, US3+US4) |
| Suggested MVP scope | Phases 1-3 (Setup + Foundational + US1 = 18 tasks) |

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same phase
- [Story] label maps task to specific user story for traceability
- All refactored code MUST maintain existing API contracts (FR-009) — no changes to request/response shapes or SSE event types
- No database schema changes — this is a purely structural refactor
- Commit after each task or logical group
- Stop at any checkpoint to validate independently
