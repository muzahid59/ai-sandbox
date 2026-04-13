# Claude API Features - Technical Design Document

**Date:** 2026-04-13  
**Version:** 1.0  
**Status:** Design Phase  
**Target:** ai-sandbox backend (Express + TypeScript + Prisma)

---

## Table of Contents

1. [Design Principles](#design-principles)
2. [Implementation Roadmap](#implementation-roadmap)
3. [Phase 1: Quick Wins](#phase-1-quick-wins)
4. [Phase 2: Streaming Architecture](#phase-2-streaming-architecture)
5. [Phase 3: Vision & Multi-Modal](#phase-3-vision--multi-modal)
6. [Phase 4: Prompt Caching](#phase-4-prompt-caching)
7. [Phase 5: Batch Processing](#phase-5-batch-processing)
8. [Phase 6: Output Configuration](#phase-6-output-configuration)
9. [Testing Strategy](#testing-strategy)
10. [Migration Path](#migration-path)
11. [Appendix](#appendix)

---

## Design Principles

### 1. **Provider Abstraction**
Features should be abstracted in the `AIProvider` interface, with degradation for providers that don't support them.

**Example:** Extended thinking supported by Claude, falls back to standard chat for OpenAI/Gemini.

### 2. **Type Safety**
Discriminated unions for content blocks, strict typing for tool schemas, Zod integration where possible.

### 3. **Backward Compatibility**
New features should be opt-in. Existing endpoints continue to work unchanged.

### 4. **Database-First**
Store rich metadata (thinking tokens, cache hits, tool calls) for analytics and debugging.

### 5. **Cost Transparency**
Track and expose token usage, cache savings, batch discounts to users.

---

## Implementation Roadmap

| Phase | Features | Duration | Priority |
|-------|----------|----------|----------|
| **Phase 1** | Extended Thinking, Strict Tool Use, Tool Choice | 1-2 weeks | 🔴 High |
| **Phase 2** | Streaming Refactor | 3-4 weeks | 🔴 High |
| **Phase 3** | Vision & PDF Support | 3-4 weeks | 🔴 High |
| **Phase 4** | Prompt Caching | 2-3 weeks | 🟡 Medium |
| **Phase 5** | Batch API | 4-6 weeks | 🟡 Medium |
| **Phase 6** | Output Configuration | 2-3 weeks | 🟢 Low |

---

## Phase 1: Quick Wins

**Goal:** Add extended thinking, strict tool use, and tool choice control with minimal architectural changes.

**Impact:** Better reasoning quality, safer tool execution, workflow control.

### 1.1 Extended Thinking

#### Type System Updates

**File:** `backend/src/types/content.ts`

```typescript
// Add new content block type
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

// Update ContentBlock union
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock;  // Add this

// Content block param for requests (no thinking - output only)
export type ContentBlockParam =
  | TextBlockParam
  | ToolUseBlockParam;
```

**File:** `backend/src/types/messages.ts`

```typescript
// Add thinking configuration
export interface ThinkingConfig {
  type: 'enabled';
  budget_tokens?: number;  // Min 1024, max model-dependent
}

export interface ChatCompletionOptions {
  messages: MessageParam[];
  tools?: ToolDefinition[];
  model?: string;
  thinking?: ThinkingConfig;  // NEW
}

export interface ChatCompletionResult {
  text: string;
  contentBlocks: ContentBlock[];
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    thinking_tokens?: number;  // NEW
  };
}
```

#### Provider Interface Updates

**File:** `backend/src/providers/types.ts`

```typescript
export interface ProviderCapabilities {
  chatCompletion: boolean;
  streaming: boolean;
  imageAnalysis: boolean;
  extendedThinking: boolean;  // NEW
}
```

#### Claude Provider Implementation

**File:** `backend/src/providers/anthropic.ts` (NEW FILE)

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { AIProvider, ProviderCapabilities } from './types';
import { ChatCompletionOptions, ChatCompletionResult, ContentBlock } from '../types';
import logger from '../config/logger';

const log = logger.child({ provider: 'anthropic' });

export class AnthropicProvider implements AIProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities = {
    chatCompletion: true,
    streaming: true,
    imageAnalysis: true,
    extendedThinking: true,  // Supported!
  };

  private client: Anthropic;

  constructor(apiKey: string, private readonly model: string = 'claude-4.6-opus') {
    this.name = `anthropic/${model}`;
    this.client = new Anthropic({ apiKey });
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const { messages, tools, thinking } = options;
    const model = options.model || this.model;

    // Convert tools to Anthropic format
    const anthropicTools = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    // Convert messages to Anthropic format
    const anthropicMessages = messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return { role: msg.role as 'user' | 'assistant', content: msg.content };
      }
      // Handle content blocks (text, tool_use, tool_result)
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content.map((block) => {
          if (block.type === 'text') {
            return { type: 'text', text: block.text };
          }
          if (block.type === 'tool_use') {
            return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
          }
          if (block.type === 'tool_result') {
            return {
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            };
          }
          return block;
        }),
      };
    });

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: 4096,
        messages: anthropicMessages as any,
        ...(anthropicTools && { tools: anthropicTools }),
        ...(thinking && { thinking }),  // Pass through thinking config
      });

      const contentBlocks: ContentBlock[] = [];
      const toolCalls: ToolCall[] = [];
      let text = '';

      for (const block of response.content) {
        if (block.type === 'text') {
          contentBlocks.push({ type: 'text', text: block.text });
          text += block.text;
        } else if (block.type === 'thinking') {
          contentBlocks.push({ type: 'thinking', thinking: block.thinking });
          // Don't include thinking in final text
        } else if (block.type === 'tool_use') {
          const toolCall = {
            id: block.id,
            name: block.name,
            arguments: block.input,
          };
          toolCalls.push(toolCall);
          contentBlocks.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }

      const stopReason = response.stop_reason === 'tool_use' ? 'tool_use'
        : response.stop_reason === 'max_tokens' ? 'max_tokens'
        : 'end_turn';

      return {
        text,
        contentBlocks,
        toolCalls,
        stopReason,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          thinking_tokens: (response.usage as any).thinking_tokens,  // If available
        },
      };
    } catch (error: any) {
      log.error({ err: error, model }, 'chatCompletion failed');
      throw new Error(`Anthropic chat completion failed: ${error.message}`);
    }
  }
}
```

#### Provider Factory Update

**File:** `backend/services/ai_factory.js`

```javascript
const { AnthropicProvider } = require('../src/providers/anthropic');

class AIFactory {
  static createService(type) {
    switch (type) {
      case 'anthropic':
        return new AnthropicProvider(
          process.env.ANTHROPIC_API_KEY,
          'claude-4.6-opus'
        );
      // ... existing providers
    }
  }
}
```

#### API Endpoint Update

**File:** `backend/src/routes/threads.ts`

```typescript
// Add thinking parameter to POST /api/v1/threads/:id/messages
router.post('/:threadId/messages', requireAuth, async (req, res) => {
  const { content, model, thinking } = req.body;  // Add thinking param

  // Validate thinking config
  if (thinking) {
    if (thinking.type !== 'enabled') {
      return res.status(400).json({ error: 'Invalid thinking type' });
    }
    if (thinking.budget_tokens && thinking.budget_tokens < 1024) {
      return res.status(400).json({ error: 'Minimum thinking budget is 1024 tokens' });
    }
  }

  // Pass thinking config to agentic loop
  const result = await runAgenticLoop(provider, messages, tools, callbacks, 10, thinking);
});
```

#### Database Schema Update

**File:** `backend/prisma/schema.prisma`

```prisma
model Message {
  id              String   @id @default(uuid())
  threadId        String
  role            String   // 'user' | 'assistant'
  content         Json     // ContentBlock[]
  toolCalls       Json?    // ToolCall[]
  stopReason      String?
  inputTokens     Int?
  outputTokens    Int?
  thinkingTokens  Int?     // NEW
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  thread Thread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId])
}
```

**Migration:**

```bash
cd backend
npx prisma migrate dev --name add_thinking_tokens
```

#### Frontend Display

**File:** `app/src/components/MessageBubble.js`

```javascript
function MessageBubble({ message }) {
  const thinkingBlock = message.content.find(b => b.type === 'thinking');
  const textBlocks = message.content.filter(b => b.type === 'text');

  return (
    <div className={styles.bubble}>
      {thinkingBlock && (
        <details className={styles.thinking}>
          <summary>
            Show reasoning ({(message.thinkingTokens || 0).toLocaleString()} tokens)
          </summary>
          <pre className={styles.thinkingContent}>{thinkingBlock.thinking}</pre>
        </details>
      )}
      {textBlocks.map((block, i) => (
        <p key={i}>{block.text}</p>
      ))}
    </div>
  );
}
```

**CSS:**

```css
.thinking {
  background: #f5f5f5;
  border-left: 3px solid #0066cc;
  padding: 8px;
  margin-bottom: 12px;
  font-size: 0.9em;
  cursor: pointer;
}

.thinking summary {
  font-weight: 600;
  color: #0066cc;
}

.thinkingContent {
  margin-top: 8px;
  font-family: monospace;
  white-space: pre-wrap;
  color: #666;
}
```

### 1.2 Strict Tool Use

#### Type System Update

**File:** `backend/src/types/messages.ts`

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  strict?: boolean;  // NEW - Claude validates schema
}
```

#### Tool Registry Update

**File:** `backend/src/services/toolRegistry.ts`

```typescript
interface ToolRegistration {
  definition: ToolDefinition;
  handler: ToolHandler;
  strict?: boolean;  // NEW
}

class ToolRegistry {
  register(name: string, definition: ToolDefinition, handler: ToolHandler, strict = false) {
    this.tools.set(name, {
      definition: { ...definition, strict },  // Add strict flag
      handler,
    });
  }
}
```

#### Tool Definitions Update

**File:** `backend/src/tools/calculator.ts`

```typescript
export const definition: ToolDefinition = {
  name: 'calculator',
  description: 'Evaluate mathematical expressions',
  input_schema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Math expression to evaluate (e.g., "2 + 2 * 3")',
      },
    },
    required: ['expression'],
  },
  strict: true,  // NEW - Claude guarantees valid input
};
```

#### Provider Implementation

Anthropic provider already supports `strict` in tool definitions (pass through to API).

For OpenAI/Gemini (no strict mode), add fallback validation:

**File:** `backend/src/services/toolExecutor.ts`

```typescript
import Ajv from 'ajv';

const ajv = new Ajv();

async function validateToolInput(toolCall: ToolCall, definition: ToolDefinition): Promise<void> {
  // Skip validation if provider supports strict mode
  if (definition.strict && providerSupportsStrict) {
    return;
  }

  // Fallback validation for non-strict providers
  const validate = ajv.compile(definition.input_schema);
  const valid = validate(toolCall.arguments);

  if (!valid) {
    throw new Error(`Invalid tool input: ${ajv.errorsText(validate.errors)}`);
  }
}

// In runAgenticLoop, validate before execution
const result = await validateToolInput(toolCall, toolDef);
if (!result.valid) {
  return {
    output: `Validation error: ${result.error}`,
    is_error: true,
  };
}
```

### 1.3 Tool Choice Control

#### Type System Update

**File:** `backend/src/types/messages.ts`

```typescript
export type ToolChoice = 
  | 'auto'   // Model decides (default)
  | 'any'    // Must use at least one tool
  | 'none'   // No tools allowed
  | { type: 'tool'; name: string };  // Force specific tool

export interface ChatCompletionOptions {
  messages: MessageParam[];
  tools?: ToolDefinition[];
  model?: string;
  thinking?: ThinkingConfig;
  tool_choice?: ToolChoice;  // NEW
}
```

#### Provider Implementation

**Anthropic:**

```typescript
const response = await this.client.messages.create({
  model,
  messages: anthropicMessages,
  tools: anthropicTools,
  tool_choice: options.tool_choice,  // Pass through
});
```

**OpenAI:**

```typescript
// Map to OpenAI format
let toolChoice: any = undefined;
if (options.tool_choice === 'auto') {
  toolChoice = 'auto';
} else if (options.tool_choice === 'any') {
  toolChoice = 'required';  // OpenAI equivalent
} else if (options.tool_choice === 'none') {
  toolChoice = 'none';
} else if (typeof options.tool_choice === 'object') {
  toolChoice = {
    type: 'function',
    function: { name: options.tool_choice.name },
  };
}

const response = await this.client.chat.completions.create({
  model,
  messages: openaiMessages,
  tools: openaiTools,
  tool_choice: toolChoice,
});
```

#### API Endpoint Update

**File:** `backend/src/routes/threads.ts`

```typescript
router.post('/:threadId/messages', requireAuth, async (req, res) => {
  const { content, model, thinking, tool_choice } = req.body;

  // Validate tool_choice
  if (tool_choice) {
    const validChoices = ['auto', 'any', 'none'];
    if (typeof tool_choice === 'string' && !validChoices.includes(tool_choice)) {
      return res.status(400).json({ error: 'Invalid tool_choice' });
    }
    if (typeof tool_choice === 'object' && tool_choice.type !== 'tool') {
      return res.status(400).json({ error: 'Invalid tool_choice object' });
    }
  }

  // Pass to provider
  const result = await runAgenticLoop(provider, messages, tools, callbacks, 10, {
    thinking,
    tool_choice,
  });
});
```

### 1.4 Testing

**File:** `backend/tests/thinking.test.ts`

```typescript
import { AnthropicProvider } from '../src/providers/anthropic';

describe('Extended Thinking', () => {
  it('should include thinking block in response', async () => {
    const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!);
    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'Solve: 123 * 456' }],
      thinking: { type: 'enabled', budget_tokens: 5000 },
    });

    const thinkingBlock = result.contentBlocks.find(b => b.type === 'thinking');
    expect(thinkingBlock).toBeDefined();
    expect(result.usage?.thinking_tokens).toBeGreaterThan(0);
  });
});
```

**File:** `backend/tests/strict-tools.test.ts`

```typescript
describe('Strict Tool Use', () => {
  it('should enforce schema with strict mode', async () => {
    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'Calculate 2 + 2' }],
      tools: [{ ...calculatorTool, strict: true }],
    });

    const toolCall = result.toolCalls[0];
    expect(toolCall.arguments).toHaveProperty('expression');
  });
});
```

---

## Phase 2: Streaming Architecture

**Goal:** Refactor providers to stream responses via SSE with real-time deltas.

**Impact:** Reduced perceived latency, real-time tool use feedback.

### 2.1 Provider Interface Update

**File:** `backend/src/providers/types.ts`

```typescript
export interface StreamCallbacks {
  onContentBlockStart: (index: number, type: string) => void;
  onTextDelta: (delta: string, snapshot: string) => void;
  onToolUseDelta: (toolUseId: string, name: string, inputJsonDelta: string) => void;
  onContentBlockStop: (index: number) => void;
  onMessageStop: (message: ChatCompletionResult) => void;
  onError: (error: Error) => void;
}

export interface AIProvider {
  name: string;
  capabilities: ProviderCapabilities;
  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
  chatCompletionStream?(options: ChatCompletionOptions, callbacks: StreamCallbacks): Promise<void>;  // NEW
}
```

### 2.2 Anthropic Streaming Implementation

**File:** `backend/src/providers/anthropic.ts`

```typescript
async chatCompletionStream(
  options: ChatCompletionOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  const { messages, tools, thinking, tool_choice } = options;

  const stream = this.client.messages.stream({
    model: options.model || this.model,
    max_tokens: 4096,
    messages: this.convertMessages(messages),
    ...(tools && { tools: this.convertTools(tools) }),
    ...(thinking && { thinking }),
    ...(tool_choice && { tool_choice }),
  });

  let textSnapshot = '';

  stream
    .on('contentBlockStart', ({ index, content_block }) => {
      callbacks.onContentBlockStart(index, content_block.type);
    })
    .on('text', (delta, snapshot) => {
      textSnapshot = snapshot;
      callbacks.onTextDelta(delta, snapshot);
    })
    .on('contentBlockStop', ({ index }) => {
      callbacks.onContentBlockStop(index);
    })
    .on('message', (message) => {
      callbacks.onMessageStop(this.convertResponse(message));
    })
    .on('error', (error) => {
      callbacks.onError(error);
    });

  await stream.done();
}
```

### 2.3 OpenAI Streaming Implementation

**File:** `backend/src/providers/openai.ts`

```typescript
async chatCompletionStream(
  options: ChatCompletionOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  const stream = await this.client.chat.completions.create({
    model: options.model || this.model,
    messages: this.convertMessages(options.messages),
    ...(options.tools && { tools: this.convertTools(options.tools) }),
    stream: true,
  });

  let textSnapshot = '';
  let currentBlockIndex = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (delta?.content) {
      textSnapshot += delta.content;
      callbacks.onTextDelta(delta.content, textSnapshot);
    }

    if (delta?.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        if (toolCall.function?.arguments) {
          callbacks.onToolUseDelta(
            toolCall.id,
            toolCall.function.name,
            toolCall.function.arguments
          );
        }
      }
    }

    if (chunk.choices[0]?.finish_reason) {
      callbacks.onContentBlockStop(currentBlockIndex);
    }
  }
}
```

### 2.4 Agentic Loop Streaming Refactor

**File:** `backend/src/services/toolExecutor.ts`

```typescript
export async function runAgenticLoopStream(
  provider: AIProvider,
  messages: MessageParam[],
  tools: ToolDefinition[],
  sseWriter: SSEWriter,  // NEW - handles res.write()
  maxIterations = 10,
): Promise<void> {
  if (!provider.chatCompletionStream) {
    throw new Error('Provider does not support streaming');
  }

  for (let i = 0; i < maxIterations; i++) {
    let stopReason: StopReason = 'end_turn';
    const toolCalls: ToolCall[] = [];
    let currentToolUseId: string;
    let currentToolName: string;
    let currentToolInput = '';

    await provider.chatCompletionStream(
      { messages, tools },
      {
        onContentBlockStart: (index, type) => {
          if (type === 'text') {
            sseWriter.write({ type: 'content_block_start', index, block_type: 'text' });
          } else if (type === 'tool_use') {
            sseWriter.write({ type: 'content_block_start', index, block_type: 'tool_use' });
          }
        },
        onTextDelta: (delta) => {
          sseWriter.write({ type: 'delta', text: delta });
        },
        onToolUseDelta: (toolUseId, name, inputJsonDelta) => {
          if (!currentToolUseId) {
            currentToolUseId = toolUseId;
            currentToolName = name;
            sseWriter.write({
              type: 'tool_use_start',
              tool_call_id: toolUseId,
              name,
            });
          }
          currentToolInput += inputJsonDelta;
          sseWriter.write({
            type: 'tool_use_delta',
            tool_call_id: toolUseId,
            input_json_delta: inputJsonDelta,
          });
        },
        onContentBlockStop: () => {
          if (currentToolUseId) {
            const toolCall = {
              id: currentToolUseId,
              name: currentToolName,
              arguments: JSON.parse(currentToolInput),
            };
            toolCalls.push(toolCall);
            currentToolUseId = '';
            currentToolInput = '';
          }
        },
        onMessageStop: (message) => {
          stopReason = message.stopReason;
        },
        onError: (error) => {
          sseWriter.write({
            type: 'error',
            error: error.message,
          });
          throw error;
        },
      }
    );

    if (stopReason !== 'tool_use' || toolCalls.length === 0) {
      sseWriter.write({ type: 'done', stop_reason: stopReason });
      return;
    }

    // Execute tools in parallel
    const toolResultPromises = toolCalls.map(async (toolCall) => {
      sseWriter.write({
        type: 'tool_execution_start',
        tool_call_id: toolCall.id,
        name: toolCall.name,
      });

      const result = await toolRegistry.execute(toolCall.name, toolCall.arguments);

      sseWriter.write({
        type: 'tool_execution_result',
        tool_call_id: toolCall.id,
        success: !result.is_error,
        output: result.output,
      });

      return {
        type: 'tool_result' as const,
        tool_use_id: toolCall.id,
        content: result.output,
        is_error: result.is_error,
      };
    });

    const toolResults = await Promise.all(toolResultPromises);

    messages.push({
      role: 'assistant',
      content: toolCalls.map(tc => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.arguments,
      })),
    });

    messages.push({
      role: 'user',
      content: toolResults,
    });
  }
}
```

### 2.5 SSE Writer Utility

**File:** `backend/src/utils/sseWriter.ts`

```typescript
import { Response } from 'express';

export class SSEWriter {
  constructor(private res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  }

  write(data: Record<string, any>): void {
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  end(): void {
    this.res.end();
  }
}
```

### 2.6 API Endpoint Update

**File:** `backend/src/routes/threads.ts`

```typescript
router.post('/:threadId/messages', requireAuth, async (req, res) => {
  const { content, model, thinking, tool_choice, stream = true } = req.body;

  const provider = AIFactory.createService(model || 'openai');

  if (stream && provider.chatCompletionStream) {
    const sseWriter = new SSEWriter(res);

    try {
      await runAgenticLoopStream(provider, messages, tools, sseWriter);
    } catch (error) {
      sseWriter.write({ type: 'error', error: error.message });
    } finally {
      sseWriter.end();
    }
  } else {
    // Fallback to non-streaming
    const result = await runAgenticLoop(provider, messages, tools, callbacks);
    res.json(result);
  }
});
```

### 2.7 Frontend Streaming Client

**File:** `app/src/api.js`

```javascript
export async function sendMessageStream(threadId, content, model, options, callbacks) {
  const response = await fetch(`${API_BASE}/api/v1/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, model, stream: true, ...options }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';  // Keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = JSON.parse(line.slice(6));

      if (data.type === 'delta' && callbacks.onTextDelta) {
        callbacks.onTextDelta(data.text);
      } else if (data.type === 'tool_use_start' && callbacks.onToolUseStart) {
        callbacks.onToolUseStart(data.tool_call_id, data.name);
      } else if (data.type === 'tool_execution_result' && callbacks.onToolResult) {
        callbacks.onToolResult(data.tool_call_id, data.success, data.output);
      } else if (data.type === 'done' && callbacks.onDone) {
        callbacks.onDone(data.stop_reason);
      } else if (data.type === 'error' && callbacks.onError) {
        callbacks.onError(data.error);
      }
    }
  }
}
```

---

## Phase 3: Vision & Multi-Modal

**Goal:** Support images and PDFs in message content with S3 storage.

**Impact:** Multi-modal conversations (screenshot debugging, diagram analysis, PDF Q&A).

### 3.1 Type System Update

**File:** `backend/src/types/content.ts`

```typescript
export interface ImageSource {
  type: 'base64' | 'url';
  media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data?: string;  // Base64 if type=base64
  url?: string;   // HTTP(S) URL if type=url
}

