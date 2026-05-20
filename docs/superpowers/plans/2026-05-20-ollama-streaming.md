# Ollama Streaming Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable per-token SSE streaming for Ollama-backed models so the frontend receives words progressively instead of one large chunk after full generation.

**Architecture:** Add an optional `onDelta` callback to `ChatCompletionOptions`; `OllamaProvider.chatCompletion` uses `stream: true` and calls `onDelta` per NDJSON chunk; the agentic loop tracks whether `onDelta` was called by the provider to avoid double-firing.

**Tech Stack:** TypeScript, Axios (stream mode), Jest + ts-jest, Node.js stream events (`data`, `error`)

---

## File Map

| File | Change |
|------|--------|
| `backend/src/types/messages.ts` | Add `onDelta?: (text: string) => void` to `ChatCompletionOptions` |
| `backend/src/providers/ollama.ts` | Rewrite `chatCompletion` to use `stream: true`, parse NDJSON, call `onDelta` per chunk |
| `backend/src/services/toolExecutor.ts` | Thread `onDelta` into `chatCompletion` options; skip loop-level emit when provider already called it |
| `backend/tests/providers/ollama.test.ts` | New: unit tests for streaming `chatCompletion` |
| `backend/tests/services/toolExecutor.test.ts` | New: unit tests for double-fire prevention logic |

---

### Task 1: Add `onDelta` to `ChatCompletionOptions`

**Files:**
- Modify: `backend/src/types/messages.ts`

- [ ] **Step 1: Add the optional field**

In `backend/src/types/messages.ts`, update `ChatCompletionOptions`:

```typescript
export interface ChatCompletionOptions {
  messages: MessageParam[];
  tools?: ToolDefinition[];
  model?: string;
  onDelta?: (text: string) => void;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/types/messages.ts
git commit -m "feat: add onDelta callback to ChatCompletionOptions"
```

---

### Task 2: Write failing tests for streaming OllamaProvider

**Files:**
- Create: `backend/tests/providers/ollama.test.ts`

- [ ] **Step 1: Create the test file with axios mock and stream helper**

Create `backend/tests/providers/ollama.test.ts`:

```typescript
import { PassThrough } from 'stream';

jest.mock('axios');
import axios from 'axios';

// Mock pino logger to suppress output in tests
jest.mock('../../src/config/logger', () => ({
  child: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { OllamaProvider } from '../../src/providers/ollama';

const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Builds a fake Axios stream response that emits NDJSON lines then ends. */
function makeStream(lines: object[]) {
  const stream = new PassThrough();
  const response = { data: stream };
  // Emit lines asynchronously so the provider has time to attach listeners
  setImmediate(() => {
    for (const line of lines) {
      stream.push(JSON.stringify(line) + '\n');
    }
    stream.push(null); // end
  });
  return Promise.resolve(response);
}

describe('OllamaProvider.chatCompletion (streaming)', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider('llama3.2');
    jest.clearAllMocks();
  });

  it('calls onDelta for each text chunk and returns accumulated text', async () => {
    mockedAxios.post.mockImplementation(() =>
      makeStream([
        { message: { role: 'assistant', content: 'Hello' }, done: false },
        { message: { role: 'assistant', content: ' world' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true },
      ]),
    );

    const deltas: string[] = [];
    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (t) => deltas.push(t),
    });

    expect(deltas).toEqual(['Hello', ' world']);
    expect(result.text).toBe('Hello world');
    expect(result.stopReason).toBe('end_turn');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('does not call onDelta when option is not provided', async () => {
    mockedAxios.post.mockImplementation(() =>
      makeStream([
        { message: { role: 'assistant', content: 'Hi' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true },
      ]),
    );

    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.text).toBe('Hi');
  });

  it('parses tool calls from the done chunk and returns stopReason tool_use', async () => {
    mockedAxios.post.mockImplementation(() =>
      makeStream([
        { message: { role: 'assistant', content: '' }, done: false },
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { function: { name: 'calculator', arguments: { expression: '2+2' } } },
            ],
          },
          done: true,
        },
      ]),
    );

    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'what is 2+2' }],
    });

    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('calculator');
    expect(result.toolCalls[0].arguments).toEqual({ expression: '2+2' });
    expect(result.contentBlocks.some((b) => b.type === 'tool_use')).toBe(true);
  });

  it('rejects when the stream emits an error', async () => {
    const stream = new PassThrough();
    mockedAxios.post.mockResolvedValue({ data: stream });
    setImmediate(() => stream.destroy(new Error('network failure')));

    await expect(
      provider.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('Ollama chat completion failed: network failure');
  });

  it('uses stream:true in the axios request', async () => {
    mockedAxios.post.mockImplementation(() =>
      makeStream([{ message: { role: 'assistant', content: '' }, done: true }]),
    );

    await provider.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/chat'),
      expect.objectContaining({ stream: true }),
      expect.objectContaining({ responseType: 'stream' }),
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && npx jest tests/providers/ollama.test.ts --no-coverage 2>&1 | tail -20
```

