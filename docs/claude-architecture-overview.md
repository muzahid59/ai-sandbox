# Claude API Architecture - High-Level Overview

**Date:** 2026-04-13  
**Author:** Research Analysis  
**Purpose:** Document how Anthropic Claude implements advanced AI features and inform design decisions for ai-sandbox backend

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Core Architecture Patterns](#core-architecture-patterns)
3. [Message Streaming Architecture](#message-streaming-architecture)
4. [Tool Use System](#tool-use-system)
5. [Prompt Caching Infrastructure](#prompt-caching-infrastructure)
6. [Extended Thinking Pipeline](#extended-thinking-pipeline)
7. [Vision & Multi-Modal Processing](#vision--multi-modal-processing)
8. [Batch Processing System](#batch-processing-system)
9. [SDK Design Patterns](#sdk-design-patterns)
10. [Claude Code Architecture](#claude-code-architecture)
11. [Technology Stack](#technology-stack)
12. [Key Takeaways](#key-takeaways)

---

## Executive Summary

Anthropic's Claude API architecture is built on four foundational principles:

1. **Content Block Abstraction** - All content (text, images, tools, thinking) represented as discriminated unions
2. **Streaming-First** - Real-time server-sent events with incremental delta updates
3. **Tool Execution Pattern** - Agentic loop with parallel tool execution and result feedback
4. **Cost Optimization** - Automatic prompt caching with workspace isolation

### Reference Implementations

- **Official TypeScript SDK**: [anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript)
- **Official Python SDK**: [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python)
- **Claude Code**: 512,000 lines TypeScript, React + Ink terminal UI, 40+ tools ([leaked March 31, 2026](https://github.com/anthropics/claude-code))

---

## Core Architecture Patterns

### 1. Content Block System

**Concept:** All message content is represented as a tagged union of content blocks, enabling extensibility and type safety.

**Content Block Types:**

```typescript
type ContentBlock = 
  | TextBlock
  | ImageBlock
  | DocumentBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

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

interface ThinkingBlock {
  type: 'thinking';
  thinking: string;  // Internal reasoning
}
```

**Why This Matters:**
- Extensible without breaking API changes
- Type-safe parsing with discriminated unions
- Supports heterogeneous content (text + images + tools)
- Enables partial streaming of complex responses

### 2. Message Structure

**Design:** Messages contain role + array of content blocks (not just strings).

```typescript
interface Message {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}
```

**Advantages:**
- User messages can combine text prompts + images + PDFs
- Assistant responses can interleave text + tool use + thinking
- Tool results returned as user messages with `tool_result` blocks
- Simplifies agentic loop implementation

### 3. System Prompts as Parameters

**Pattern:** System prompts are top-level request parameters, NOT role-based messages.

```typescript
interface CreateMessageRequest {
  model: string;
  max_tokens: number;
  system?: string | SystemBlock[];  // Separate from messages
  messages: Message[];
  tools?: ToolDefinition[];
}
```

**Rationale:**
- System prompts apply globally to conversation
- Cacheable independently from message history
- Supports multi-part system prompts with `cache_control`

---

## Message Streaming Architecture

### Server-Sent Events (SSE) Protocol

**Event Types:**

| Event | When Fired | Payload |
|-------|-----------|---------|
| `message_start` | Response begins | Metadata (id, model, role) |
| `content_block_start` | New content block starts | Block index, type |
| `content_block_delta` | Incremental content | Text delta or JSON partial |
| `content_block_stop` | Block complete | Block index |
| `message_delta` | Stop reason update | Stop reason, usage |
| `message_stop` | Response complete | N/A |
| `ping` | Keepalive | Timestamp |

**Delta Streaming Pattern:**

```typescript
// Text deltas
{
  type: 'content_block_delta',
  index: 0,
  delta: {
    type: 'text_delta',
    text: 'chunk of text'
  }
}

// Tool input JSON deltas
{
  type: 'content_block_delta',
  index: 1,
  delta: {
    type: 'input_json_delta',
    partial_json: '{"location": "San'
  }
}
```

**SDK Implementation:**

Anthropic SDK provides two streaming modes:

1. **High-level `MessageStream`** - Event emitters + accumulation:

```typescript
const stream = client.messages.stream({ ... })
  .on('text', (textDelta, textSnapshot) => {
    console.log(textDelta);  // Incremental text
  })
  .on('contentBlock', (block) => {
    console.log(block);  // Complete block
  })
  .on('finalMessage', (message) => {
    console.log(message);  // Fully accumulated
  });

const message = await stream.finalMessage();
```

2. **Low-level async iterator** - Manual event handling:

```typescript
const stream = await client.messages.create({
  stream: true,
  ...
});

for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    console.log(event.delta);
  }
}
```

**Memory Efficiency:** Low-level mode uses less memory (no accumulation state).

**Architecture Benefits:**
- Real-time UI updates (token-by-token rendering)
- Early tool use detection (can execute tools before response completes)
- Graceful degradation (partial results on timeout/error)
- Reduced perceived latency

---

## Tool Use System

### Agentic Loop Pattern

**Flow:**

```
1. User sends message with tools available
2. LLM responds with tool_use blocks (may include parallel calls)
3. Client executes ALL tools in parallel
4. Client sends tool results back as user message
5. LLM continues (may use more tools or respond with text)
6. Repeat until stop_reason != 'tool_use'
```

**Implementation (from Anthropic SDK):**

```typescript
// Tool definition with Zod schema
const weatherTool = betaZodTool({
  name: 'get_weather',
  inputSchema: z.object({
    location: z.string(),
  }),
  description: 'Get the current weather in a given location',
  run: async (input) => {
    return `The weather in ${input.location} is 60°F`;
  },
});

// Automatic agentic loop
const finalMessage = await client.beta.messages.toolRunner({
  model: 'claude-sonnet-4-5',
  max_tokens: 1000,
  messages: [{ role: 'user', content: 'What is the weather in SF?' }],
  tools: [weatherTool],
});
```

**Under the hood (manual loop):**

```typescript
let messages = [{ role: 'user', content: 'Calculate 5 + 3' }];

while (true) {
  const response = await client.messages.create({
    model: 'claude-4.6-opus',
    max_tokens: 1024,
    messages,
    tools: [calculatorTool],
  });

  // Append assistant response
  messages.push({
    role: 'assistant',
    content: response.content,
  });

  // If no tool use, we're done
  if (response.stop_reason !== 'tool_use') {
    return response;
  }

  // Execute all tool calls in parallel
  const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
  const toolResultPromises = toolUseBlocks.map(async (toolUse) => {
    const result = await executeTool(toolUse.name, toolUse.input);
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUse.id,
      content: result,
    };
  });

  const toolResults = await Promise.all(toolResultPromises);

  // Append tool results as user message
  messages.push({
    role: 'user',
    content: toolResults,
  });
}
```

### Key Design Decisions

1. **Parallel Execution:** All tool calls in a single response execute concurrently
2. **Idempotency:** Tool use IDs enable request retries without duplicate execution
3. **Error Handling:** Tool results include `is_error: true` flag for failures
4. **Streaming Support:** Tool use blocks can stream `input_json` deltas

### Strict Tool Use

**Feature:** Guaranteed schema conformance with `strict: true`.

```typescript
{
  tools: [
    {
      name: 'calculate',
      strict: true,  // LLM guarantees valid schema
      input_schema: {
        type: 'object',
        properties: {
          expression: { type: 'string' }
        },
        required: ['expression']
      }
    }
  ]
}
```

**Benefit:** Skip client-side validation - Claude validates before returning `tool_use` blocks.

### Tool Choice Control

**Modes:**

```typescript
tool_choice: 'auto'  // Model decides (default)
tool_choice: 'any'   // Must use at least one tool
tool_choice: 'none'  // No tools allowed
tool_choice: { type: 'tool', name: 'web_search' }  // Force specific tool
```

**Use cases:**
- `'any'` - Ensure model uses tools (prevent hallucinated answers)
- `'none'` - Disable tools for final summary responses
- Specific tool - Force workflow steps (e.g., always search before answering)

---

## Prompt Caching Infrastructure

### How It Works

**Mechanism:** Anthropic automatically caches prompt prefixes (system prompts, tool definitions, long context) with workspace-level isolation.

**Cache Keys:**
- User workspace ID (workspace-level isolation)
- Exact byte-for-byte prefix match
- Excludes user-specific data (no cross-user leakage)

**TTL:**
- Default: 5 minutes
- With `cache_control`: up to 1 hour

**Cost Model:**
- Cache writes: 25% markup (first use)
- Cache hits: 90% discount
- Cache misses: Full price

### Cache Control Blocks

**Pattern:** Add `cache_control` to content blocks at cache breakpoints.

```typescript
{
  system: [
    {
      type: 'text',
      text: 'You are an expert developer with access to...',
      cache_control: { type: 'ephemeral' }  // Cache this
    }
  ],
  tools: [
    { name: 'tool1', ... },
    { name: 'tool2', ... },
    { 
      name: 'tool3', 
      ...,
      cache_control: { type: 'ephemeral' }  // Cache up to here
    }
  ],
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '# Codebase context (50,000 tokens)...',
          cache_control: { type: 'ephemeral' }  // Cache long context
        },
        {
          type: 'text',
          text: 'Now answer this specific question...'  // NOT cached
        }
      ]
    }
  ]
}
```

### Cache Breakpoint Strategy

**Best practices:**
1. Place `cache_control` after stable, long-lived content
2. User-specific queries go AFTER last cache breakpoint
3. Minimize breakpoints (each one creates a cache entry)

**Example:**

```
[System prompt]                      ← cache_control (rarely changes)
[Tool definitions]                   ← cache_control (rarely changes)
[Codebase context - 50K tokens]      ← cache_control (stable per session)
[Conversation history - variable]    ← NOT cached (changes every request)
[Current user query]                 ← NOT cached (unique per request)
```

**ROI Analysis:**

| Scenario | Uncached Cost | Cached Cost (after 1st) | Savings |
|----------|--------------|------------------------|---------|
| 100K context, 10 requests | $100 | $11.25 | 88.75% |
| System prompt + tools (5K), 100 requests | $50 | $5.63 | 88.75% |

---

## Extended Thinking Pipeline

### Concept

**What:** LLM performs internal reasoning before responding, with dedicated token budget.

**Why:** Improves quality on complex tasks (code generation, math, logic puzzles).

**Models:** Opus 4.6, Sonnet 4.6 (not available on Haiku 4.5).

### Request Format

```typescript
{
  model: 'claude-4.6-opus',
  thinking: {
    type: 'enabled',
    budget_tokens: 10000  // Min 1024, max varies by model
  },
  messages: [...]
}
```

### Response Format

**Thinking appears as first content block:**

```typescript
{
  content: [
    {
      type: 'thinking',
      thinking: 'Let me break down this problem step by step...\n\n1. First, I need to...'
    },
    {
      type: 'text',
      text: 'Here is the solution: ...'
    }
  ],
  usage: {
    input_tokens: 100,
    output_tokens: 500,
    thinking_tokens: 2500  // Separate billing
  }
}
```

### Billing

- Thinking tokens billed at output token rates
- Separate usage field for transparency
- Budget controls max thinking cost

### UI Considerations

**Display options:**
1. **Collapsible section** - "Show reasoning (2,500 tokens)"
2. **Separate panel** - Split thinking / final answer
3. **Progress indicator** - Show thinking in progress during streaming

---

## Vision & Multi-Modal Processing

### Supported Formats

**Images:**
- PNG, JPEG, GIF, WebP
- Max size: 5MB per image
- Max dimensions: 8000x8000 pixels
- Limit: 100 images per request

**Documents:**
- PDF (up to 100 pages)
- Text extraction via Anthropic infrastructure

### Request Structure

```typescript
{
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Analyze this architecture diagram' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgo...'
          }
        }
      ]
    }
  ]
}
```

**URL support:**

```typescript
{
  type: 'image',
  source: {
    type: 'url',
    url: 'https://example.com/diagram.png'
  }
}
```

### PDF Processing

```typescript
{
  type: 'document',
  source: {
    type: 'base64',
    media_type: 'application/pdf',
    data: 'JVBERi0xLjQK...'
  }
}
```

**Extraction:** Anthropic converts PDFs to text + layout understanding.

### Architecture Patterns

**Storage strategy:**
1. **Client uploads image/PDF to S3/blob storage**
2. **Store URL reference in database** (not base64)
3. **Send base64 or URL to Claude on request**

**Why:** Avoids database bloat from binary data in JSONB columns.

---

## Batch Processing System

### Overview

**Purpose:** 50% cost reduction for async workloads (evals, labeling, content moderation).

**Limits:**
- Up to 10,000 requests per batch
- 24-hour turnaround SLA
- JSONL input/output format

### Workflow

**1. Create Batch:**

```bash
curl https://api.anthropic.com/v1/messages/batches \
  -H "anthropic-version: 2025-02-15" \
  -d '{
    "requests": [
      {
        "custom_id": "eval-001",
        "params": {
          "model": "claude-4.6-opus",
          "max_tokens": 1024,
          "messages": [{"role": "user", "content": "Evaluate this code..."}]
        }
      },
      {
        "custom_id": "eval-002",
        "params": { ... }
      }
    ]
  }'
```

**2. Poll Status:**

```bash
curl https://api.anthropic.com/v1/messages/batches/{batch_id}
```

**Response:**
```json
{
  "id": "batch_123",
  "processing_status": "in_progress",
  "request_counts": {
    "processing": 5000,
    "succeeded": 3000,
    "errored": 100
  }
}
```

**3. Download Results (when status = 'ended'):**

```bash
curl https://api.anthropic.com/v1/messages/batches/{batch_id}/results
```

**JSONL output:**
```jsonl
{"custom_id": "eval-001", "result": {"type": "succeeded", "message": {...}}}
{"custom_id": "eval-002", "result": {"type": "errored", "error": {...}}}
```

### Architecture Requirements

**Backend:**
- Job queue (BullMQ, Celery, AWS SQS)
- Background workers for batch submission
- Webhook handler for batch completion notifications
- JSONL parser/generator

**Database:**
- Batch status table (id, status, request_count, created_at)
- Batch results storage (S3/blob store for large JSONL)

---

## SDK Design Patterns

### 1. Helper Abstraction

**Pattern:** High-level helpers wrap low-level API calls for common workflows.

**Example:** `toolRunner()` automates agentic loop:

```typescript
// High-level
const result = await client.beta.messages.toolRunner({
  tools: [weatherTool],
  messages: [...]
});

// Equivalent low-level
let messages = [...];
while (true) {
  const response = await client.messages.create({ messages, tools });
  if (response.stop_reason !== 'tool_use') break;
  const toolResults = await executeTools(response.content);
  messages.push({ role: 'assistant', content: response.content });
  messages.push({ role: 'user', content: toolResults });
}
```

**Benefits:**
- Reduces boilerplate
- Handles edge cases (errors, retries)
- Maintains explicit low-level API for power users

### 2. Zod Schema Integration

**Pattern:** Use Zod for runtime validation + TypeScript types.

```typescript
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const weatherTool = betaZodTool({
  name: 'get_weather',
  inputSchema: z.object({
    location: z.string(),
    units: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  run: async (input) => {
    // input is type-safe: { location: string; units?: 'celsius' | 'fahrenheit' }
    return await fetchWeather(input.location, input.units);
  },
});
```

**Generates:**
```json
{
  "name": "get_weather",
  "input_schema": {
    "type": "object",
    "properties": {
      "location": { "type": "string" },
      "units": { "type": "string", "enum": ["celsius", "fahrenheit"] }
    },
    "required": ["location"]
  }
}
```

**Advantages:**
- Single source of truth (Zod schema → JSON Schema + TypeScript types)
- Runtime validation on tool execution
- DRY (don't repeat schema definitions)

### 3. Structured Outputs with Zod

**Pattern:** Parse responses into typed objects.

```typescript
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const UserProfile = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const message = await client.messages.parse({
  model: 'claude-4.6-opus',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Extract user profile from this text...' }],
  output_config: {
    format: zodOutputFormat(UserProfile),
  },
});

// message.parsed is typed as z.infer<typeof UserProfile>
console.log(message.parsed.name);  // Type-safe access
```

---

## Claude Code Architecture

### Source Code Leak (March 31, 2026)

Claude Code's source was [accidentally exposed on npm](https://github.com/anthropics/claude-code) via sourcemap files. Community preserved the [512,000 lines of TypeScript](https://github.com/yasasbanukaofficial/claude-code).

### Technology Stack

**Runtime:**
- Bun (JavaScript runtime)
- React + Ink (terminal UI framework)

**Architecture Components:**

1. **Tools System** - 40+ independent modules:
   - File I/O (read, write, edit, glob, grep)
   - Bash execution
   - LSP protocol integration (code intelligence)
   - Sub-agent generation (multi-agent coordination)
   - Git operations

2. **Query Engine** - 46,000 lines:
   - Inference logic (handles API calls to Claude)
   - Token counting (tracks usage, enforces limits)
   - Chain-of-thought loops (agentic reasoning)
   - Context window management

3. **Multi-Agent System**:
   - Coordinator (distributes tasks across agents)
   - VS Code / JetBrains bridge (IDE integration)
   - Sub-agent spawning (parallel task execution)

4. **Terminal UI**:
   - React components via Ink
   - Real-time streaming display
   - Syntax highlighting
   - Interactive prompts

### Key Insights

**40+ Tools vs. 4 Tools:** Claude Code's extensive tool library enables complex workflows (git commits, PR creation, multi-file edits, LSP queries). Our backend has 4 tools (calculator, web_search, fetch_url, custom).

**Query Engine Complexity:** 46,000 lines handle token budgeting, streaming, retries, error recovery - suggests non-trivial engineering.

**Multi-Agent Coordination:** Parallel sub-agents for independent tasks (testing, documentation, implementation) - advanced use case beyond single-threaded chat.

---

## Technology Stack

### Anthropic Infrastructure

**API Platform:**
- REST API (HTTP/2, SSE streaming)
- Workspace-level isolation (multi-tenant)
- Automatic prompt caching (TTL-based)
- Geographic redundancy (global inference)

**Model Serving:**
- Claude 4.6 Opus (200K context → 1M context in 2026)
- Claude 4.6 Sonnet (balanced performance/cost)
- Claude 4.5 Haiku (fast, cheap)

**Storage:**
- PDF/image processing infrastructure
- Batch result storage (JSONL)

### Official SDKs

**Languages:**
- TypeScript: [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)
- Python: [anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python)
- C#: [anthropic-sdk-csharp](https://github.com/anthropics/anthropic-sdk-csharp)
- Java: [anthropic-sdk-java](https://github.com/anthropics/anthropic-sdk-java)

**Common Features:**
- Streaming support (SSE)
- Tool use helpers (Zod, Pydantic)
- Retry logic with exponential backoff
- Automatic request signing

---

## Key Takeaways

### 1. **Content Blocks Are Foundational**
Discriminated unions enable extensibility (thinking, tool use, images, PDFs) without API versioning hell.

### 2. **Streaming Is Not Optional**
Modern AI UX requires real-time feedback. High-level SDK helpers (MessageStream) simplify implementation.

### 3. **Tools Enable Agentic Workflows**
Parallel execution + structured schemas + automatic loops = powerful agent capabilities.

### 4. **Caching Cuts Costs 90%**
Prompt caching is automatic, workspace-isolated, and trivial to enable with `cache_control` blocks.

### 5. **Extended Thinking Improves Quality**
Complex reasoning tasks benefit from explicit thinking token budgets.

### 6. **Multi-Modal Is Standard**
Images and PDFs are first-class content types, not afterthoughts.

### 7. **Helper Abstractions Matter**
High-level helpers (toolRunner, streaming.on('text')) reduce boilerplate while preserving low-level access.

### 8. **Schema Validation Is Everywhere**
Zod/Pydantic integration ensures type safety from tool definitions → structured outputs.

---

## References

- [Anthropic Messages API](https://platform.anthropic.com/docs/api-reference/messages)
- [Tool Use Documentation](https://platform.anthropic.com/docs/tool-use)
- [Streaming Guide](https://docs.anthropic.com/en/api/messages-streaming)
- [TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [TypeScript SDK Helpers](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md)
- [Claude Code Leak Discussion](https://github.com/yasasbanukaofficial/claude-code)
- [Prompt Caching Docs](https://platform.anthropic.com/docs/prompt-caching)
- [Extended Thinking Docs](https://platform.anthropic.com/docs/extended-thinking)

---

**Next:** [Technical Design Document](./claude-technical-design.md) - Detailed implementation specifications for ai-sandbox backend
