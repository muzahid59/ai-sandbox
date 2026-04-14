# Claude API Integration - TDD Specification

**Date:** 2026-04-13  
**Version:** 1.0  
**Target:** ai-sandbox backend (Express + TypeScript + Prisma)  
**Methodology:** Test-Driven Development (Red-Green-Refactor)

---

## Table of Contents

1. [TDD Principles](#tdd-principles)
2. [Test Strategy](#test-strategy)
3. [Phase 1: Extended Thinking, Strict Tools, Tool Choice](#phase-1-extended-thinking-strict-tools-tool-choice)
4. [Phase 2: Streaming Architecture](#phase-2-streaming-architecture)
5. [Phase 3: Vision & Multi-Modal](#phase-3-vision--multi-modal)
6. [Phase 4: Prompt Caching](#phase-4-prompt-caching)
7. [Phase 5: Batch Processing](#phase-5-batch-processing)
8. [Phase 6: Output Configuration](#phase-6-output-configuration)
9. [Test Infrastructure](#test-infrastructure)
10. [CI/CD Integration](#cicd-integration)

---

## TDD Principles

### The Red-Green-Refactor Cycle

```
1. RED:    Write a failing test that defines desired behavior
2. GREEN:  Write minimal code to make the test pass
3. REFACTOR: Improve code while keeping tests green
```

### Rules for This Project

1. **No production code without a failing test first**
2. **Write only enough test to fail** (compilation failures count)
3. **Write only enough production code to pass the test**
4. **One test at a time** - don't skip ahead
5. **Tests must be deterministic** - no flaky tests
6. **Integration tests use real database** (test DB, not mocks)
7. **External API calls use fixtures/VCR** - no live calls in CI

### Test Pyramid

```
         /\
        /E2E\        10% - End-to-end (Supertest + real DB)
       /------\
      /Integration\ 30% - Integration tests (API routes + services)
     /------------\
    /   Unit       \ 60% - Unit tests (pure functions, business logic)
   /----------------\
```

---

## Test Strategy

### Test Levels

| Level | Scope | Tools | Speed | Coverage |
|-------|-------|-------|-------|----------|
| **Unit** | Pure functions, single modules | Jest | <100ms | 60% of tests |
| **Integration** | Services + DB, API routes | Jest + Supertest + TestContainers | <2s | 30% of tests |
| **E2E** | Full request lifecycle | Supertest + real DB | <5s | 10% of tests |

### What to Test

✅ **DO test:**
- Public API contracts (request/response schemas)
- Business logic (tool execution, context building)
- Error handling (invalid inputs, provider failures)
- Database operations (CRUD, transactions)
- Type conversions (Anthropic ↔ OpenAI formats)

❌ **DON'T test:**
- Third-party library internals (Anthropic SDK, Prisma)
- Trivial getters/setters
- TypeScript type system (compiler does this)

### Test Naming Convention

```typescript
describe('FeatureName', () => {
  describe('methodName', () => {
    it('should behave correctly when condition is met', () => {
      // Given (Arrange)
      // When (Act)
      // Then (Assert)
    });

    it('should throw error when invalid input provided', () => {
      // ...
    });
  });
});
```

---

## Phase 1: Extended Thinking, Strict Tools, Tool Choice

### 1.1 Extended Thinking - Unit Tests

#### Test File: `backend/tests/unit/types/content.test.ts`

**Test 1: ThinkingBlock type definition**

```typescript
import { ThinkingBlock, ContentBlock } from '../../../src/types/content';

describe('ThinkingBlock', () => {
  it('should have type discriminator "thinking"', () => {
    const block: ThinkingBlock = {
      type: 'thinking',
      thinking: 'Let me reason through this...',
    };

    expect(block.type).toBe('thinking');
    expect(block.thinking).toBe('Let me reason through this...');
  });

  it('should be assignable to ContentBlock union', () => {
    const block: ContentBlock = {
      type: 'thinking',
      thinking: 'Reasoning...',
    };

    expect(block.type).toBe('thinking');
  });
});
```

**Implementation:**

```typescript
// backend/src/types/content.ts
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock;  // Add to union
```

---

#### Test File: `backend/tests/unit/types/messages.test.ts`

**Test 2: ThinkingConfig type**

```typescript
import { ThinkingConfig, ChatCompletionOptions } from '../../../src/types/messages';

describe('ThinkingConfig', () => {
  it('should require type field with value "enabled"', () => {
    const config: ThinkingConfig = {
      type: 'enabled',
    };

    expect(config.type).toBe('enabled');
  });

  it('should allow optional budget_tokens field', () => {
    const config: ThinkingConfig = {
      type: 'enabled',
      budget_tokens: 5000,
    };

    expect(config.budget_tokens).toBe(5000);
  });

  it('should be usable in ChatCompletionOptions', () => {
    const options: ChatCompletionOptions = {
      messages: [],
      thinking: {
        type: 'enabled',
        budget_tokens: 10000,
      },
    };

    expect(options.thinking?.budget_tokens).toBe(10000);
  });
});
```

**Implementation:**

```typescript
// backend/src/types/messages.ts
export interface ThinkingConfig {
  type: 'enabled';
  budget_tokens?: number;
}

export interface ChatCompletionOptions {
  messages: MessageParam[];
  tools?: ToolDefinition[];
  model?: string;
  thinking?: ThinkingConfig;
}
```

---

#### Test File: `backend/tests/unit/providers/anthropic.test.ts`

**Test 3: Anthropic provider capabilities**

```typescript
import { AnthropicProvider } from '../../../src/providers/anthropic';

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider('test-api-key');
  });

  describe('capabilities', () => {
    it('should support extended thinking', () => {
      expect(provider.capabilities.extendedThinking).toBe(true);
    });

    it('should support streaming', () => {
      expect(provider.capabilities.streaming).toBe(true);
    });

    it('should support image analysis', () => {
      expect(provider.capabilities.imageAnalysis).toBe(true);
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/providers/anthropic.ts
export class AnthropicProvider implements AIProvider {
  readonly capabilities: ProviderCapabilities = {
    chatCompletion: true,
    streaming: true,
    imageAnalysis: true,
    extendedThinking: true,
  };

  constructor(apiKey: string, private readonly model = 'claude-4.6-opus') {
    this.name = `anthropic/${model}`;
    this.client = new Anthropic({ apiKey });
  }
}
```

---

#### Test File: `backend/tests/integration/providers/anthropic.integration.test.ts`

**Test 4: Anthropic provider with extended thinking (integration)**

```typescript
import { AnthropicProvider } from '../../../src/providers/anthropic';
import nock from 'nock';

describe('AnthropicProvider Integration', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY || 'test-key');
  });

  describe('chatCompletion with extended thinking', () => {
    it('should include thinking parameter in API request', async () => {
      const mockResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Let me solve this step by step...',
          },
          {
            type: 'text',
            text: 'The answer is 56088',
          },
        ],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 20,
          output_tokens: 50,
          thinking_tokens: 150,
        },
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages', (body) => {
          expect(body.thinking).toEqual({
            type: 'enabled',
            budget_tokens: 5000,
          });
          return true;
        })
        .reply(200, mockResponse);

      const result = await provider.chatCompletion({
        messages: [{ role: 'user', content: 'Calculate 123 * 456' }],
        thinking: {
          type: 'enabled',
          budget_tokens: 5000,
        },
      });

      expect(result.contentBlocks).toHaveLength(2);
      expect(result.contentBlocks[0].type).toBe('thinking');
      expect(result.contentBlocks[1].type).toBe('text');
      expect(result.usage?.thinking_tokens).toBe(150);
    });

    it('should work without thinking parameter', async () => {
      const mockResponse = {
        id: 'msg_124',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, mockResponse);

      const result = await provider.chatCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.contentBlocks).toHaveLength(1);
      expect(result.contentBlocks[0].type).toBe('text');
      expect(result.usage?.thinking_tokens).toBeUndefined();
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/providers/anthropic.ts
async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const { messages, tools, thinking } = options;
  
  const response = await this.client.messages.create({
    model: options.model || this.model,
    max_tokens: 4096,
    messages: this.convertMessages(messages),
    ...(tools && { tools: this.convertTools(tools) }),
    ...(thinking && { thinking }),  // Pass through
  });

  // Parse response including thinking blocks
  const contentBlocks: ContentBlock[] = response.content.map((block) => {
    if (block.type === 'thinking') {
      return { type: 'thinking', thinking: block.thinking };
    }
    // ... other types
  });

  return {
    text: this.extractText(response.content),
    contentBlocks,
    toolCalls: this.extractToolCalls(response.content),
    stopReason: this.mapStopReason(response.stop_reason),
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      thinking_tokens: (response.usage as any).thinking_tokens,
    },
  };
}
```

---

### 1.2 Strict Tool Use - Unit Tests

#### Test File: `backend/tests/unit/types/messages.test.ts`

**Test 5: ToolDefinition with strict flag**

```typescript
describe('ToolDefinition', () => {
  it('should allow optional strict field', () => {
    const tool: ToolDefinition = {
      name: 'calculator',
      description: 'Math calculator',
      input_schema: {
        type: 'object',
        properties: {
          expression: { type: 'string' },
        },
        required: ['expression'],
      },
      strict: true,
    };

    expect(tool.strict).toBe(true);
  });

  it('should default to undefined strict when omitted', () => {
    const tool: ToolDefinition = {
      name: 'calculator',
      description: 'Math calculator',
      input_schema: {
        type: 'object',
        properties: {},
      },
    };

    expect(tool.strict).toBeUndefined();
  });
});
```

**Implementation:**

```typescript
// backend/src/types/messages.ts
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  strict?: boolean;
}
```

---

#### Test File: `backend/tests/unit/tools/calculator.test.ts`

**Test 6: Calculator tool with strict mode**

```typescript
import { definition as calculatorDefinition } from '../../../src/tools/calculator';

describe('Calculator Tool', () => {
  it('should have strict mode enabled', () => {
    expect(calculatorDefinition.strict).toBe(true);
  });

  it('should require expression in schema', () => {
    expect(calculatorDefinition.input_schema.required).toContain('expression');
  });
});
```

**Implementation:**

```typescript
// backend/src/tools/calculator.ts
export const definition: ToolDefinition = {
  name: 'calculator',
  description: 'Evaluate mathematical expressions',
  input_schema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Math expression to evaluate',
      },
    },
    required: ['expression'],
  },
  strict: true,
};
```

---

#### Test File: `backend/tests/integration/services/toolExecutor.test.ts`

**Test 7: Tool input validation with strict mode**

```typescript
import { validateToolInput } from '../../../src/services/toolExecutor';
import { ToolDefinition, ToolCall } from '../../../src/types';

describe('Tool Input Validation', () => {
  const strictTool: ToolDefinition = {
    name: 'test_tool',
    description: 'Test',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name', 'age'],
    },
    strict: true,
  };

  it('should skip validation when strict mode and provider supports strict', async () => {
    const toolCall: ToolCall = {
      id: 'call_1',
      name: 'test_tool',
      arguments: { name: 'John', age: 30 },
    };

    const providerSupportsStrict = true;

    await expect(
      validateToolInput(toolCall, strictTool, providerSupportsStrict)
    ).resolves.not.toThrow();
  });

  it('should validate input when provider does not support strict', async () => {
    const toolCall: ToolCall = {
      id: 'call_2',
      name: 'test_tool',
      arguments: { name: 'John' },  // Missing 'age'
    };

    const providerSupportsStrict = false;

    await expect(
      validateToolInput(toolCall, strictTool, providerSupportsStrict)
    ).rejects.toThrow(/must have required property 'age'/);
  });

  it('should validate input when strict mode disabled', async () => {
    const nonStrictTool = { ...strictTool, strict: false };
    const toolCall: ToolCall = {
      id: 'call_3',
      name: 'test_tool',
      arguments: { name: 'John' },  // Missing 'age'
    };

    await expect(
      validateToolInput(toolCall, nonStrictTool, false)
    ).rejects.toThrow(/must have required property 'age'/);
  });
});
```

**Implementation:**

```typescript
// backend/src/services/toolExecutor.ts
import Ajv from 'ajv';

const ajv = new Ajv();

export async function validateToolInput(
  toolCall: ToolCall,
  definition: ToolDefinition,
  providerSupportsStrict: boolean
): Promise<void> {
  // Skip validation if provider supports strict mode and strict enabled
  if (definition.strict && providerSupportsStrict) {
    return;
  }

  // Fallback validation for non-strict providers
  const validate = ajv.compile(definition.input_schema);
  const valid = validate(toolCall.arguments);

  if (!valid) {
    const errors = ajv.errorsText(validate.errors);
    throw new Error(`Tool input validation failed: ${errors}`);
  }
}
```

---

### 1.3 Tool Choice Control - Unit Tests

#### Test File: `backend/tests/unit/types/messages.test.ts`

**Test 8: ToolChoice type definition**

```typescript
import { ToolChoice } from '../../../src/types/messages';

describe('ToolChoice', () => {
  it('should accept "auto" string literal', () => {
    const choice: ToolChoice = 'auto';
    expect(choice).toBe('auto');
  });

  it('should accept "any" string literal', () => {
    const choice: ToolChoice = 'any';
    expect(choice).toBe('any');
  });

  it('should accept "none" string literal', () => {
    const choice: ToolChoice = 'none';
    expect(choice).toBe('none');
  });

  it('should accept specific tool object', () => {
    const choice: ToolChoice = {
      type: 'tool',
      name: 'web_search',
    };
    expect(choice.type).toBe('tool');
    expect(choice.name).toBe('web_search');
  });
});
```

**Implementation:**

```typescript
// backend/src/types/messages.ts
export type ToolChoice = 
  | 'auto'
  | 'any'
  | 'none'
  | { type: 'tool'; name: string };

export interface ChatCompletionOptions {
  messages: MessageParam[];
  tools?: ToolDefinition[];
  model?: string;
  thinking?: ThinkingConfig;
  tool_choice?: ToolChoice;
}
```

---

#### Test File: `backend/tests/integration/providers/anthropic.integration.test.ts`

**Test 9: Anthropic provider with tool_choice parameter**

```typescript
describe('chatCompletion with tool_choice', () => {
  it('should pass through tool_choice to API', async () => {
    const mockResponse = {
      id: 'msg_125',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'web_search',
          input: { query: 'TypeScript' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    nock('https://api.anthropic.com')
      .post('/v1/messages', (body) => {
        expect(body.tool_choice).toEqual({ type: 'tool', name: 'web_search' });
        return true;
      })
      .reply(200, mockResponse);

    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'Search for TypeScript' }],
      tools: [webSearchTool],
      tool_choice: { type: 'tool', name: 'web_search' },
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('web_search');
  });

  it('should handle "any" tool_choice', async () => {
    const mockResponse = {
      id: 'msg_126',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_2',
          name: 'calculator',
          input: { expression: '2+2' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 50, output_tokens: 30 },
    };

    nock('https://api.anthropic.com')
      .post('/v1/messages', (body) => {
        expect(body.tool_choice).toBe('any');
        return true;
      })
      .reply(200, mockResponse);

    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'Calculate something' }],
      tools: [calculatorTool],
      tool_choice: 'any',
    });

    expect(result.stopReason).toBe('tool_use');
  });
});
```

**Implementation:**

```typescript
// backend/src/providers/anthropic.ts
async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const response = await this.client.messages.create({
    model: options.model || this.model,
    max_tokens: 4096,
    messages: this.convertMessages(options.messages),
    ...(options.tools && { tools: this.convertTools(options.tools) }),
    ...(options.thinking && { thinking: options.thinking }),
    ...(options.tool_choice && { tool_choice: options.tool_choice }),
  });

  // ... response handling
}
```

---

### 1.4 Database Schema - Migration Tests

#### Test File: `backend/tests/integration/database/schema.test.ts`

**Test 10: Message schema includes thinking tokens**

```typescript
import { PrismaClient } from '@prisma/client';

describe('Database Schema', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Message model', () => {
    it('should have thinkingTokens field', async () => {
      const message = await prisma.message.create({
        data: {
          thread: {
            create: {
              userId: 'test-user',
              model: 'anthropic',
              status: 'active',
            },
          },
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me think...' },
            { type: 'text', text: 'Answer' },
          ],
          inputTokens: 100,
          outputTokens: 50,
          thinkingTokens: 200,
        },
      });

      expect(message.thinkingTokens).toBe(200);

      // Cleanup
      await prisma.message.delete({ where: { id: message.id } });
      await prisma.thread.delete({ where: { id: message.threadId } });
    });

    it('should allow null thinkingTokens', async () => {
      const message = await prisma.message.create({
        data: {
          thread: {
            create: {
              userId: 'test-user-2',
              model: 'openai',
              status: 'active',
            },
          },
          role: 'assistant',
          content: [{ type: 'text', text: 'Answer' }],
          inputTokens: 100,
          outputTokens: 50,
        },
      });

      expect(message.thinkingTokens).toBeNull();

      // Cleanup
      await prisma.message.delete({ where: { id: message.id } });
      await prisma.thread.delete({ where: { id: message.threadId } });
    });
  });
});
```

**Implementation:**

```prisma
// backend/prisma/schema.prisma
model Message {
  id              String   @id @default(uuid())
  threadId        String
  role            String
  content         Json
  toolCalls       Json?
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

```bash
# Run migration
npx prisma migrate dev --name add_thinking_tokens
```

---

### 1.5 API Endpoint - E2E Tests

#### Test File: `backend/tests/e2e/threads.e2e.test.ts`

**Test 11: POST /api/v1/threads/:id/messages with thinking parameter**

```typescript
import request from 'supertest';
import app from '../../src/app';
import { PrismaClient } from '@prisma/client';

describe('POST /api/v1/threads/:id/messages', () => {
  let prisma: PrismaClient;
  let threadId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const thread = await prisma.thread.create({
      data: {
        userId: 'test-user',
        model: 'anthropic',
        status: 'active',
      },
    });
    threadId = thread.id;
  });

  afterAll(async () => {
    await prisma.thread.delete({ where: { id: threadId } });
    await prisma.$disconnect();
  });

  it('should accept thinking parameter and save thinking tokens', async () => {
    const response = await request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .send({
        content: 'Solve this complex problem: 123 * 456',
        model: 'anthropic',
        thinking: {
          type: 'enabled',
          budget_tokens: 5000,
        },
      })
      .expect(200);

    expect(response.body).toHaveProperty('message_id');
    expect(response.body).toHaveProperty('thinking_tokens');
    expect(response.body.thinking_tokens).toBeGreaterThan(0);

    // Verify database
    const message = await prisma.message.findUnique({
      where: { id: response.body.message_id },
    });

    expect(message?.thinkingTokens).toBeGreaterThan(0);
  });

  it('should reject invalid thinking budget', async () => {
    const response = await request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .send({
        content: 'Hello',
        thinking: {
          type: 'enabled',
          budget_tokens: 500,  // Below minimum (1024)
        },
      })
      .expect(400);

    expect(response.body.error).toContain('Minimum thinking budget is 1024 tokens');
  });

  it('should work without thinking parameter', async () => {
    const response = await request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .send({
        content: 'Simple question',
      })
      .expect(200);

    expect(response.body).toHaveProperty('message_id');
    expect(response.body.thinking_tokens).toBeUndefined();
  });
});
```

**Implementation:**

```typescript
// backend/src/routes/threads.ts
router.post('/:threadId/messages', requireAuth, async (req, res) => {
  const { content, model, thinking, tool_choice } = req.body;

  // Validate thinking config
  if (thinking) {
    if (thinking.type !== 'enabled') {
      return res.status(400).json({ error: 'Invalid thinking type' });
    }
    if (thinking.budget_tokens && thinking.budget_tokens < 1024) {
      return res.status(400).json({
        error: 'Minimum thinking budget is 1024 tokens',
      });
    }
  }

  // Create provider
  const provider = AIFactory.createService(model || 'openai');

  // Build context and call provider
  const result = await runAgenticLoop(provider, messages, tools, callbacks, 10, {
    thinking,
    tool_choice,
  });

  // Save assistant message with thinking tokens
  const assistantMessage = await prisma.message.create({
    data: {
      threadId,
      role: 'assistant',
      content: result.contentBlocks,
      toolCalls: result.toolCalls,
      stopReason: result.stopReason,
      inputTokens: result.usage?.input_tokens,
      outputTokens: result.usage?.output_tokens,
      thinkingTokens: result.usage?.thinking_tokens,
    },
  });

  res.json({
    message_id: assistantMessage.id,
    text: result.text,
    thinking_tokens: result.usage?.thinking_tokens,
  });
});
```

---

## Phase 2: Streaming Architecture

### 2.1 Provider Streaming Interface - Unit Tests

#### Test File: `backend/tests/unit/providers/types.test.ts`

**Test 12: StreamCallbacks interface**

```typescript
import { StreamCallbacks } from '../../../src/providers/types';

describe('StreamCallbacks', () => {
  it('should define all required callback methods', () => {
    const callbacks: StreamCallbacks = {
      onContentBlockStart: jest.fn(),
      onTextDelta: jest.fn(),
      onToolUseDelta: jest.fn(),
      onContentBlockStop: jest.fn(),
      onMessageStop: jest.fn(),
      onError: jest.fn(),
    };

    expect(callbacks.onContentBlockStart).toBeDefined();
    expect(callbacks.onTextDelta).toBeDefined();
    expect(callbacks.onToolUseDelta).toBeDefined();
  });
});
```

**Implementation:**

```typescript
// backend/src/providers/types.ts
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
  chatCompletionStream?(options: ChatCompletionOptions, callbacks: StreamCallbacks): Promise<void>;
}
```

---

#### Test File: `backend/tests/unit/providers/anthropic.test.ts`

**Test 13: Anthropic provider has chatCompletionStream method**

```typescript
describe('AnthropicProvider', () => {
  it('should have chatCompletionStream method', () => {
    const provider = new AnthropicProvider('test-key');
    expect(provider.chatCompletionStream).toBeDefined();
    expect(typeof provider.chatCompletionStream).toBe('function');
  });
});
```

---

#### Test File: `backend/tests/integration/providers/anthropic-streaming.integration.test.ts`

**Test 14: Anthropic streaming with text deltas**

```typescript
import { AnthropicProvider } from '../../../src/providers/anthropic';
import nock from 'nock';

describe('AnthropicProvider Streaming', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider('test-key');
  });

  describe('chatCompletionStream', () => {
    it('should emit text deltas', async () => {
      const textDeltas: string[] = [];
      const textSnapshots: string[] = [];

      // Mock SSE stream from Anthropic
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, () => {
          return [
            'event: message_start\n',
            'data: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
            'event: content_block_start\n',
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
            'event: content_block_delta\n',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
            'event: content_block_delta\n',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
            'event: content_block_stop\n',
            'data: {"type":"content_block_stop","index":0}\n\n',
            'event: message_stop\n',
            'data: {"type":"message_stop"}\n\n',
          ].join('');
        }, {
          'Content-Type': 'text/event-stream',
        });

      await provider.chatCompletionStream(
        {
          messages: [{ role: 'user', content: 'Say hello' }],
        },
        {
          onContentBlockStart: jest.fn(),
          onTextDelta: (delta, snapshot) => {
            textDeltas.push(delta);
            textSnapshots.push(snapshot);
          },
          onToolUseDelta: jest.fn(),
          onContentBlockStop: jest.fn(),
          onMessageStop: jest.fn(),
          onError: jest.fn(),
        }
      );

      expect(textDeltas).toEqual(['Hello', ' world']);
      expect(textSnapshots).toEqual(['Hello', 'Hello world']);
    });

    it('should emit tool use deltas', async () => {
      const toolDeltas: Array<{ id: string; name: string; delta: string }> = [];

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, () => {
          return [
            'event: content_block_start\n',
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"calculator"}}\n\n',
            'event: content_block_delta\n',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"exp"}}\n\n',
            'event: content_block_delta\n',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ression\\":\\"2+2\\"}"}}\n\n',
            'event: content_block_stop\n',
            'data: {"type":"content_block_stop","index":0}\n\n',
            'event: message_stop\n',
            'data: {"type":"message_stop"}\n\n',
          ].join('');
        }, {
          'Content-Type': 'text/event-stream',
        });

      await provider.chatCompletionStream(
        {
          messages: [{ role: 'user', content: 'Calculate 2+2' }],
          tools: [calculatorTool],
        },
        {
          onContentBlockStart: jest.fn(),
          onTextDelta: jest.fn(),
          onToolUseDelta: (toolUseId, name, inputJsonDelta) => {
            toolDeltas.push({ id: toolUseId, name, delta: inputJsonDelta });
          },
          onContentBlockStop: jest.fn(),
          onMessageStop: jest.fn(),
          onError: jest.fn(),
        }
      );

      expect(toolDeltas).toHaveLength(2);
      expect(toolDeltas[0]).toEqual({ id: 'toolu_1', name: 'calculator', delta: '{"exp' });
      expect(toolDeltas[1]).toEqual({ id: 'toolu_1', name: 'calculator', delta: 'ression":"2+2"}' });
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/providers/anthropic.ts
async chatCompletionStream(
  options: ChatCompletionOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  const stream = this.client.messages.stream({
    model: options.model || this.model,
    max_tokens: 4096,
    messages: this.convertMessages(options.messages),
    ...(options.tools && { tools: this.convertTools(options.tools) }),
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
    .on('contentBlockDelta', ({ index, delta }) => {
      if (delta.type === 'input_json_delta') {
        callbacks.onToolUseDelta(
          delta.tool_use_id,
          delta.tool_name,
          delta.partial_json
        );
      }
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

---

### 2.2 SSE Writer Utility - Unit Tests

#### Test File: `backend/tests/unit/utils/sseWriter.test.ts`

**Test 15: SSEWriter sets correct headers**

```typescript
import { SSEWriter } from '../../../src/utils/sseWriter';
import { Response } from 'express';

describe('SSEWriter', () => {
  let mockRes: Partial<Response>;
  let setHeaderSpy: jest.Mock;
  let writeSpy: jest.Mock;
  let endSpy: jest.Mock;

  beforeEach(() => {
    setHeaderSpy = jest.fn();
    writeSpy = jest.fn();
    endSpy = jest.fn();

    mockRes = {
      setHeader: setHeaderSpy,
      write: writeSpy,
      end: endSpy,
    };
  });

  it('should set SSE headers on construction', () => {
    new SSEWriter(mockRes as Response);

    expect(setHeaderSpy).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(setHeaderSpy).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(setHeaderSpy).toHaveBeenCalledWith('Connection', 'keep-alive');
  });

  it('should write data in SSE format', () => {
    const writer = new SSEWriter(mockRes as Response);

    writer.write({ type: 'delta', text: 'Hello' });

    expect(writeSpy).toHaveBeenCalledWith('data: {"type":"delta","text":"Hello"}\n\n');
  });

  it('should end response', () => {
    const writer = new SSEWriter(mockRes as Response);

    writer.end();

    expect(endSpy).toHaveBeenCalled();
  });
});
```

**Implementation:**

```typescript
// backend/src/utils/sseWriter.ts
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

---

### 2.3 Streaming E2E Tests

#### Test File: `backend/tests/e2e/streaming.e2e.test.ts`

**Test 16: E2E streaming with SSE**

```typescript
import request from 'supertest';
import app from '../../src/app';
import { PrismaClient } from '@prisma/client';

describe('Streaming E2E', () => {
  let prisma: PrismaClient;
  let threadId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const thread = await prisma.thread.create({
      data: {
        userId: 'test-user',
        model: 'anthropic',
        status: 'active',
      },
    });
    threadId = thread.id;
  });

  afterAll(async () => {
    await prisma.thread.delete({ where: { id: threadId } });
    await prisma.$disconnect();
  });

  it('should stream text deltas via SSE', (done) => {
    const events: any[] = [];

    request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .send({
        content: 'Count to 3',
        model: 'anthropic',
        stream: true,
      })
      .expect(200)
      .expect('Content-Type', 'text/event-stream')
      .buffer(false)
      .parse((res, callback) => {
        res.on('data', (chunk) => {
          const lines = chunk.toString().split('\n\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              events.push(data);
            }
          }
        });
        res.on('end', () => callback(null, events));
      })
      .end((err, res) => {
        if (err) return done(err);

        expect(events.some(e => e.type === 'delta')).toBe(true);
        expect(events.some(e => e.type === 'done')).toBe(true);
        done();
      });
  });

  it('should stream tool execution events', (done) => {
    const events: any[] = [];

    request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .send({
        content: 'Calculate 2+2',
        model: 'anthropic',
        stream: true,
      })
      .expect(200)
      .buffer(false)
      .parse((res, callback) => {
        res.on('data', (chunk) => {
          const lines = chunk.toString().split('\n\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              events.push(JSON.parse(line.slice(6)));
            }
          }
        });
        res.on('end', () => callback(null, events));
      })
      .end((err, res) => {
        if (err) return done(err);

        expect(events.some(e => e.type === 'tool_use_start')).toBe(true);
        expect(events.some(e => e.type === 'tool_execution_result')).toBe(true);
        done();
      });
  });
});
```

**Implementation:**

```typescript
// backend/src/routes/threads.ts
router.post('/:threadId/messages', requireAuth, async (req, res) => {
  const { content, model, stream = true } = req.body;

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

---

## Phase 3: Vision & Multi-Modal

### 3.1 Image & Document Content Blocks - Unit Tests

#### Test File: `backend/tests/unit/types/content.test.ts`

**Test 17: ImageBlock type definition**

```typescript
import { ImageBlock, ImageSource } from '../../../src/types/content';

describe('ImageBlock', () => {
  it('should accept base64 image source', () => {
    const block: ImageBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo...',
      },
    };

    expect(block.type).toBe('image');
    expect(block.source.type).toBe('base64');
  });

  it('should accept URL image source', () => {
    const block: ImageBlock = {
      type: 'image',
      source: {
        type: 'url',
        media_type: 'image/jpeg',
        url: 'https://example.com/image.jpg',
      },
    };

    expect(block.source.type).toBe('url');
    expect(block.source.url).toBe('https://example.com/image.jpg');
  });
});
```

**Implementation:**

```typescript
// backend/src/types/content.ts
export interface ImageSource {
  type: 'base64' | 'url';
  media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data?: string;
  url?: string;
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

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | DocumentBlock
  | ToolUseBlock
  | ThinkingBlock;
```

---

### 3.2 File Upload Service - Unit Tests

#### Test File: `backend/tests/unit/services/fileUploadService.test.ts`

**Test 18: Upload file to S3**

```typescript
import { uploadFile } from '../../../src/services/fileUploadService';
import { S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

describe('FileUploadService', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  describe('uploadFile', () => {
    it('should upload file to S3 and return URL', async () => {
      s3Mock.resolves({});

      const buffer = Buffer.from('test image data');
      const url = await uploadFile(buffer, 'image/png', 'test.png');

      expect(url).toMatch(/^https:\/\/.+\.s3\..+\.amazonaws\.com\/attachments\/.+test\.png$/);
      expect(s3Mock.calls()).toHaveLength(1);
    });

    it('should generate unique keys for duplicate filenames', async () => {
      s3Mock.resolves({});

      const buffer = Buffer.from('test');
      const url1 = await uploadFile(buffer, 'image/png', 'test.png');
      const url2 = await uploadFile(buffer, 'image/png', 'test.png');

      expect(url1).not.toBe(url2);
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/services/fileUploadService.ts
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
```

---

### 3.3 Vision API Integration Tests

#### Test File: `backend/tests/integration/providers/anthropic-vision.integration.test.ts`

**Test 19: Anthropic provider with image content**

```typescript
describe('AnthropicProvider Vision', () => {
  it('should send image in message content', async () => {
    const mockResponse = {
      id: 'msg_127',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'This is a diagram showing...' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 50 },
    };

    nock('https://api.anthropic.com')
      .post('/v1/messages', (body) => {
        expect(body.messages[0].content).toEqual([
          { type: 'text', text: 'Describe this image' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'iVBORw0KGgo...',
            },
          },
        ]);
        return true;
      })
      .reply(200, mockResponse);

    const result = await provider.chatCompletion({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'iVBORw0KGgo...',
            },
          },
        ],
      }],
    });

    expect(result.text).toContain('diagram');
  });
});
```

---

### 3.4 File Upload E2E Tests

#### Test File: `backend/tests/e2e/vision.e2e.test.ts`

**Test 20: Upload image with message**

```typescript
import request from 'supertest';
import app from '../../src/app';
import path from 'path';

describe('Vision E2E', () => {
  it('should accept image upload and analyze it', async () => {
    const imagePath = path.join(__dirname, '../fixtures/test-diagram.png');

    const response = await request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .attach('attachments', imagePath)
      .field('content', 'What is in this diagram?')
      .field('model', 'anthropic')
      .expect(200);

    expect(response.body).toHaveProperty('message_id');
    expect(response.body.text).toBeTruthy();

    // Verify attachment saved to DB
    const message = await prisma.message.findUnique({
      where: { id: response.body.message_id },
      include: { attachments: true },
    });

    expect(message?.attachments).toHaveLength(1);
    expect(message?.attachments[0].type).toBe('image');
    expect(message?.attachments[0].storageUrl).toMatch(/^https:\/\/.+\.s3\./);
  });

  it('should accept PDF upload', async () => {
    const pdfPath = path.join(__dirname, '../fixtures/test-document.pdf');

    const response = await request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .attach('attachments', pdfPath)
      .field('content', 'Summarize this document')
      .field('model', 'anthropic')
      .expect(200);

    expect(response.body.text).toBeTruthy();

    const message = await prisma.message.findUnique({
      where: { id: response.body.message_id },
      include: { attachments: true },
    });

    expect(message?.attachments[0].type).toBe('document');
    expect(message?.attachments[0].mediaType).toBe('application/pdf');
  });

  it('should reject unsupported file types', async () => {
    const response = await request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .attach('attachments', Buffer.from('test'), 'test.txt')
      .field('content', 'Analyze this')
      .expect(400);

    expect(response.body.error).toContain('Unsupported file type');
  });

  it('should reject files over 5MB', async () => {
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024);  // 6MB

    const response = await request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .attach('attachments', largeBuffer, 'large.png')
      .field('content', 'Analyze this')
      .expect(413);

    expect(response.body.error).toContain('File too large');
  });
});
```

**Implementation:**

```typescript
// backend/src/routes/threads.ts
import multer from 'multer';
import { uploadFile } from '../services/fileUploadService';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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
  upload.array('attachments', 10),
  async (req, res) => {
    const { content, model } = req.body;
    const files = req.files as Express.Multer.File[];

    // Upload files to S3
    const uploadedUrls = await Promise.all(
      files.map(file => uploadFile(file.buffer, file.mimetype, file.originalname))
    );

    // Build content blocks
    const contentBlocks: ContentBlockParam[] = [
      { type: 'text', text: content },
    ];

    for (let i = 0; i < uploadedUrls.length; i++) {
      const file = files[i];
      const url = uploadedUrls[i];

      if (file.mimetype.startsWith('image/')) {
        contentBlocks.push({
          type: 'image',
          source: { type: 'url', media_type: file.mimetype as any, url },
        });
      } else if (file.mimetype === 'application/pdf') {
        contentBlocks.push({
          type: 'document',
          source: { type: 'url', media_type: 'application/pdf', url },
        });
      }
    }

    // ... rest of handler
  }
);
```

---

## Phase 4: Prompt Caching

### 4.1 Cache Control Types - Unit Tests

#### Test File: `backend/tests/unit/types/content.test.ts`

**Test 21: CacheControl type**

```typescript
import { CacheControl, TextBlockParam } from '../../../src/types/content';

describe('CacheControl', () => {
  it('should have type "ephemeral"', () => {
    const cacheControl: CacheControl = { type: 'ephemeral' };
    expect(cacheControl.type).toBe('ephemeral');
  });

  it('should be optional in TextBlockParam', () => {
    const block: TextBlockParam = {
      type: 'text',
      text: 'System prompt',
      cache_control: { type: 'ephemeral' },
    };

    expect(block.cache_control?.type).toBe('ephemeral');
  });
});
```

**Implementation:**

```typescript
// backend/src/types/content.ts
export interface CacheControl {
  type: 'ephemeral';
}

export interface TextBlockParam {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}
```

---

### 4.2 Context Service with Caching - Unit Tests

#### Test File: `backend/tests/unit/services/contextService.test.ts`

**Test 22: Build context with cache breakpoints**

```typescript
import { ContextService } from '../../../src/services/contextService';

describe('ContextService', () => {
  let contextService: ContextService;

  beforeEach(() => {
    contextService = new ContextService();
  });

  describe('buildContext with caching', () => {
    it('should add cache_control to system prompt when enabled', () => {
      const messages = contextService.buildContext(
        'thread-1',
        [],
        'You are a helpful assistant',
        [],
        {
          enableCaching: true,
          cacheBreakpoints: { afterSystemPrompt: true },
        }
      );

      expect(messages[0].content[0]).toEqual({
        type: 'text',
        text: 'You are a helpful assistant',
        cache_control: { type: 'ephemeral' },
      });
    });

    it('should add cache_control to last tool when enabled', () => {
      const tools = [
        { name: 'tool1', description: 'Tool 1', input_schema: { type: 'object', properties: {} } },
        { name: 'tool2', description: 'Tool 2', input_schema: { type: 'object', properties: {} } },
      ];

      const messages = contextService.buildContext(
        'thread-1',
        [],
        '',
        tools,
        {
          enableCaching: true,
          cacheBreakpoints: { afterTools: true },
        }
      );

      expect(tools[0].cache_control).toBeUndefined();
      expect(tools[1].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('should not add cache_control when disabled', () => {
      const messages = contextService.buildContext(
        'thread-1',
        [],
        'System prompt',
        [],
        { enableCaching: false }
      );

      expect(messages[0].content[0].cache_control).toBeUndefined();
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/services/contextService.ts
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

    // Add system prompt with optional caching
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: 
              options.enableCaching && options.cacheBreakpoints?.afterSystemPrompt
                ? { type: 'ephemeral' }
                : undefined,
          },
        ],
      });
    }

    // Add cache_control to last tool if enabled
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

---

### 4.3 Database Schema for Cache Metrics - Integration Tests

#### Test File: `backend/tests/integration/database/schema.test.ts`

**Test 23: Message schema includes cache metrics**

```typescript
describe('Message model cache metrics', () => {
  it('should have cacheHitTokens and cacheWriteTokens fields', async () => {
    const message = await prisma.message.create({
      data: {
        thread: {
          create: {
            userId: 'test-user',
            model: 'anthropic',
            status: 'active',
          },
        },
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        inputTokens: 1000,
        outputTokens: 100,
        cacheHitTokens: 900,
        cacheWriteTokens: 100,
      },
    });

    expect(message.cacheHitTokens).toBe(900);
    expect(message.cacheWriteTokens).toBe(100);

    // Cleanup
    await prisma.message.delete({ where: { id: message.id } });
    await prisma.thread.delete({ where: { id: message.threadId } });
  });
});
```

**Implementation:**

```prisma
// backend/prisma/schema.prisma
model Message {
  id               String   @id @default(uuid())
  threadId         String
  role             String
  content          Json
  toolCalls        Json?
  stopReason       String?
  inputTokens      Int?
  outputTokens     Int?
  thinkingTokens   Int?
  cacheHitTokens   Int?  // NEW
  cacheWriteTokens Int?  // NEW
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  thread      Thread       @relation(fields: [threadId], references: [id], onDelete: Cascade)
  attachments Attachment[]

  @@index([threadId])
}
```

---

### 4.4 Cost Savings Analytics - E2E Tests

#### Test File: `backend/tests/e2e/analytics.e2e.test.ts`

**Test 24: GET /api/v1/analytics/cost-savings**

```typescript
describe('Analytics API', () => {
  describe('GET /api/v1/analytics/cost-savings', () => {
    it('should calculate cost savings from cache hits', async () => {
      // Create test messages with cache metrics
      await prisma.message.createMany({
        data: [
          {
            threadId: thread.id,
            role: 'assistant',
            content: [{ type: 'text', text: 'Response 1' }],
            inputTokens: 1000,
            outputTokens: 100,
            cacheWriteTokens: 1000,  // First request - write to cache
            createdAt: new Date('2026-04-01'),
          },
          {
            threadId: thread.id,
            role: 'assistant',
            content: [{ type: 'text', text: 'Response 2' }],
            inputTokens: 100,
            outputTokens: 100,
            cacheHitTokens: 900,  // Subsequent request - cache hit
            createdAt: new Date('2026-04-02'),
          },
        ],
      });

      const response = await request(app)
        .get('/api/v1/analytics/cost-savings')
        .query({
          startDate: '2026-04-01',
          endDate: '2026-04-03',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        totalInputTokens: 1100,
        totalCacheHits: 900,
        totalCacheWrites: 1000,
        savings: expect.any(Number),
        savingsPercent: expect.any(Number),
      });

      expect(response.body.savingsPercent).toBeGreaterThan(0);
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/routes/analytics.ts
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

  // Claude pricing
  const inputCost = (totalInputTokens * 0.003) / 1000;
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

### 5.1 Batch Database Schema - Integration Tests

#### Test File: `backend/tests/integration/database/batch.test.ts`

**Test 25: Batch model CRUD operations**

```typescript
describe('Batch model', () => {
  it('should create batch with pending status', async () => {
    const batch = await prisma.batch.create({
      data: {
        userId: 'test-user',
        status: 'pending',
        requestCount: 100,
        inputFileUrl: 'https://s3.../input.jsonl',
      },
    });

    expect(batch.status).toBe('pending');
    expect(batch.processedCount).toBe(0);
    expect(batch.succeededCount).toBe(0);

    await prisma.batch.delete({ where: { id: batch.id } });
  });

  it('should update batch status and counts', async () => {
    const batch = await prisma.batch.create({
      data: {
        userId: 'test-user',
        providerBatchId: 'batch_123',
        status: 'validating',
        requestCount: 100,
      },
    });

    const updated = await prisma.batch.update({
      where: { id: batch.id },
      data: {
        status: 'in_progress',
        processedCount: 50,
        succeededCount: 45,
        erroredCount: 5,
      },
    });

    expect(updated.status).toBe('in_progress');
    expect(updated.succeededCount).toBe(45);

    await prisma.batch.delete({ where: { id: batch.id } });
  });
});
```

**Implementation:**

```prisma
// backend/prisma/schema.prisma
model Batch {
  id              String   @id @default(uuid())
  userId          String
  providerBatchId String?
  status          String
  requestCount    Int
  processedCount  Int      @default(0)
  succeededCount  Int      @default(0)
  erroredCount    Int      @default(0)
  inputFileUrl    String?
  resultFileUrl   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId])
  @@index([status])
}
```

---

### 5.2 Batch Service - Unit Tests

#### Test File: `backend/tests/unit/services/batchService.test.ts`

**Test 26: Create batch and submit to Anthropic**

```typescript
import { createBatch } from '../../../src/services/batchService';
import { uploadFile } from '../../../src/services/fileUploadService';
import Anthropic from '@anthropic-ai/sdk';

jest.mock('../../../src/services/fileUploadService');
jest.mock('@anthropic-ai/sdk');

describe('BatchService', () => {
  describe('createBatch', () => {
    it('should generate JSONL and upload to S3', async () => {
      const mockUploadFile = uploadFile as jest.MockedFunction<typeof uploadFile>;
      mockUploadFile.mockResolvedValue('https://s3.../batch-input.jsonl');

      const mockAnthropicCreate = jest.fn().mockResolvedValue({
        id: 'batch_123',
        processing_status: 'validating',
      });

      (Anthropic as any).mockImplementation(() => ({
        messages: {
          batches: {
            create: mockAnthropicCreate,
          },
        },
      }));

      const requests = [
        { custom_id: 'req-1', params: { model: 'claude-4.6-opus', messages: [] } },
        { custom_id: 'req-2', params: { model: 'claude-4.6-opus', messages: [] } },
      ];

      const batchId = await createBatch('test-user', requests);

      expect(mockUploadFile).toHaveBeenCalled();
      expect(mockAnthropicCreate).toHaveBeenCalledWith({ requests });
      expect(batchId).toBeTruthy();
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/services/batchService.ts
import Anthropic from '@anthropic-ai/sdk';
import { uploadFile } from './fileUploadService';
import { prisma } from '../config/database';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function createBatch(
  userId: string,
  requests: Array<{ custom_id: string; params: any }>
): Promise<string> {
  // Generate JSONL
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
```

---

### 5.3 Batch API - E2E Tests

#### Test File: `backend/tests/e2e/batches.e2e.test.ts`

**Test 27: POST /api/v1/batches**

```typescript
describe('Batch API', () => {
  describe('POST /api/v1/batches', () => {
    it('should create batch and return batch ID', async () => {
      const response = await request(app)
        .post('/api/v1/batches')
        .send({
          requests: [
            {
              custom_id: 'eval-1',
              params: {
                model: 'claude-4.6-opus',
                max_tokens: 1024,
                messages: [{ role: 'user', content: 'Evaluate this code...' }],
              },
            },
            {
              custom_id: 'eval-2',
              params: {
                model: 'claude-4.6-opus',
                max_tokens: 1024,
                messages: [{ role: 'user', content: 'Evaluate this other code...' }],
              },
            },
          ],
        })
        .expect(200);

      expect(response.body).toHaveProperty('batchId');

      const batch = await prisma.batch.findUnique({
        where: { id: response.body.batchId },
      });

      expect(batch?.status).toBe('validating');
      expect(batch?.requestCount).toBe(2);
    });

    it('should reject empty requests array', async () => {
      const response = await request(app)
        .post('/api/v1/batches')
        .send({ requests: [] })
        .expect(400);

      expect(response.body.error).toContain('requests must be an array of 1-10000 items');
    });

    it('should reject over 10000 requests', async () => {
      const requests = Array.from({ length: 10001 }, (_, i) => ({
        custom_id: `req-${i}`,
        params: { model: 'claude-4.6-opus', messages: [] },
      }));

      const response = await request(app)
        .post('/api/v1/batches')
        .send({ requests })
        .expect(400);

      expect(response.body.error).toContain('10000');
    });
  });

  describe('GET /api/v1/batches/:batchId', () => {
    it('should return batch status', async () => {
      const batch = await prisma.batch.create({
        data: {
          userId: 'test-user',
          providerBatchId: 'batch_123',
          status: 'in_progress',
          requestCount: 100,
          processedCount: 50,
          succeededCount: 45,
          erroredCount: 5,
        },
      });

      const response = await request(app)
        .get(`/api/v1/batches/${batch.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: batch.id,
        status: 'in_progress',
        requestCount: 100,
        processedCount: 50,
        succeededCount: 45,
        erroredCount: 5,
      });

      await prisma.batch.delete({ where: { id: batch.id } });
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/routes/batches.ts
router.post('/', requireAuth, async (req, res) => {
  const { requests } = req.body;

  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 10000) {
    return res.status(400).json({ error: 'requests must be an array of 1-10000 items' });
  }

  const batchId = await createBatch(req.user!.id, requests);
  await scheduleBatchPolling(batchId);

  res.json({ batchId });
});

router.get('/:batchId', requireAuth, async (req, res) => {
  const batch = await prisma.batch.findUnique({
    where: { id: req.params.batchId, userId: req.user!.id },
  });

  if (!batch) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  res.json(batch);
});
```

---

## Phase 6: Output Configuration

### 6.1 Output Configuration Types - Unit Tests

#### Test File: `backend/tests/unit/types/messages.test.ts`

**Test 28: OutputConfig type definition**

```typescript
import { OutputConfig } from '../../../src/types/messages';

describe('OutputConfig', () => {
  it('should define json_schema output type', () => {
    const config: OutputConfig = {
      type: 'json_schema',
      json_schema: {
        name: 'user_profile',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
        },
      },
    };

    expect(config.type).toBe('json_schema');
    expect(config.json_schema.name).toBe('user_profile');
  });
});
```

**Implementation:**

```typescript
// backend/src/types/messages.ts
export interface OutputConfig {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
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
  parsed?: Record<string, unknown>;  // NEW
  usage?: TokenUsage;
}
```

---

### 6.2 Structured Output - Integration Tests

#### Test File: `backend/tests/integration/providers/anthropic-output.integration.test.ts`

**Test 29: Anthropic provider with output configuration**

```typescript
describe('AnthropicProvider Structured Output', () => {
  it('should return parsed JSON when output config provided', async () => {
    const mockResponse = {
      id: 'msg_128',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '{"name":"John Doe","age":30,"email":"john@example.com"}',
        },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    nock('https://api.anthropic.com')
      .post('/v1/messages', (body) => {
        expect(body.output).toEqual({
          type: 'json_schema',
          json_schema: {
            name: 'user_profile',
            schema: expect.any(Object),
          },
        });
        return true;
      })
      .reply(200, mockResponse);

    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'Extract user from: John Doe, 30, john@example.com' }],
      output: {
        type: 'json_schema',
        json_schema: {
          name: 'user_profile',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' },
              email: { type: 'string' },
            },
            required: ['name', 'age', 'email'],
          },
        },
      },
    });

    expect(result.parsed).toEqual({
      name: 'John Doe',
      age: 30,
      email: 'john@example.com',
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/providers/anthropic.ts
async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const response = await this.client.messages.create({
    model: options.model || this.model,
    max_tokens: 4096,
    messages: this.convertMessages(options.messages),
    ...(options.tools && { tools: this.convertTools(options.tools) }),
    ...(options.output && { output: options.output }),
  });

  let parsed: Record<string, unknown> | undefined;
  if (options.output && response.content[0]?.type === 'text') {
    try {
      parsed = JSON.parse(response.content[0].text);
    } catch (error) {
      // Handle JSON parse error
    }
  }

  return {
    text: this.extractText(response.content),
    contentBlocks: this.convertContentBlocks(response.content),
    toolCalls: [],
    stopReason: this.mapStopReason(response.stop_reason),
    parsed,
    usage: this.mapUsage(response.usage),
  };
}
```

---

### 6.3 Structured Output E2E Tests

#### Test File: `backend/tests/e2e/output-config.e2e.test.ts`

**Test 30: POST with output_schema parameter**

```typescript
describe('Structured Output E2E', () => {
  it('should return parsed JSON response', async () => {
    const response = await request(app)
      .post(`/api/v1/threads/${threadId}/messages`)
      .send({
        content: 'Extract: Alice Smith, 25, alice@example.com',
        model: 'anthropic',
        output_schema: {
          name: 'user_profile',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' },
              email: { type: 'string' },
            },
            required: ['name', 'age', 'email'],
          },
        },
      })
      .expect(200);

    expect(response.body.parsed).toEqual({
      name: 'Alice Smith',
      age: 25,
      email: 'alice@example.com',
    });
  });
});
```

**Implementation:**

```typescript
// backend/src/routes/threads.ts
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
    message_id: assistantMessage.id,
    text: result.text,
    parsed: result.parsed,
  });
});
```

---

## Test Infrastructure

### Test Database Setup

**File:** `backend/tests/setup.ts`

```typescript
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_TEST,
    },
  },
});