export interface ImageBlock {
  type: 'image';
  source: ImageSource;
}

export interface DocumentSource {
  type: 'base64' | 'url';
  media_type: 'application/pdf';
  data?: string;
  url?: string;
}

export interface DocumentBlock {
  type: 'document';
  source: DocumentSource;
}

// Update ContentBlock union
export type ContentBlock =
  | TextBlock
  | ImageBlock      // NEW
  | DocumentBlock   // NEW
  | ToolUseBlock
  | ThinkingBlock;

export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam  // NEW
  | DocumentBlockParam  // NEW
  | ToolUseBlockParam;
```

### 3.2 Database Schema Update

**File:** `backend/prisma/schema.prisma`

```prisma
model Attachment {
  id          String   @id @default(uuid())
  messageId   String
  type        String   // 'image' | 'document'
  mediaType   String   // MIME type
  storageUrl  String   // S3 URL
  fileName    String?
  fileSize    Int?
  createdAt   DateTime @default(now())

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([messageId])
}

model Message {
  // ... existing fields
  attachments Attachment[]
}
```

**Migration:**

```bash
npx prisma migrate dev --name add_attachments
```

### 3.3 File Upload Service

**File:** `backend/src/services/fileUploadService.ts`

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.S3_BUCKET!;

export async function uploadFile(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const key = `attachments/${crypto.randomUUID()}-${fileName}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  }));

  return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

