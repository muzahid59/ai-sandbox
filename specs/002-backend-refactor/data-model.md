# Data Model: Backend Architecture Refactor

**Feature**: 002-backend-refactor | **Date**: 2026-06-10

> No database schema changes. This document describes the **code-level entities** being refactored — interfaces, registries, and abstractions.

## Entities

### AIProvider (interface — refactored)

**Location**: `backend/src/providers/types.ts`

| Field | Type | Description |
|-------|------|-------------|
| name | `string` | Provider identifier (e.g., `'openai'`, `'google'`, `'ollama'`) |
| capabilities | `ProviderCapabilities` | Feature flags for this provider |
| chatCompletion | `(options: ChatCompletionOptions) => Promise<ChatCompletionResult>` | Core chat method |
| textCompletion? | `(prompt: string) => Promise<NodeJS.ReadableStream>` | Optional legacy text completion |
| imageAnalysis? | `(imageUrl: string, prompt?: string) => Promise<string>` | Optional vision capability |

**Changes**: No interface changes. Providers now export a `register()` function alongside the class.

### ProviderRegistration (new interface)

**Location**: `backend/src/providers/types.ts`

| Field | Type | Description |
|-------|------|-------------|
| name | `string` | Provider key used in MODEL_REGISTRY |
| models | `ModelConfig[]` | Array of model configurations this provider supports |
| capabilities | `ProviderCapabilities` | What this provider can do |
| factory | `(modelId: string) => AIProvider` | Creates a provider instance for a specific model |

**Validation rules**:
- `name` must be unique across all registrations (duplicate → startup error)
- `models` must have at least one entry
- `factory` must return a valid AIProvider instance

### ModelConfig (new interface)

**Location**: `backend/src/providers/types.ts`

| Field | Type | Description |
|-------|------|-------------|
| key | `string` | User-facing model name (e.g., `'openai'`, `'lama'`) |
| modelId | `string` | Provider-specific model identifier (e.g., `'gpt-4o-mini'`, `'llama3.2'`) |

### SSEWriter (new class)

**Location**: `backend/src/sse/sseWriter.ts`

| Field/Method | Type | Description |
|--------------|------|-------------|
| constructor | `(res: Response)` | Wraps an Express Response, sets SSE headers |
| sendMessageStart | `(data: MessageStartEvent) => void` | Emit `message_start` event |
| sendDelta | `(data: DeltaEvent) => void` | Emit `content_block_delta` event |
| sendToolUseStart | `(data: ToolUseStartEvent) => void` | Emit `content_block_start` event |
| sendToolUseResult | `(data: ToolUseResultEvent) => void` | Emit `content_block_stop` event |
| sendMessageStop | `(data: MessageStopEvent) => void` | Emit `message_stop` event |
| sendError | `(data: ErrorEvent) => void` | Emit `error` event |
| end | `() => void` | Close the SSE connection |

**Validation rules**:
- All event methods call `res.write(`data: ${JSON.stringify(payload)}\n\n`)`
- Event type strings are hardcoded constants, not user-supplied
- `end()` calls `res.end()` and prevents further writes

### SSE Event Types (refactored)

**Location**: `backend/src/sse/types.ts` (moved from `types/events.ts`)

| Event Type | Payload Fields |
|------------|---------------|
| `message_start` | `message_id`, `assistant_msg_id`, `user_msg_id` |
| `content_block_delta` | `index`, `delta: { type: 'text_delta', text }` |
| `content_block_start` | `index`, `content_block: { type: 'tool_use', id, name, input }` |
| `content_block_stop` | `index`, `tool_result: { tool_call_id, name, output, is_error }` |
| `message_stop` | `stop_reason`, `tool_calls_count` |
| `error` | `error: { type, message, retryable }` |

**No changes to event shapes** — types are just moved to a dedicated location.

### PromptLoader (new module)

**Location**: `backend/src/prompts/index.ts`

| Function | Signature | Description |
|----------|-----------|-------------|
| getSystemPrompt | `(options: { supportsTools: boolean; date?: string; timezone?: string }) => string` | Returns appropriate system prompt based on model capabilities |

**State transitions**: N/A (stateless function)

### ContextService (refactored)

**Location**: `backend/src/services/contextService.ts`

Decomposed methods (all private except `buildContextWindow`):

| Method | Description |
|--------|-------------|
| `buildContextWindow(threadId, maxTokens)` | Public entry: orchestrates pipeline |
| `lookupCache(threadId)` | Returns cached messages or null |
| `fetchMessages(threadId)` | DB query, returns chronological messages |
| `applyTokenBudget(messages, maxTokens)` | Trims messages to fit token budget |
| `enforceMinimumMessages(window, all)` | Ensures at least 4 messages |
| `enforceRoleAlternation(messages)` | Removes consecutive same-role |
| `validateLastRole(messages, threadId)` | Warns if last message isn't user role |

No changes to the public API surface.

## Relationships

```
ProviderRegistration  1 ──── * ModelConfig
                      1 ──── 1 ProviderCapabilities
                      1 ──── 1 AIProvider (via factory)

SSEWriter             1 ──── 1 Express Response
                      uses ── * SSE Event Types

PromptLoader          reads ── default.ts, simple.ts
                      called by ── chatService

ContextService        calls ── Prisma (Message model)
                      calls ── estimateTokens (private)
                      calls ── extractText (private, uses shared utils)
```

## Unchanged Entities

These entities are not modified by this refactor:

- **Thread** (Prisma model) — no schema changes
- **Message** (Prisma model) — no schema changes
- **ToolCall** (Prisma model) — no schema changes
- **RunnableTool** (interface) — tool registration stays manual per spec
- **ToolRegistry** (singleton) — already clean, no changes
- **AppError hierarchy** — already comprehensive, no changes
