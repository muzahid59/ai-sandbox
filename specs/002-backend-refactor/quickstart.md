# Quickstart: Backend Architecture Refactor

**Feature**: 002-backend-refactor | **Date**: 2026-06-10

## Prerequisites

- Node.js LTS, Docker Compose running (PostgreSQL + SearXNG)
- `backend/.env` configured (see `backend/.env.example`)
- Database migrated: `cd backend && npx prisma migrate dev`

## Running the Backend

```bash
cd backend
npm run dev    # nodemon with auto-restart
```

Backend runs on `http://localhost:5001`. Frontend on `http://localhost:3000`.

## Running Tests

```bash
cd backend
npm test                    # all tests
npx jest --watch            # watch mode
npx jest tests/providers/   # provider tests only
npx jest tests/sse/         # SSE writer tests only
```

## Verification Checklist

After the refactor, verify these behaviors are preserved:

### 1. API Contracts (no changes expected)

```bash
# Create a thread
curl -X POST http://localhost:5001/api/v1/threads \
  -H "Content-Type: application/json" \
  -d '{"model": "openai", "title": "Test"}'

# Send a message (SSE stream)
curl -N -X POST http://localhost:5001/api/v1/threads/{id}/messages \
  -H "Content-Type: application/json" \
  -d '{"content": [{"type": "text", "text": "Hello"}]}'

# List threads
curl http://localhost:5001/api/v1/threads
```

### 2. SSE Event Sequence

Verify the stream produces events in order: `message_start` → `content_block_delta`* → `message_stop`. See `contracts/sse-events.md` for the full event schema.

### 3. Tool Calling

Send a message that triggers a tool call (e.g., "what is 2+2?") and verify:
- `content_block_start` event with tool name and arguments
- `content_block_stop` event with tool result
- Final `message_stop` with correct `tool_calls_count`

### 4. Provider Verification

Test each provider to confirm the refactored shared utilities work:
- OpenAI: `{"model": "openai"}` — streaming + tool calls
- Google: `{"model": "google"}` — non-streaming + tool calls
- Ollama: `{"model": "lama"}` — streaming + tool calls (requires local Ollama)

### 5. Logging Verification

After sending a message, check console output for:
- Thread controller operations now produce `info`-level structured logs
- Correlation ID (`requestId`) appears in all log lines for a single request
- Tool execution logs include: name, duration, input size, output size, success/failure

## Key Files Changed

| Area | Files | What Changed |
|------|-------|-------------|
| Controllers | `messageController.ts`, `threadController.ts` | Slimmed handlers, SSEWriter usage, logging |
| Providers | `openai.ts`, `google.ts`, `ollama.ts`, `index.ts` | Use shared utils, auto-registration |
| New: Shared utils | `providers/utils.ts` | `extractTextContent()`, `mapToolResult()`, `buildToolCallContentBlock()` |
| New: SSE writer | `sse/sseWriter.ts`, `sse/types.ts` | SSE event abstraction |
| New: Prompts | `prompts/index.ts`, `prompts/default.ts`, `prompts/simple.ts` | Externalized system prompts |
| Services | `contextService.ts`, `chatService.ts`, `threadService.ts` | Decomposed methods, prompt loading, token relocation |
| Middleware | `requestLogger.ts`, `errorHandler.ts` | Correlation ID propagation, error logging |