export async function convertUrlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}
```

### 3.4 API Endpoint Update

**File:** `backend/src/routes/threads.ts`

```typescript
import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },  // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  },
});

router.post(
  '/:threadId/messages',
  requireAuth,
  upload.array('attachments', 10),  // Max 10 files
  async (req, res) => {
    const { content, model } = req.body;
    const files = req.files as Express.Multer.File[];

    // Upload files to S3
    const uploadedUrls = await Promise.all(
      files.map(file => uploadFile(file.buffer, file.mimetype, file.originalname))
    );

    // Build content blocks with images/PDFs
    const contentBlocks: ContentBlockParam[] = [
      { type: 'text', text: content },
    ];

    for (const url of uploadedUrls) {
      const file = files[uploadedUrls.indexOf(url)];
      if (file.mimetype.startsWith('image/')) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'url',
            media_type: file.mimetype as any,
            url,
          },
        });
      } else if (file.mimetype === 'application/pdf') {
        contentBlocks.push({
          type: 'document',
          source: {
            type: 'url',
            media_type: 'application/pdf',
            url,
          },
        });
      }
    }

    // Save attachments to DB
    await prisma.attachment.createMany({
      data: uploadedUrls.map((url, i) => ({
        messageId: userMessage.id,
        type: files[i].mimetype.startsWith('image/') ? 'image' : 'document',
        mediaType: files[i].mimetype,
        storageUrl: url,
        fileName: files[i].originalname,
        fileSize: files[i].size,
      })),
    });

    // Send to provider
    const result = await runAgenticLoop(provider, messages, tools, callbacks);
    res.json(result);
  }
);
```

### 3.5 Provider Implementation

**Anthropic:**

```typescript
// Images passed directly in content blocks
const anthropicMessages = messages.map((msg) => {
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content };
  }

  return {
    role: msg.role,
    content: msg.content.map((block) => {
      if (block.type === 'image') {
        // Convert URL to base64 for Anthropic
        const base64 = await convertUrlToBase64(block.source.url);
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.source.media_type,
            data: base64,
          },
        };
      }
      if (block.type === 'document') {
        const base64 = await convertUrlToBase64(block.source.url);
        return {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64,
          },
        };
      }
      return block;
    }),
  };
});
```

**OpenAI:**

```typescript
// OpenAI uses vision via image_url type
const openaiMessages = messages.map((msg) => {
  const content: any[] = [];

  for (const block of msg.content) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text });
    } else if (block.type === 'image') {
      content.push({
        type: 'image_url',
        image_url: { url: block.source.url },  // OpenAI accepts URLs directly
      });
    }
    // OpenAI doesn't support PDFs in messages
  }

  return { role: msg.role, content };
});
```

### 3.6 Frontend File Upload

**File:** `app/src/components/ChatInput.js`

```javascript
function ChatInput({ onSend }) {
  const [files, setFiles] = useState([]);

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files);
    setFiles(selected);
  };

  const handleSend = async () => {
    const formData = new FormData();
    formData.append('content', inputValue);
    formData.append('model', model);
    files.forEach(file => formData.append('attachments', file));

    await fetch(`/api/v1/threads/${threadId}/messages`, {
      method: 'POST',
      body: formData,  // No Content-Type header (browser sets multipart/form-data)
    });
  };

  return (
    <div>
      <input type="file" multiple accept="image/*,.pdf" onChange={handleFileSelect} />
      {files.map(f => <span key={f.name}>{f.name}</span>)}
      <textarea value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
      <button onClick={handleSend}>Send</button>
    </div>
  );
}
```

---

## Phase 4: Prompt Caching

**Goal:** Reduce costs by 90% with automatic prompt caching.

**Impact:** Lower API costs on repeated context (system prompts, tool definitions, codebase context).

### 4.1 Type System Update

**File:** `backend/src/types/content.ts`

```typescript
export interface CacheControl {
  type: 'ephemeral';
}