Expected: tests FAIL — `OllamaProvider` does not yet stream.

---

### Task 3: Implement streaming in `OllamaProvider.chatCompletion`

**Files:**
- Modify: `backend/src/providers/ollama.ts`

- [ ] **Step 1: Replace `chatCompletion` with the streaming implementation**

Replace the entire `chatCompletion` method in `backend/src/providers/ollama.ts` (lines 30–127):

```typescript
async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const { messages, tools, onDelta } = options;
  const model = options.model || this.model;

  const supportsTools = TOOL_CAPABLE_MODELS.some((m) => model.includes(m));
  const ollamaTools = supportsTools && tools && tools.length > 0
    ? tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }))
    : undefined;

  log.debug({
    model,
    supportsTools,
    toolsProvided: tools?.length || 0,
    ollamaToolsCount: ollamaTools?.length || 0,
  }, 'Tool support check');

  const ollamaMessages = messages.map((msg) => {
    const formatted: { role: string; content: string } = { role: msg.role, content: '' };

    if (typeof msg.content === 'string') {
      formatted.content = msg.content;
    } else if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text);
      formatted.content = textParts.join(' ');

      const toolResult = msg.content.find((b) => b.type === 'tool_result');
      if (toolResult && 'content' in toolResult) {
        formatted.role = 'tool';
        formatted.content = toolResult.content || '';
      }
    }

    return formatted;
  });

  try {
    const request: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: true,
    };

    if (ollamaTools) {
      request.tools = ollamaTools;
    }

    const response = await axios.post(`${OLLAMA_BASE_URL}/chat`, request, {
      responseType: 'stream',
    });

    return new Promise((resolve, reject) => {
      let accumulatedText = '';
      let buffer = '';

      response.data.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const textChunk: string = parsed.message?.content ?? '';

            if (textChunk) {
              accumulatedText += textChunk;
              onDelta?.(textChunk);
            }

            if (parsed.done) {
              const contentBlocks: ContentBlock[] = [];
              const toolCalls: ToolCall[] = [];

              if (accumulatedText) {
                contentBlocks.push({ type: 'text', text: accumulatedText });
              }

              const rawToolCalls = parsed.message?.tool_calls ?? [];
              for (let i = 0; i < rawToolCalls.length; i++) {
                const tc = rawToolCalls[i];
                const toolCall: ToolCall = {
                  id: `call_${Date.now()}_${i}`,
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                };
                toolCalls.push(toolCall);
                contentBlocks.push({
                  type: 'tool_use',
                  id: toolCall.id,
                  name: toolCall.name,
                  input: toolCall.arguments,
                });
              }

              resolve({
                text: accumulatedText,
                contentBlocks,
                toolCalls,
                stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
              });
            }
          } catch (err) {
            log.error({ err, line }, 'Error parsing stream chunk');
          }
        }
      });

      response.data.on('error', (err: Error) => {
        log.error({ err, model }, 'Stream error');
        reject(new Error(`Ollama chat completion failed: ${err.message}`));
      });
    });
  } catch (error: any) {
    log.error({ err: error, model }, 'chatCompletion failed');
    throw new Error(`Ollama chat completion failed: ${error.message}`);
  }
}
```

