# SSE Event Contract

**Feature**: 002-backend-refactor | **Date**: 2026-06-10

> This contract documents the SSE event format for `POST /api/v1/threads/:id/messages`. These event shapes MUST NOT change during the refactor (FR-009).

## Transport

- Content-Type: `text/event-stream`
- Cache-Control: `no-cache`
- Connection: `keep-alive`
- Each event is formatted as: `data: {JSON}\n\n`

## Event Sequence

```
message_start → (content_block_delta)* → (content_block_start → content_block_stop)* → message_stop
                                                                                        ↑ or error at any point
```

A typical no-tool response:
```
message_start → content_block_delta (repeated) → message_stop
```

A tool-calling response:
```
message_start → content_block_delta* → content_block_start → content_block_stop → content_block_delta* → message_stop
```

## Event Definitions

### message_start
Emitted once at the beginning of every response.

```json
{
  "type": "message_start",
  "message_id": "uuid",
  "assistant_msg_id": "uuid",
  "user_msg_id": "uuid"
}
```

### content_block_delta
Emitted for each text chunk from the AI provider. May occur zero or more times.

```json
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "text_delta",
    "text": "chunk of text"
  }
}
```

### content_block_start
Emitted when a tool call begins. Contains the tool name and parsed arguments.

```json
{
  "type": "content_block_start",
  "index": 0,
  "content_block": {
    "type": "tool_use",
    "id": "call_id",
    "name": "tool_name",
    "input": { "key": "value" }
  }
}
```

### content_block_stop
Emitted when a tool call completes. Contains the tool result.

```json
{
  "type": "content_block_stop",
  "index": 0,
  "tool_result": {
    "tool_call_id": "call_id",
    "name": "tool_name",
    "output": "result text",
    "is_error": false
  }
}
```

### message_stop
Emitted once when the response is complete (after all tool loops resolve).

```json
{
  "type": "message_stop",
  "stop_reason": "end_turn",
  "tool_calls_count": 0
}
```

`stop_reason` values: `"end_turn"`, `"max_tokens"`, `"tool_use"` (internal, not normally seen by client).

### error
Emitted if an error occurs at any point during processing. May be followed by stream close.

```json
{
  "type": "error",
  "error": {
    "type": "internal_error",
    "message": "human-readable error message",
    "retryable": true
  }
}
```

## Invariants

1. Every stream starts with exactly one `message_start` event.
2. Every successful stream ends with exactly one `message_stop` event.
3. `content_block_start` is always followed by a matching `content_block_stop` for the same tool call.
4. `content_block_delta` events may interleave with tool call events (text → tool → more text).
5. The `index` field is always `0` (reserved for future multi-block support).
6. All JSON payloads are valid, non-nested objects (no streaming partial JSON).
