# Data Model: Convert JavaScript to TypeScript

**Date**: 2026-05-19
**Feature**: [spec.md](./spec.md) | [plan.md](./plan.md)

This feature does not introduce new data models. It creates TypeScript
type definitions that mirror existing runtime data structures. The
types below will live in `shared/types/` and be consumed by both
frontend and backend.

## Shared Type Definitions

### Thread

Represents a chat conversation. Crosses the API boundary.

```typescript
interface Thread {
  id: string;
  title: string;
  status: 'active' | 'archived' | 'deleted';
  model: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

interface CreateThreadRequest {
  model: string;
  title?: string;
}

interface UpdateThreadRequest {
  title?: string;
  status?: 'active' | 'archived';
}
```

Source of truth: `backend/prisma/schema.prisma` Thread model.

### Message

Represents a single message in a thread. Uses JSONB content blocks.

```typescript
interface Message {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ContentBlock[];
  toolCalls?: ToolCall[];
  createdAt: string;   // ISO 8601
}

type ContentBlock = TextBlock | ToolUseBlock;

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

Source of truth: `backend/src/types/content.ts` and
`backend/src/types/messages.ts`.

### SSE Streaming Events

Discriminated union of all server-sent events consumed by the
frontend during message streaming.

```typescript
type SSEEvent =
  | MessageCreatedEvent
  | DeltaEvent
  | ToolUseStartEvent
  | ToolUseResultEvent
  | DoneEvent
  | ErrorEvent;

interface MessageCreatedEvent {
  type: 'message_created';
  user_msg_id: string;
  assistant_msg_id: string;
}

interface DeltaEvent {
  type: 'delta';
  text: string;
  msg_id: string;
}

interface ToolUseStartEvent {
  type: 'tool_use_start';
  tool_call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolUseResultEvent {
  type: 'tool_use_result';
  tool_call_id: string;
  name: string;
  success: boolean;
  output: string;
}

interface DoneEvent {
  type: 'done';
  msg_id: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  tool_calls_count: number;
}

interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
}
```

Source of truth: SSE format documented in CLAUDE.md under
"SSE Format (new `/api/v1` endpoints)".

## Frontend-Only Types

These types are used only by the frontend and do not cross the
API boundary. They live in `app/src/types/`.

```typescript
// UI-level message representation
interface UIMessage {
  id: string;
  text: string;
  sent: boolean;
  done: boolean;
  isError?: boolean;
  toolCalls?: UIToolCall[];
}

interface UIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  output?: string;
}

// Streaming callback options for api.ts sendMessage()
interface StreamCallbacks {
  onCreated?: (data: MessageCreatedEvent) => void;
  onDelta?: (data: DeltaEvent) => void;
  onDone?: (data: DoneEvent) => void;
  onError?: (data: ErrorEvent) => void;
  onToolUseStart?: (data: ToolUseStartEvent) => void;
  onToolUseResult?: (data: ToolUseResultEvent) => void;
}
```

## Entity Relationships

```text
Thread 1──* Message
Message 1──* ContentBlock (JSONB array)
Message 1──* ToolCall (optional, JSONB array)
SSEEvent ──> references Message by msg_id
```

No schema changes required. Types are compile-time only.