export interface TextBlockParam {
  type: 'text';
  text: string;
  cache_control?: CacheControl;  // NEW
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  strict?: boolean;
  cache_control?: CacheControl;  // NEW
}
```

### 4.2 Context Service Update

**File:** `backend/src/services/contextService.ts`

```typescript
interface ContextOptions {
  enableCaching?: boolean;
  cacheBreakpoints?: {
    afterSystemPrompt?: boolean;
    afterTools?: boolean;
    afterContext?: boolean;
  };
}

class ContextService {
  buildContext(
    threadId: string,
    recentMessages: Message[],
    systemPrompt: string,
    tools: ToolDefinition[],
    options: ContextOptions = {}
  ): MessageParam[] {
    const messages: MessageParam[] = [];

    // Add system prompt (cacheable)
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: options.enableCaching && options.cacheBreakpoints?.afterSystemPrompt
              ? { type: 'ephemeral' }
              : undefined,
          },
        ],
      });
    }

    // Add tool definitions (cacheable - mark last tool)
    if (tools.length > 0 && options.enableCaching && options.cacheBreakpoints?.afterTools) {
      const lastToolIndex = tools.length - 1;
      tools = tools.map((tool, i) => ({
        ...tool,
        cache_control: i === lastToolIndex ? { type: 'ephemeral' } : undefined,
      }));
    }

    // Add conversation history
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content as ContentBlock[],
      });
    }

    return messages;
  }
}
```

### 4.3 Provider Implementation

**Anthropic:** Already supports `cache_control` (pass through to API).

**OpenAI/Gemini:** Ignore `cache_control` (no-op).

### 4.4 Database Schema Update

**File:** `backend/prisma/schema.prisma`

```prisma
model Message {
  // ... existing fields
  cacheHitTokens   Int?  // NEW - tokens served from cache
  cacheWriteTokens Int?  // NEW - tokens written to cache
}
```

**Migration:**

```bash
npx prisma migrate dev --name add_cache_metrics
```

### 4.5 API Endpoint Update

**File:** `backend/src/routes/threads.ts`

```typescript
router.post('/:threadId/messages', requireAuth, async (req, res) => {
  const { content, model, enable_caching = true } = req.body;

  const context = contextService.buildContext(
    threadId,
    recentMessages,
    systemPrompt,
    tools,
    {
      enableCaching: enable_caching,
      cacheBreakpoints: {
        afterSystemPrompt: true,
        afterTools: true,
      },
    }
  );

  const result = await runAgenticLoop(provider, context, tools, callbacks);

  // Save cache metrics
  await prisma.message.update({
    where: { id: assistantMessage.id },
    data: {
      cacheHitTokens: result.usage?.cache_read_input_tokens,
      cacheWriteTokens: result.usage?.cache_creation_input_tokens,
    },
  });
});
```

### 4.6 Usage Analytics Endpoint

**File:** `backend/src/routes/analytics.ts`

```typescript
router.get('/analytics/cost-savings', requireAuth, async (req, res) => {
  const { userId } = req.user!;
  const { startDate, endDate } = req.query;

  const messages = await prisma.message.findMany({
    where: {
      thread: { userId },
      createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
    },
    select: {
      inputTokens: true,
      outputTokens: true,
      cacheHitTokens: true,
      cacheWriteTokens: true,
    },
  });

  const totalInputTokens = messages.reduce((sum, m) => sum + (m.inputTokens || 0), 0);
  const totalCacheHits = messages.reduce((sum, m) => sum + (m.cacheHitTokens || 0), 0);
  const totalCacheWrites = messages.reduce((sum, m) => sum + (m.cacheWriteTokens || 0), 0);

  // Claude pricing (example)
  const inputCost = (totalInputTokens * 0.003) / 1000;  // $0.003 per 1K tokens
  const cacheHitCost = (totalCacheHits * 0.0003) / 1000;  // 90% discount
  const cacheWriteCost = (totalCacheWrites * 0.00375) / 1000;  // 25% markup

  const totalCost = inputCost + cacheHitCost + cacheWriteCost;
  const costWithoutCaching = ((totalInputTokens + totalCacheHits) * 0.003) / 1000;
  const savings = costWithoutCaching - totalCost;

  res.json({
    totalInputTokens,
    totalCacheHits,
    totalCacheWrites,
    totalCost,
    costWithoutCaching,
    savings,
    savingsPercent: (savings / costWithoutCaching) * 100,
  });
});
```

---

## Phase 5: Batch Processing

**Goal:** 50% cost reduction for async workloads.

**Impact:** Evals, content moderation, bulk data labeling.

### 5.1 Database Schema

**File:** `backend/prisma/schema.prisma`

```prisma
model Batch {
  id              String   @id @default(uuid())
  userId          String
  providerBatchId String?  // Anthropic batch ID
  status          String   // 'pending' | 'validating' | 'in_progress' | 'ended' | 'failed'
  requestCount    Int
  processedCount  Int      @default(0)
  succeededCount  Int      @default(0)
  erroredCount    Int      @default(0)
  inputFileUrl    String?  // S3 URL for JSONL input
  resultFileUrl   String?  // S3 URL for JSONL output
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId])
  @@index([status])
}
```

**Migration:**

```bash
npx prisma migrate dev --name add_batches
```

### 5.2 Batch Service

**File:** `backend/src/services/batchService.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { uploadFile } from './fileUploadService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function createBatch(
  userId: string,
  requests: Array<{ custom_id: string; params: any }>
): Promise<string> {
  // Generate JSONL file
  const jsonl = requests.map(r => JSON.stringify(r)).join('\n');
  const buffer = Buffer.from(jsonl, 'utf-8');

  // Upload to S3
  const inputFileUrl = await uploadFile(buffer, 'application/jsonl', 'batch-input.jsonl');

  // Submit to Anthropic
  const batch = await anthropic.messages.batches.create({ requests });

  // Save to DB
  const dbBatch = await prisma.batch.create({
    data: {
      userId,
      providerBatchId: batch.id,
      status: batch.processing_status,
      requestCount: requests.length,
      inputFileUrl,
    },
  });

  return dbBatch.id;
}