- [ ] **Step 2: Run the provider tests**

```bash
cd backend && npx jest tests/providers/ollama.test.ts --no-coverage 2>&1 | tail -20
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
cd backend && npx jest --no-coverage 2>&1 | tail -20
```

Expected: all existing tests still pass.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/providers/ollama.ts backend/tests/providers/ollama.test.ts
git commit -m "feat: stream Ollama chatCompletion with per-token onDelta callbacks"
```

---

### Task 4: Write failing tests for updated `toolExecutor`

**Files:**
- Create: `backend/tests/services/toolExecutor.test.ts`

- [ ] **Step 1: Create the test file**

Create `backend/tests/services/toolExecutor.test.ts`:

```typescript
jest.mock('../../src/services/toolRegistry', () => ({
  toolRegistry: {
    execute: jest.fn(),
    getDefinitions: jest.fn(() => []),
  },
}));

jest.mock('../../src/config/logger', () => ({
  child: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { runAgenticLoop, AgenticLoopCallbacks } from '../../src/services/toolExecutor';
import { AIProvider, ProviderCapabilities } from '../../src/providers/types';
import { ChatCompletionOptions, ChatCompletionResult } from '../../src/types';

function makeProvider(
  behavior: (options: ChatCompletionOptions) => ChatCompletionResult,
): AIProvider {
  return {
    name: 'test',
    capabilities: { chatCompletion: true, streaming: false, imageAnalysis: false } as ProviderCapabilities,
    chatCompletion: jest.fn(async (options: ChatCompletionOptions) => behavior(options)),
  };
}

const baseMessages = [{ role: 'user' as const, content: 'hello' }];
const noTools: never[] = [];

describe('runAgenticLoop — onDelta double-fire prevention', () => {
  let callbacks: AgenticLoopCallbacks;

  beforeEach(() => {
    callbacks = {
      onDelta: jest.fn(),
      onToolUseStart: jest.fn(),
      onToolUseResult: jest.fn(),
    };
  });

  it('calls callbacks.onDelta once when provider does NOT call onDelta internally', async () => {
    // Simulates OpenAI/Google: ignores options.onDelta, returns full text
    const provider = makeProvider(() => ({
      text: 'Hello',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
      toolCalls: [],
      stopReason: 'end_turn',
    }));

    await runAgenticLoop(provider, baseMessages, noTools, callbacks);

    expect(callbacks.onDelta).toHaveBeenCalledTimes(1);
    expect(callbacks.onDelta).toHaveBeenCalledWith('Hello');
  });

  it('does NOT double-fire when provider already called onDelta per-token (streaming)', async () => {
    // Simulates Ollama streaming: calls options.onDelta per token
    const provider = makeProvider((options: ChatCompletionOptions) => {
      options.onDelta?.('Hello');
      options.onDelta?.(' world');
      return {
        text: 'Hello world',
        contentBlocks: [{ type: 'text', text: 'Hello world' }],
        toolCalls: [],
        stopReason: 'end_turn',
      };
    });

    await runAgenticLoop(provider, baseMessages, noTools, callbacks);

    // onDelta called exactly twice (per-token), NOT a third time by the loop
    expect(callbacks.onDelta).toHaveBeenCalledTimes(2);
    expect(callbacks.onDelta).toHaveBeenNthCalledWith(1, 'Hello');
    expect(callbacks.onDelta).toHaveBeenNthCalledWith(2, ' world');
  });

  it('returns correct finalText regardless of streaming mode', async () => {
    const provider = makeProvider((options: ChatCompletionOptions) => {
      options.onDelta?.('streamed');
      return {
        text: 'streamed',
        contentBlocks: [{ type: 'text', text: 'streamed' }],
        toolCalls: [],
        stopReason: 'end_turn',
      };
    });

    const result = await runAgenticLoop(provider, baseMessages, noTools, callbacks);

    expect(result.finalText).toBe('streamed');
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd backend && npx jest tests/services/toolExecutor.test.ts --no-coverage 2>&1 | tail -20
```

Expected: "does NOT double-fire" test FAILS — loop currently double-fires.

---

### Task 5: Update `toolExecutor` to thread `onDelta` and prevent double-fire

**Files:**
- Modify: `backend/src/services/toolExecutor.ts`

The fix uses a tracking wrapper: if the provider calls `onDelta` during `chatCompletion`, the loop skips its own post-call emit. If the provider ignores it (OpenAI/Google), the loop emits as before.

- [ ] **Step 1: Apply the changes to `runAgenticLoop`**

In `backend/src/services/toolExecutor.ts`, replace the loop body inside the `for` loop (lines 45–119):

```typescript
for (let i = 0; i < maxIterations; i++) {
  log.debug({ iteration: i + 1, messageCount: messages.length }, 'Loop iteration start');

  // Track whether the provider called onDelta per-token (streaming providers)
  let providerCalledOnDelta = false;
  const trackedOnDelta = (text: string) => {
    providerCalledOnDelta = true;
    callbacks.onDelta(text);
  };

  // 1. Call provider with messages + tool definitions + onDelta tracker
  const response = await provider.chatCompletion({ messages, tools, onDelta: trackedOnDelta });

  // 2. If no tool calls → done
  if (response.stopReason !== 'tool_use' || response.toolCalls.length === 0) {
    finalText = response.text;
    // Only emit if provider did not already stream tokens
    if (!providerCalledOnDelta && finalText) {
      callbacks.onDelta(finalText);
    }
    log.debug({ iteration: i + 1 }, 'Loop complete — text response');
    break;
  }

  // Stream any partial text before tool calls (only if provider didn't stream it)
  if (response.text) {
    finalText += response.text;
    if (!providerCalledOnDelta) {
      callbacks.onDelta(response.text);
    }
  }

  // 3. Append assistant message with content blocks
  messages.push({
    role: 'assistant',
    content: response.contentBlocks,
    tool_calls: response.toolCalls,
  });

  // 4. Execute ALL tool calls in parallel (Anthropic pattern)
  const toolCallPromises = response.toolCalls.map(async (toolCall): Promise<ToolCallRecord> => {
    callbacks.onToolUseStart(toolCall);
    log.info({ tool: toolCall.name, input: toolCall.arguments }, 'Tool call start');

    const start = Date.now();
    const result = await toolRegistry.execute(toolCall.name, toolCall.arguments);
    const durationMs = Date.now() - start;

    if (result.output.length > MAX_TOOL_OUTPUT_LENGTH) {
      log.warn({ tool: toolCall.name, originalLength: result.output.length }, 'Tool output truncated');
      result.output = result.output.substring(0, MAX_TOOL_OUTPUT_LENGTH) + '\n\n[Output truncated]';
    }

    log.debug({
      tool: toolCall.name,
      outputPreview: result.output.substring(0, 500),
      outputLength: result.output.length
    }, 'Tool output preview');

    log.info({ tool: toolCall.name, durationMs, is_error: result.is_error }, 'Tool call end');
    callbacks.onToolUseResult(toolCall.id, toolCall.name, result);

    return { call: toolCall, result, durationMs };
  });

  const records = await Promise.all(toolCallPromises);
  allRecords.push(...records);

  // 5. Append tool results as user message with tool_result blocks
  const toolResultBlocks: ToolResultBlockParam[] = records.map((r) => ({
    type: 'tool_result' as const,
    tool_use_id: r.call.id,
    content: r.result.output,
    is_error: r.result.is_error,
  }));

  messages.push({
    role: 'user',
    content: toolResultBlocks,
  });
}
```

- [ ] **Step 2: Run the toolExecutor tests**

```bash
cd backend && npx jest tests/services/toolExecutor.test.ts --no-coverage 2>&1 | tail -20
```

Expected: all 3 tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
cd backend && npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests pass, no regressions.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/toolExecutor.ts backend/tests/services/toolExecutor.test.ts
git commit -m "feat: thread onDelta through agentic loop, prevent double-fire for streaming providers"
```

---

## Done Criteria

- `npm test` in `backend/` passes with all new and existing tests green
- `npx tsc --noEmit` reports no errors
- Sending a message via an Ollama model produces multiple SSE `content_block_delta` events progressively, not one large chunk
