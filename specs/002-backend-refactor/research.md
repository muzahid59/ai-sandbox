# Research: Backend Architecture Refactor

**Feature**: 002-backend-refactor | **Date**: 2026-06-10

## R-001: Shared Message Conversion Utilities

**Decision**: Create `backend/src/providers/utils.ts` with three shared functions: `extractTextContent()`, `mapToolResult()`, and `buildToolCallContentBlock()`.

**Rationale**: The text-block filtering pattern (`.filter(b => b.type === 'text').map(b => b.text).join(' ')`) is duplicated 6 times across openai.ts:45-48, google.ts:59-62, ollama.ts:62-65, messageController.ts:111-114, and contextService.ts (twice at lines 70-72 and 144-147). Tool result detection (`msg.content.find(b => b.type === 'tool_result')`) is duplicated in all 3 providers. Tool call to content block mapping (pushing `{ type: 'tool_use', id, name, input }`) is identical across all 3 providers.

**Alternatives considered**:
- A `MessageConverter` class with provider-specific subclasses — rejected because the conversions are stateless pure functions; a class adds unnecessary indirection.
- Putting utilities in `types/` — rejected because these are runtime functions, not type definitions.

## R-002: Provider Auto-Registration Pattern

**Decision**: Each provider file exports a `register()` function that returns `{ name, models[], capabilities, factory() }`. At startup, `providers/index.ts` dynamically imports all `.ts` files in the `providers/` directory (excluding `index.ts`, `types.ts`, `utils.ts`) and calls each `register()` function to populate the MODEL_REGISTRY and provider factory map.

**Rationale**: The current pattern requires editing `providers/index.ts` to add entries to both the `MODEL_REGISTRY` object and the factory switch. This violates open/closed principle (FR-004, SC-004). Auto-registration via directory scanning means a new provider is just a new file.

**Alternatives considered**:
- Decorator-based registration (`@Provider('openai')`) — rejected because TypeScript decorators are experimental and add build complexity.
- Plugin framework (dynamic `require()` from a config file) — rejected as over-engineered for 3-5 providers; directory scanning is simpler and sufficient.
- Import map in a config file — rejected because it still requires editing a file when adding a provider.

## R-003: SSE Writer Abstraction

**Decision**: Create `backend/src/sse/sseWriter.ts` exporting an `SSEWriter` class that wraps an Express `Response` object and provides typed methods: `sendMessageStart()`, `sendDelta()`, `sendToolUseStart()`, `sendToolUseResult()`, `sendMessageStop()`, `sendError()`. Each method internally calls `res.write()` with proper `data:` formatting and `JSON.stringify`.

**Rationale**: The message controller currently has 6 inline `res.write(\`data: ${JSON.stringify(...)}\n\n\`)` calls (lines 67-153) mixing transport formatting with business logic. The SSE writer encapsulates the wire format so the controller works with semantic events (FR-005).

**Alternatives considered**:
- Plain helper functions (not a class) — rejected because the writer needs to hold a reference to `res` and track connection state (client disconnect detection).
- EventEmitter pattern — rejected because the controller is the producer, not the consumer; an emitter adds indirection without benefit.
- Middleware-based SSE setup — rejected because SSE is only used by one endpoint; middleware would be unused elsewhere.

## R-004: System Prompt Externalization

**Decision**: Create `backend/src/prompts/` directory with individual prompt files (`default.ts`, `simple.ts`) exporting string-returning functions. A `prompts/index.ts` loader selects the appropriate prompt based on model capabilities (supports tools vs. does not). Prompts are TypeScript template literals, not external text files, to keep them type-safe and allow dynamic values (current date, timezone).

**Rationale**: `chatService.ts` has a 45-line `SYSTEM_PROMPT` constant (lines 11-45) and a 3-line `SIMPLE_PROMPT` (lines 56-58) embedded directly in the service. Prompt text changes frequently during development and should not require editing service logic (FR-006). The current hardcoded timezone (`'Asia/Dhaka (UTC+6)'`) and date (`new Date().toISOString()`) should be parameterizable.

**Alternatives considered**:
- External `.txt` or `.md` files loaded at runtime — rejected because prompts contain dynamic interpolation (date, timezone) and TypeScript gives compile-time safety.
- Database-stored prompts — rejected per spec assumption: "System prompts will be co-located with the backend code."
- YAML/JSON config files — rejected because template literal syntax is more readable for multi-line prompts with interpolation.

## R-005: Controller Slimming Strategy