export async function pollBatchStatus(batchId: string): Promise<void> {
  const dbBatch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!dbBatch || !dbBatch.providerBatchId) return;

  const batch = await anthropic.messages.batches.retrieve(dbBatch.providerBatchId);

  await prisma.batch.update({
    where: { id: batchId },
    data: {
      status: batch.processing_status,
      processedCount: batch.request_counts.processing + batch.request_counts.succeeded + batch.request_counts.errored,
      succeededCount: batch.request_counts.succeeded,
      erroredCount: batch.request_counts.errored,
    },
  });

  if (batch.processing_status === 'ended') {
    await downloadBatchResults(batchId, dbBatch.providerBatchId);
  }
}

async function downloadBatchResults(batchId: string, providerBatchId: string): Promise<void> {
  const results = await anthropic.messages.batches.results(providerBatchId);

  // Convert stream to JSONL
  const chunks: string[] = [];
  for await (const result of results) {
    chunks.push(JSON.stringify(result));
  }
  const jsonl = chunks.join('\n');

  // Upload to S3
  const resultFileUrl = await uploadFile(
    Buffer.from(jsonl, 'utf-8'),
    'application/jsonl',
    `batch-${batchId}-results.jsonl`
  );

  await prisma.batch.update({
    where: { id: batchId },
    data: { resultFileUrl },
  });
}
```

### 5.3 Background Job Queue

**File:** `backend/src/jobs/batchPoller.ts`

```typescript
import { Queue, Worker } from 'bullmq';
import { pollBatchStatus } from '../services/batchService';