beforeAll(async () => {
  // Reset test database
  execSync('npx prisma migrate reset --force --skip-seed', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
  });

  // Run migrations
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

global.prisma = prisma;
```

**File:** `backend/jest.config.ts`

```typescript
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testMatch: ['**/*.test.ts', '**/*.e2e.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
```

### Environment Variables for Tests

**File:** `backend/.env.test`

```bash
DATABASE_URL_TEST=postgresql://ai_sandbox:ai_sandbox_test@localhost:5433/ai_sandbox_test?schema=public
ANTHROPIC_API_KEY=test-key-use-nock-mocks
OPENAI_API_KEY=test-key-use-nock-mocks
AWS_REGION=us-east-1
S3_BUCKET=test-bucket
```

### Mock Fixtures

**File:** `backend/tests/fixtures/anthropic-responses.ts`

```typescript
export const mockThinkingResponse = {
  id: 'msg_thinking_1',
  type: 'message',
  role: 'assistant',
  content: [
    {
      type: 'thinking',
      thinking: 'Let me solve this step by step...',
    },
    {
      type: 'text',
      text: 'The answer is 56088',
    },
  ],
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 20,
    output_tokens: 50,
    thinking_tokens: 200,
  },
};

export const mockToolUseResponse = {
  id: 'msg_tool_1',
  type: 'message',
  role: 'assistant',
  content: [
    {
      type: 'tool_use',
      id: 'toolu_1',
      name: 'calculator',
      input: { expression: '2+2' },
    },
  ],
  stop_reason: 'tool_use',
  usage: {
    input_tokens: 100,
    output_tokens: 50,
  },
};
```

---

## CI/CD Integration

### GitHub Actions Workflow

**File:** `.github/workflows/test.yml`

```yaml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: ai_sandbox
          POSTGRES_PASSWORD: ai_sandbox_test
          POSTGRES_DB: ai_sandbox_test
        ports:
          - 5433:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install dependencies
        run: |
          cd backend
          npm ci

      - name: Run migrations
        run: |
          cd backend
          npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://ai_sandbox:ai_sandbox_test@localhost:5433/ai_sandbox_test?schema=public

      - name: Run unit tests
        run: |
          cd backend
          npm run test:unit

      - name: Run integration tests
        run: |
          cd backend
          npm run test:integration
        env:
          DATABASE_URL_TEST: postgresql://ai_sandbox:ai_sandbox_test@localhost:5433/ai_sandbox_test?schema=public

      - name: Run E2E tests
        run: |
          cd backend
          npm run test:e2e
        env:
          DATABASE_URL_TEST: postgresql://ai_sandbox:ai_sandbox_test@localhost:5433/ai_sandbox_test?schema=public

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./backend/coverage/lcov.info
```

### NPM Scripts

**File:** `backend/package.json`

```json
{
  "scripts": {
    "test": "jest --runInBand",
    "test:unit": "jest --testPathPattern='tests/unit' --runInBand",
    "test:integration": "jest --testPathPattern='tests/integration' --runInBand",
    "test:e2e": "jest --testPathPattern='tests/e2e' --runInBand",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage --runInBand"
  }
}
```

---

## TDD Workflow Summary

### For Each Feature

1. **Write failing test (RED)**
   ```bash
   npm run test:watch
   # Write test that defines behavior
   # Watch it fail
   ```

2. **Write minimal code (GREEN)**
   ```typescript
   // Implement just enough to pass the test
   // No extra features
   // No premature optimization
   ```

3. **Refactor (REFACTOR)**
   ```typescript
   // Clean up code
   // Extract functions
   // Remove duplication
   // Tests still pass
   ```

4. **Repeat** for next test

### Test Execution Order

1. **Unit tests** - Run first (fastest)
2. **Integration tests** - Run second (DB required)
3. **E2E tests** - Run last (full stack required)

### Coverage Requirements

- **Minimum**: 70% across all metrics
- **Unit tests**: 80%+ for business logic
- **Integration tests**: 100% for database operations
- **E2E tests**: Happy path + critical error cases

---

**Next:** Begin Phase 1 implementation following TDD methodology outlined above.
