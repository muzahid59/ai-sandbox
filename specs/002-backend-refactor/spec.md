# Feature Specification: Backend Architecture Refactor

**Feature Branch**: `002-backend-refactor`
**Created**: 2026-06-10
**Status**: Draft
**Input**: User description: "check the backend code and refactor based on following principles: follow standard architecture, clear and readable, remove redundant logic and code, add standard logging, make architecture extensible"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Controller Simplification (Priority: P1)

A developer modifying the message-sending flow currently has to read through a 156-line controller method that mixes SSE formatting, database operations, cache invalidation, auto-title generation, and token counting. The controller should only coordinate — all business logic should live in service-layer methods.

**Why this priority**: The message controller is the most-changed file and the highest-risk area for regressions. Every feature touching chat flows must navigate this bloated handler.

**Independent Test**: A developer can read `handleSendMessage` and understand the flow in under 2 minutes without cross-referencing service internals.

**Acceptance Scenarios**:

1. **Given** a request to send a message, **When** examining the controller, **Then** it contains no direct database calls, no cache invalidation logic, and no auto-title generation — only delegation to services.
2. **Given** the message controller, **When** counting responsibilities, **Then** each handler has exactly one responsibility: validate input, delegate to a service, and format the response.
3. **Given** the existing thread controller, **When** reviewing its handlers, **Then** error-handling patterns are consistent (no mixed `throw` vs. manual `res.status()` patterns).

---

### User Story 2 - Eliminate Duplicate Provider Logic (Priority: P1)

When adding a new AI provider, a developer must copy-paste the same message-format conversion logic (content block extraction, tool-result mapping) from an existing provider. Three providers currently duplicate the same text-extraction and tool-result-to-role conversion patterns.

**Why this priority**: Redundant logic makes every provider change a 3x effort and a source of inconsistency bugs.

**Independent Test**: Add a mock provider with zero message-conversion code — all format translation is handled by shared utilities.

**Acceptance Scenarios**:

1. **Given** three provider implementations, **When** searching for text-extraction logic (filtering content blocks by type "text"), **Then** it exists in exactly one shared location, not in each provider.
2. **Given** a message with tool_result content blocks, **When** converting for any provider, **Then** the conversion uses a single shared function, not provider-specific inline code.
3. **Given** the OpenAI, Ollama, and Google providers, **When** comparing their `chatCompletion` methods, **Then** each contains only provider-specific API calls — no duplicated message mapping.

---

### User Story 3 - Add Comprehensive Logging (Priority: P2)

An operator investigating a slow response has no visibility into thread controller operations, incomplete request tracing in the message flow, and no operational-level timing data for tool execution. Logging coverage is inconsistent across the codebase.

**Why this priority**: Without consistent logging, debugging production issues requires code reading instead of log analysis.

**Independent Test**: Process a message with tool calls and verify that every significant operation (thread lookup, message creation, provider call, tool execution, response completion) produces a structured log entry with timing data.

**Acceptance Scenarios**:

1. **Given** any controller handler, **When** a request is processed, **Then** a structured log entry is emitted at `info` level with operation name, duration, and relevant IDs.
2. **Given** the thread controller, **When** any thread operation occurs, **Then** it produces log entries (currently has zero logging).
3. **Given** a tool execution, **When** it completes, **Then** the log includes tool name, duration, input size, output size, and success/failure status at `info` level.

---

### User Story 4 - Provider Registration Pattern (Priority: P2)

Adding a new AI provider requires editing the factory's switch statement and the MODEL_REGISTRY constant in the same file. A developer should be able to add a provider by creating a single file with a self-contained registration, without modifying existing code.

**Why this priority**: The current factory pattern violates open/closed principle and makes provider addition error-prone.

**Independent Test**: Add a new provider by creating one file — no modifications to any existing file are required for it to be available.

**Acceptance Scenarios**:

1. **Given** a new AI provider implementation, **When** a developer creates a provider file following the established pattern, **Then** the provider is available without modifying the factory or registry file.
2. **Given** the provider registry, **When** listing available providers at runtime, **Then** all registered providers appear with their capabilities and model configurations.
3. **Given** a removed provider file, **When** the system starts, **Then** it gracefully operates without the removed provider.

---

### User Story 5 - SSE Response Abstraction (Priority: P3)

SSE event formatting is hardcoded inline in the message controller with `res.write` calls and `JSON.stringify`. Adding a new SSE event type or changing the event format requires editing the controller. The SSE protocol should be encapsulated so controllers write semantic events, not raw strings.

**Why this priority**: SSE formatting scattered in the controller couples transport protocol to business logic and creates inconsistency risk.