const batchQueue = new Queue('batch-polling', {
  connection: { host: 'localhost', port: 6379 },
});

export async function scheduleBatchPolling(batchId: string): Promise<void> {
  await batchQueue.add(
    'poll',
    { batchId },
    {
      repeat: { every: 60000 },  // Poll every 1 min
      removeOnComplete: true,
    }
  );
}

// Worker
new Worker(
  'batch-polling',
  async (job) => {
    const { batchId } = job.data;
    await pollBatchStatus(batchId);

    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (batch?.status === 'ended' || batch?.status === 'failed') {
      await batchQueue.removeRepeatableByKey(job.repeatJobKey!);
    }
  },
  { connection: { host: 'localhost', port: 6379 } }
);
```

### 5.4 API Endpoints

**File:** `backend/src/routes/batches.ts`

```typescript
import express from 'express';
import { requireAuth } from '../middleware/auth';
import { createBatch, pollBatchStatus } from '../services/batchService';
import { scheduleBatchPolling } from '../jobs/batchPoller';

const router = express.Router();

// Create batch
router.post('/', requireAuth, async (req, res) => {
  const { requests } = req.body;  // Array of { custom_id, params }

  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 10000) {
    return res.status(400).json({ error: 'requests must be an array of 1-10000 items' });
  }

  const batchId = await createBatch(req.user!.id, requests);
  await scheduleBatchPolling(batchId);

  res.json({ batchId });
});

