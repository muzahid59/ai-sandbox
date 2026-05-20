# Ollama Streaming Support Design

**Date:** 2026-05-20  
**Status:** Approved  
**Approach:** Option A — `onDelta` callback in `ChatCompletionOptions`

## Goals

1. **Progressive UI tokens** — text appears word-by-word in the chat UI as Ollama generates it, rather than arriving as one large SSE chunk after the full response is buffered.
2. **Timeout resilience** — use Ollama's streaming HTTP endpoint to avoid Axios connection-idle timeouts on long completions.

## Background

The current `OllamaProvider.chatCompletion` uses `stream: false`, buffering the entire response before returning. The agentic loop (`toolExecutor.ts`) then calls `callbacks.onDelta(fullText)` once. This means the frontend receives one large SSE delta after the model finishes generating — no progressive display.

Both Anthropic and OpenAI's SDKs solve this the same way: `stream: true` on the completion call, with per-token callbacks/events at the SDK layer. Ollama's `/api/chat` endpoint follows the same model, returning NDJSON with one line per chunk.

## Chosen Approach

Add an optional `onDelta` callback to `ChatCompletionOptions`. When provided, the provider calls it per token chunk as they arrive. The agentic loop passes `callbacks.onDelta` through, and skips its own post-call `onDelta` emit to avoid double-firing.

This is backward-compatible: OpenAI and Google providers ignore `onDelta` in options, and the loop's existing post-call emit still runs for them.

## Changes

### 1. `backend/src/types/messages.ts` — `ChatCompletionOptions`

```typescript
export interface ChatCompletionOptions {
  messages: MessageParam[];
  tools?: ToolDefinition[];
  model?: string;
  onDelta?: (text: string) => void;  // called per token chunk when streaming
}
```

### 2. `backend/src/providers/ollama.ts` — `chatCompletion`

- Switch to `stream: true` with `responseType: 'stream'` on the Axios POST to `/api/chat`
- Read the response as a Node.js stream, splitting on newlines
- Each NDJSON line: `{"message": {"content": "chunk"}, "done": false}` → call `options.onDelta?.(chunk)` and accumulate text
- Final line (`done: true`): parse `tool_calls` if present (Ollama only sends tool calls on the final chunk)
- Return the same `ChatCompletionResult` shape with fully-accumulated `text`, `contentBlocks`, `toolCalls`, and `stopReason`

### 3. `backend/src/services/toolExecutor.ts` — agentic loop

- Pass `onDelta: callbacks.onDelta` in the `chatCompletion` options object on every call
- Pass `onDelta` on all iterations. When `options.onDelta` is provided, skip the loop's own `callbacks.onDelta` call in both cases:
  - Final turn (non-tool-use): skip `callbacks.onDelta(finalText)` — tokens already emitted per-chunk
  - Tool-use turns: skip `callbacks.onDelta(response.text)` for partial pre-tool text — also already emitted per-chunk
- For OpenAI/Google, `onDelta` in options is ignored by those providers, so the loop's existing emits still fire normally
- Detection: check `typeof options.onDelta === 'function'` before each loop-level emit

## Data Flow

```
User message → SSE request
  → chatService.processMessage (callbacks.onDelta wired to SSE write)
    → runAgenticLoop(provider, messages, tools, callbacks)
      → provider.chatCompletion({ messages, tools, onDelta: callbacks.onDelta })
        → Axios POST /api/chat stream:true
          → NDJSON chunk arrives → onDelta("Hello") → SSE: content_block_delta
          → NDJSON chunk arrives → onDelta(" world") → SSE: content_block_delta
          → done:true → accumulate tool_calls → return ChatCompletionResult
      ← loop: stopReason=end_turn, onDelta already fired → skip post-call emit
  ← full text accumulated for DB persistence
```

## Error Handling

If the Ollama stream errors mid-response, the existing `catch` block throws `Error("Ollama chat completion failed: ...")`. Partial accumulated text is not returned. Behavior is the same as the current non-streaming implementation.

## Out of Scope

- OpenAI and Google providers do not get streaming in this change. The interface extension makes it possible for them to adopt `onDelta` later.
- Tool input streaming (partial JSON as tool arguments arrive) is not implemented. Ollama sends complete tool calls in the final chunk.
- Stream resumption/recovery on network interruption is not implemented.