**Independent Test**: Change the SSE event format in one place and verify all events update consistently, without touching the controller.

**Acceptance Scenarios**:

1. **Given** the message controller, **When** examining SSE-related code, **Then** it uses a writer abstraction (not raw `res.write` with `JSON.stringify`).
2. **Given** any SSE event type, **When** emitting it, **Then** the event follows a consistent format defined in one location.

---

### User Story 6 - System Prompt Separation (Priority: P3)

System prompts are embedded as multi-line string constants inside the chat service. Modifying prompts requires editing business logic code. Prompts should be managed separately so they can be updated, versioned, or customized per model without changing the service.

**Why this priority**: Prompt content changes frequently during development and should not require service-layer code changes.

**Independent Test**: Update a system prompt's wording and verify the change takes effect without modifying any service file.

**Acceptance Scenarios**:

1. **Given** the chat service, **When** examining its source, **Then** it contains no embedded prompt text — prompts are loaded from a separate source.
2. **Given** a model that does not support tools, **When** a message is processed, **Then** the service selects the appropriate prompt variant without hardcoded model-name checks.

---

### Edge Cases

- What happens when a provider is registered with a name that already exists? System MUST reject the duplicate with a clear error.
- What happens when the shared message-conversion utility encounters an unknown content block type? It MUST pass through without error (forward compatibility).
- What happens when a controller receives a request after the SSE connection is closed by the client? The system MUST handle write-after-close gracefully without crashing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Controller handlers MUST contain only request validation, service delegation, and response formatting — no direct database calls, no business logic.
- **FR-002**: Message format conversion (content blocks to/from provider-specific formats) MUST be implemented once in shared utilities, reused by all providers.
- **FR-003**: Every controller handler MUST emit structured log entries with operation name, relevant entity IDs, request correlation ID, and duration at `info` level. The correlation ID MUST propagate through all layers (controller → service → provider → tool) so a single request can be traced end-to-end.
- **FR-004**: New AI providers MUST be addable by creating a self-contained file without modifying existing source files.
- **FR-005**: SSE event emission MUST be encapsulated in a reusable abstraction that the controller calls with semantic event data.
- **FR-006**: System prompts MUST be managed outside of service logic, loadable by model or capability profile.
- **FR-007**: The `incrementThreadTokens` function MUST be relocated from messageService to threadService (it operates on Thread, not Message).
- **FR-008**: The context service's `buildContextWindow` method MUST be decomposed into focused helper methods (cache lookup, DB fetch, token budgeting, role alternation).
- **FR-009**: All refactored code MUST maintain existing API contracts — no changes to request/response shapes or SSE event types.
- **FR-010**: Error handling in controllers MUST use the existing AppError hierarchy consistently — no mixed patterns of `throw` vs manual `res.status()`.

### Key Entities

- **AIProvider**: Interface for AI model integrations. Currently three implementations with duplicated conversion logic.
- **RunnableTool**: Interface for tool implementations with Zod validation. Registration is intentionally manual — the frontend controls tool availability per request.
- **ContextService**: In-memory cached context builder. Single 162-line method needs decomposition.
- **StreamEvent**: Typed SSE events currently serialized inline in the controller.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No controller handler exceeds 30 lines of code (currently 120+ for handleSendMessage).
- **SC-002**: Message format conversion code exists in exactly one shared location — zero duplication across providers.
- **SC-003**: 100% of controller operations produce structured log entries with timing data.
- **SC-004**: Adding a new provider requires creating exactly one file, modifying zero existing files.
- **SC-005**: All existing API integration tests pass without modification after refactor.
- **SC-006**: No function in the codebase exceeds 50 lines (per constitution Principle I).
- **SC-007**: Every service-layer file has a single clear responsibility — no file combines unrelated concerns.

## Clarifications

### Session 2026-06-10

- Q: Should tool registration also follow the auto-registration pattern like providers? → A: No — tool registration stays manual. The frontend controls which tools are available per request, so explicit registration is intentional.
- Q: Should logging include a request correlation ID across all layers? → A: Yes — add a correlation ID that traces a single request from controller through service, provider, and tool execution.
- Q: Should the refactor be delivered as one PR or incrementally? → A: Single PR with all 6 user stories.

## Assumptions

- The refactor is purely structural — no new features, no API contract changes, no database schema changes. All changes land in a single PR.
- Existing test coverage is sufficient to catch regressions; additional tests will be added for new shared utilities.
- The current Anthropic-style type system (ContentBlock, ToolUseBlock, etc.) remains the canonical internal format.
- Provider auto-registration can use a simple directory-scanning pattern at startup rather than requiring a plugin framework.
- System prompts will be co-located with the backend code (not externalized to a database or config service).