// Get batch status
router.get('/:batchId', requireAuth, async (req, res) => {
  const batch = await prisma.batch.findUnique({
    where: { id: req.params.batchId, userId: req.user!.id },
  });

  if (!batch) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  res.json(batch);
});

// Download results
router.get('/:batchId/results', requireAuth, async (req, res) => {
  const batch = await prisma.batch.findUnique({
    where: { id: req.params.batchId, userId: req.user!.id },
  });

  if (!batch || batch.status !== 'ended') {
    return res.status(400).json({ error: 'Batch not complete or not found' });
  }

  if (!batch.resultFileUrl) {
    return res.status(404).json({ error: 'Results not yet available' });
  }

  // Redirect to S3 presigned URL
  const presignedUrl = await getPresignedUrl(batch.resultFileUrl);
  res.redirect(presignedUrl);
});

export default router;
```

---

## Phase 6: Output Configuration

**Goal:** Force structured JSON outputs with schema validation.

**Impact:** Data extraction, form filling, API integrations.

### 6.1 Type System Update

**File:** `backend/src/types/messages.ts`

```typescript
export interface OutputConfig {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: Record<string, unknown>;  // JSON Schema
  };
}

export interface ChatCompletionOptions {
  messages: MessageParam[];
  tools?: ToolDefinition[];
  model?: string;
  thinking?: ThinkingConfig;
  tool_choice?: ToolChoice;
  output?: OutputConfig;  // NEW
}