**Decision**: Decompose `handleSendMessage` (156 lines) into:
1. Request validation (extract and validate body fields)
2. Message creation (delegate to messageService)
3. SSE setup (instantiate SSEWriter, set headers)
4. Processing delegation (call chatService.processMessage with SSEWriter callbacks)
5. Completion handling (update message status, auto-title)

The controller method itself becomes a ~25-line orchestrator. Each step is either an inline expression or a service call. No new "helper" functions in the controller file — logic moves to services.

**Rationale**: FR-001 requires controllers to contain only validation, delegation, and response formatting. SC-001 caps handlers at 30 lines. The current handler mixes SSE setup, message persistence, auto-title generation, token counting, cache invalidation, and error formatting.

**Alternatives considered**:
- Express middleware chain (one middleware per concern) — rejected because SSE streaming makes middleware composition awkward (response is held open).
- Command pattern (create a SendMessage command object) — rejected as over-engineering for a single endpoint.

## R-006: Context Service Decomposition

**Decision**: Break `buildContextWindow` (110+ lines) into focused private methods:
- `lookupCache(threadId)` — cache hit/miss (lines 17-22)
- `fetchMessages(threadId)` — DB query + chronological ordering (lines 24-42)
- `applyTokenBudget(messages, maxTokens)` — walk from newest, respect budget (lines 47-58)
- `enforceMinimumMessages(window, allMessages)` — safety floor of 4 messages (lines 60-62)
- `enforceRoleAlternation(messages)` — remove consecutive same-role (lines 75-95)
- `validateLastRole(messages)` — warn if last message not from user (lines 97-103)

The public `buildContextWindow` becomes a pipeline calling these in sequence.

**Rationale**: FR-008 requires decomposition. SC-006 caps functions at 50 lines. The current method is 110+ lines with 7 distinct phases. Each phase is independently testable.

**Alternatives considered**:
- Pipeline pattern (array of transform functions) — rejected because the phases have different signatures and side effects (caching, logging); explicit method calls are clearer.
- Separate class per phase — rejected as over-abstraction for private methods within a single service.

## R-007: Correlation ID Propagation

**Decision**: The existing `requestLogger.ts` middleware already generates a request ID (from `x-request-id` header or UUID). Propagate this ID by:
1. Attaching it to `req` (already done as `req.id`)
2. Passing it through service calls as part of a context object or logger child
3. Using `logger.child({ requestId: req.id })` at the controller level and passing the child logger through the service chain

**Rationale**: FR-003 requires a correlation ID that traces through controller → service → provider → tool. The existing request ID generation is solid; it just isn't propagated past the middleware layer.

**Alternatives considered**:
- AsyncLocalStorage (Node.js CLS) — rejected because it adds hidden coupling and is harder to test. Explicit parameter passing is more traceable.
- Middleware that sets a global context — rejected because globals don't work with concurrent requests.

## R-008: Logging Gaps

**Decision**: Add structured logging to:
1. `threadController.ts` — currently has zero logging. Add operation + duration logging to all 5 handlers.
2. `errorHandler.ts` middleware — add `log.error({ err, statusCode })` before sending response.
3. All controller handlers — add duration tracking via `Date.now()` at start and log at completion.

**Rationale**: FR-003 requires 100% controller coverage with operation name, entity IDs, correlation ID, and duration. SC-003 measures this. Thread controller has zero logging; error middleware silently swallows errors.

**Alternatives considered**:
- AOP-style logging decorators — rejected because Express handlers aren't class methods; decorators would require a wrapper pattern.
- Middleware that auto-logs all handlers — rejected because handler-specific context (entity IDs, operation names) can't be inferred generically.

## R-009: incrementThreadTokens Relocation

**Decision**: Move `incrementThreadTokens` from `messageService.ts` to `threadService.ts`. Update the single call site in `messageController.ts` (or `chatService.ts` after controller slimming) to import from `threadService`.

**Rationale**: FR-007 explicitly requires this. The function operates on the Thread entity, not Message. It's a single function relocation with one import change.

**Alternatives considered**: None — this is a straightforward relocation dictated by the spec.

## R-010: Error Handling Consistency

**Decision**: Audit all controller handlers and ensure they:
1. Use `throw` with AppError subclasses exclusively (no manual `res.status().json()` for error cases)
2. Let the error middleware catch and format all errors
3. Remove any mixed patterns

**Rationale**: FR-010 requires consistent error handling using the existing AppError hierarchy. The current thread controller uses string message matching in some places alongside proper AppError throwing.

**Alternatives considered**:
- Zod-based request validation middleware — good idea but out of scope for this refactor (no new features). Can be a follow-up.