export interface ChatCompletionResult {
  text: string;
  contentBlocks: ContentBlock[];
  toolCalls: ToolCall[];
  stopReason: StopReason;
  parsed?: Record<string, unknown>;  // NEW - parsed JSON output
  usage?: TokenUsage;
}
```

### 6.2 Provider Implementation

**Anthropic:**

```typescript
async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const response = await this.client.messages.create({
    model: options.model || this.model,
    messages: this.convertMessages(options.messages),
    ...(options.output && { output: options.output }),
  });

  let parsed: Record<string, unknown> | undefined;
  if (options.output && response.content[0]?.type === 'text') {
    parsed = JSON.parse(response.content[0].text);
  }

  return {
    text: response.content[0]?.type === 'text' ? response.content[0].text : '',
    contentBlocks: this.convertContent(response.content),
    toolCalls: [],
    stopReason: 'end_turn',
    parsed,
  };
}
```

**OpenAI (Structured Outputs):**

```typescript
async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const response = await this.client.chat.completions.create({
    model: options.model || this.model,
    messages: this.convertMessages(options.messages),
    ...(options.output && {
      response_format: {
        type: 'json_schema',
        json_schema: options.output.json_schema,
      },
    }),
  });

  let parsed: Record<string, unknown> | undefined;
  if (options.output && response.choices[0].message.content) {
    parsed = JSON.parse(response.choices[0].message.content);
  }

  return {
    text: response.choices[0].message.content || '',
    contentBlocks: [{ type: 'text', text: response.choices[0].message.content || '' }],
    toolCalls: [],
    stopReason: 'end_turn',
    parsed,
  };
}
```

### 6.3 API Endpoint

**File:** `backend/src/routes/threads.ts`

```typescript
router.post('/:threadId/messages', requireAuth, async (req, res) => {
  const { content, model, output_schema } = req.body;

  let outputConfig: OutputConfig | undefined;
  if (output_schema) {
    outputConfig = {
      type: 'json_schema',
      json_schema: {
        name: output_schema.name || 'response',
        schema: output_schema.schema,
      },
    };
  }

  const result = await provider.chatCompletion({
    messages,
    output: outputConfig,
  });

  res.json({
    text: result.text,
    parsed: result.parsed,
  });
});
```

### 6.4 Example Usage

```bash
POST /api/v1/threads/:id/messages
{
  "content": "Extract user profile from this text: John Doe, 30 years old, john@example.com",
  "model": "anthropic",
  "output_schema": {
    "name": "user_profile",
    "schema": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "age": { "type": "integer" },
        "email": { "type": "string" }
      },
      "required": ["name", "age", "email"]
    }
  }
}
```

**Response:**

```json
{
  "text": "{\"name\": \"John Doe\", \"age\": 30, \"email\": \"john@example.com\"}",
  "parsed": {
    "name": "John Doe",
    "age": 30,
    "email": "john@example.com"
  }
}
```

---

## Testing Strategy

### Unit Tests

**File:** `backend/tests/providers/anthropic.test.ts`

```typescript
describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!);
  });

  it('should support extended thinking', async () => {
    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'Solve: 123 * 456' }],
      thinking: { type: 'enabled', budget_tokens: 5000 },
    });

    expect(result.contentBlocks.some(b => b.type === 'thinking')).toBe(true);
    expect(result.usage?.thinking_tokens).toBeGreaterThan(0);
  });

  it('should stream responses', async () => {
    const chunks: string[] = [];

    await provider.chatCompletionStream(
      { messages: [{ role: 'user', content: 'Count to 5' }] },
      {
        onTextDelta: (delta) => chunks.push(delta),
        onMessageStop: jest.fn(),
        onError: jest.fn(),
      }
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toContain('1');
  });

  it('should handle vision inputs', async () => {
    const result = await provider.chatCompletion({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          {
            type: 'image',
            source: {
              type: 'url',
              media_type: 'image/png',
              url: 'https://example.com/test.png',
            },
          },
        ],
      }],
    });

    expect(result.text).toBeTruthy();
  });
});
```

### Integration Tests

**File:** `backend/tests/integration/streaming.test.ts`

```typescript
describe('Streaming with tools', () => {
  it('should stream tool execution', async () => {
    const events: any[] = [];

    const res = await request(app)
      .post('/api/v1/threads/test-thread/messages')
      .send({
        content: 'Calculate 2 + 2 and search for "TypeScript"',
        model: 'anthropic',
        stream: true,
      });

    // Parse SSE stream
    const lines = res.text.split('\n\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        events.push(JSON.parse(line.slice(6)));
      }
    }

    expect(events.some(e => e.type === 'tool_use_start')).toBe(true);
    expect(events.some(e => e.type === 'tool_execution_result')).toBe(true);
    expect(events.some(e => e.type === 'done')).toBe(true);
  });
});
```

### E2E Tests

**File:** `backend/tests/e2e/vision.test.ts`

```typescript
describe('Vision E2E', () => {
  it('should analyze uploaded image', async () => {
    const res = await request(app)
      .post('/api/v1/threads/test-thread/messages')
      .attach('attachments', './tests/fixtures/diagram.png')
      .field('content', 'Describe this diagram')
      .field('model', 'anthropic');

    expect(res.status).toBe(200);
    expect(res.body.text).toContain('diagram');
  });
});
```

---

## Migration Path

### Phase 1 Migration (Extended Thinking, Strict Tools, Tool Choice)

1. **Add Anthropic provider:**
   ```bash
   npm install @anthropic-ai/sdk
   ```

2. **Run migrations:**
   ```bash
   npx prisma migrate dev --name add_thinking_tokens
   ```

3. **Update environment:**
   ```bash
   echo "ANTHROPIC_API_KEY=sk-ant-..." >> backend/.env
   ```

4. **Deploy backend:**
   ```bash
   npm run build
   pm2 restart backend
   ```

5. **Test with Postman:**
   - Update `docs/postman/chat-thread-api.postman_collection.json`
   - Add requests with `thinking`, `strict`, `tool_choice` params

### Phase 2 Migration (Streaming)

1. **Update frontend to use streaming client:**
   - Replace `api.sendMessage()` with `api.sendMessageStream()`

2. **Deploy both frontend and backend:**
   ```bash
   # Backend
   npm run build && pm2 restart backend

   # Frontend
   cd app && npm run build && pm2 restart frontend
   ```

3. **Monitor logs:**
   ```bash
   pm2 logs backend | grep "stream"
   ```

### Phase 3 Migration (Vision & PDFs)

1. **Setup S3:**
   ```bash
   aws s3 mb s3://ai-sandbox-attachments
   ```

2. **Update environment:**
   ```bash
   echo "AWS_REGION=us-east-1" >> backend/.env
   echo "S3_BUCKET=ai-sandbox-attachments" >> backend/.env
   ```

3. **Run migrations:**
   ```bash
   npx prisma migrate dev --name add_attachments
   ```

4. **Install dependencies:**
   ```bash
   npm install @aws-sdk/client-s3 multer @types/multer
   ```

5. **Deploy:**
   ```bash
   npm run build && pm2 restart backend
   ```

### Phase 4 Migration (Prompt Caching)

1. **Enable caching in production:**
   ```bash
   echo "ENABLE_PROMPT_CACHING=true" >> backend/.env
   ```

2. **Run migrations:**
   ```bash
   npx prisma migrate dev --name add_cache_metrics
   ```

3. **Deploy:**
   ```bash
   npm run build && pm2 restart backend
   ```

4. **Monitor savings:**
   - Check `/api/v1/analytics/cost-savings` endpoint

### Phase 5 Migration (Batch API)

1. **Setup Redis:**
   ```bash
   docker run -d -p 6379:6379 redis:7-alpine
   ```

2. **Install dependencies:**
   ```bash
   npm install bullmq
   ```

3. **Run migrations:**
   ```bash
   npx prisma migrate dev --name add_batches
   ```

4. **Start workers:**
   ```bash
   pm2 start backend/src/jobs/batchPoller.ts --name batch-worker
   ```

---

## Appendix

### A. Environment Variables

```bash
# backend/.env

# Database
DATABASE_URL=postgresql://ai_sandbox:ai_sandbox_dev@localhost:5433/ai_sandbox?schema=public

# AI Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
DEEP_SEEK_API_KEY=...

# AWS (for vision/batch features)
AWS_REGION=us-east-1
S3_BUCKET=ai-sandbox-attachments
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Features
ENABLE_PROMPT_CACHING=true
SEARXNG_URL=http://localhost:8888

# Redis (for batch jobs)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### B. Cost Estimation

**Claude 4.6 Opus Pricing (2026):**

| Type | Price per 1M tokens |
|------|---------------------|
| Input | $3.00 |
| Output | $15.00 |
| Thinking | $15.00 |
| Cache Write | $3.75 (25% markup) |
| Cache Hit | $0.30 (90% discount) |

**Example: 100 requests with 50K context**

**Without caching:**
- Input: 100 × 50K = 5M tokens × $3 = $15

**With caching:**
- First request: 50K write tokens × $3.75/1M = $0.19
- Next 99 requests: 99 × 50K cache hits × $0.30/1M = $1.49
- **Total: $1.68 (89% savings)**

### C. References

- [Anthropic Messages API](https://platform.anthropic.com/docs/api-reference/messages)
- [TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [Streaming Guide](https://docs.anthropic.com/en/api/messages-streaming)
- [Prompt Caching](https://platform.anthropic.com/docs/prompt-caching)
- [Extended Thinking](https://platform.anthropic.com/docs/extended-thinking)
- [Tool Use](https://platform.anthropic.com/docs/tool-use)
- [Batch API](https://platform.anthropic.com/docs/batch-api)

---

**Next Steps:**
1. Review gap analysis, architecture overview, and this technical design
2. Prioritize phases based on business needs
3. Begin Phase 1 implementation (extended thinking, strict tools, tool choice)
4. Iterate with user feedback between phases
