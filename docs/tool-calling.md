# Tool Calling Architecture for AI Sandbox

## Table of Contents

1. [Overview](#overview)
2. [What is Tool Calling?](#what-is-tool-calling)
3. [Current Architecture & Gaps](#current-architecture--gaps)
4. [Proposed Architecture](#proposed-architecture)
5. [Tool Definitions](#tool-definitions)
6. [Tool Registry Design](#tool-registry-design)
7. [Execution Loop (Agentic Loop)](#execution-loop-agentic-loop)
8. [Database Schema Changes](#database-schema-changes)
9. [SSE Protocol Changes](#sse-protocol-changes)
10. [AI Service Layer Changes](#ai-service-layer-changes)
11. [Standard Tools to Implement](#standard-tools-to-implement)
12. [Security Considerations](#security-considerations)
13. [Implementation Phases](#implementation-phases)

---

## Overview

This document describes how to add tool calling (function calling) to the AI Sandbox app. Tool calling allows the AI to request actions during a conversation — such as searching the web, running code, or querying a database — rather than only generating text from its training data.

**Goal:** Transform the app from a simple text-in/text-out chat into an agentic system where the AI can interact with external systems, process real data, and take actions on behalf of the user.

---

## What is Tool Calling?

In a standard chat flow, the user sends a message and the AI responds with text. With tool calling, the AI can pause its response and request that the backend execute a function, then continue generating its answer using the function's result.

### Without Tool Calling (Current)

```
User: "What's 847 * 293?"
AI: "847 * 293 = 248,171" (may hallucinate the answer)
```

### With Tool Calling (Proposed)

```
User: "What's 847 * 293?"
AI: → calls calculator({ expression: "847 * 293" })
Backend: → executes, returns 248171
AI: "847 * 293 = 248,171" (verified answer)
```

The key difference: the AI *decides* when to use a tool, the backend *executes* the tool, and the AI *incorporates* the result. This is a multi-turn loop, not a single request-response.

---

## Current Architecture & Gaps

### Current Flow (`messageController.ts`)

```
User Message → Save to DB → Build Context (flat string) → Single textCompletion() call → Stream response → Save to DB
```

### Key Gaps

| Area | Current State | Required for Tool Calling |
|------|--------------|--------------------------|
| **AI Service interface** | `textCompletion(prompt: string)` — accepts a flat string, returns text | Must accept structured messages with tool definitions and return tool call objects |
| **Message format** | Flat string context: `"user: ...\nassistant: ..."` | Structured message array with `role`, `content`, `tool_calls`, `tool_results` |
| **Execution model** | Single AI call per user message | Agentic loop: AI call → tool execution → AI call → ... until done |
| **Message roles** | `user`, `assistant`, `system` used | `tool` role exists in schema but is never used |
| **Content blocks** | `ContentBlock` type has `tool_use` and `tool_result` defined but unused | Must be fully wired up |
| **SSE events** | `message_created`, `delta`, `done`, `error` | Need `tool_use_start`, `tool_use_result` events |
| **Tool registry** | Does not exist | Need a registry of available tools with schemas |

### What's Already in Place

- `MessageRole` enum in Prisma schema already includes `tool`
- `ContentBlock` type already defines `tool_use` and `tool_result` shapes
- `content` column is JSONB, so it can store any structured content blocks
- SSE infrastructure is working and extensible

---

## Proposed Architecture

### High-Level Flow

```
User sends message
    │
    ▼
Save user message to DB
    │
    ▼
Build structured message array (not flat string)
    │
    ▼
┌─────────────────────────────────┐
│         AGENTIC LOOP            │
│                                 │
│  Send messages + tools to AI    │
│         │                       │
│         ▼                       │
│  AI responds with:              │
│    ├─ text only → DONE          │
│    └─ tool_calls[] → CONTINUE   │
│         │                       │
│         ▼                       │
│  Execute each tool call         │
│         │                       │
│         ▼                       │
│  Append tool results to msgs    │
│         │                       │
│         ▼                       │
│  Loop back to AI ───────────┘   │
└─────────────────────────────────┘
    │
    ▼
Save final assistant message to DB
Stream complete
```

### Component Overview

```
messageController.ts
    │
    ├── contextService.ts        (build structured message array)
    ├── toolRegistry.ts          (register & validate tools)
    ├── toolExecutor.ts          (execute tool calls safely)
    └── aiService (updated)      (accepts messages + tools, returns tool_calls or text)
         │
         ├── tools/
         │   ├── webSearch.ts
         │   ├── calculator.ts
         │   ├── urlFetch.ts
         │   ├── codeExecution.ts
         │   ├── dateTime.ts
         │   └── ... (pluggable)
```

---

## Tool Definitions

Each tool is defined using a JSON Schema that describes its name, purpose, and parameters. This schema is sent to the AI provider alongside the conversation messages.

### Tool Definition Format

```typescript
interface ToolDefinition {
  name: string;                    // unique identifier: "web_search"
  description: string;             // what the tool does (AI reads this to decide when to use it)
  parameters: JSONSchema;          // input schema
  requiresConfirmation?: boolean;  // if true, ask user before executing
  timeoutMs?: number;              // max execution time (default: 30000)
  enabled?: boolean;               // can be toggled per thread
}
```

### Example: Web Search Tool

```typescript
{
  name: "web_search",
  description: "Search the web for current information. Use this when the user asks about recent events, real-time data, or anything that may have changed after your training cutoff.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query"
      },
      num_results: {
        type: "number",
        description: "Number of results to return (1-10)",
        default: 5
      }
    },
    required: ["query"]
  },
  timeoutMs: 10000
}
```

### How AI Providers Receive Tools

Each provider formats tool definitions differently:

**OpenAI:**
```json
{
  "tools": [{
    "type": "function",
    "function": {
      "name": "web_search",
      "description": "...",
      "parameters": { ... }
    }
  }]
}
```

**Anthropic (Claude):**
```json
{
  "tools": [{
    "name": "web_search",
    "description": "...",
    "input_schema": { ... }
  }]
}
```

**Google (Gemini):**
```json
{
  "tools": [{
    "functionDeclarations": [{
      "name": "web_search",
      "description": "...",
      "parameters": { ... }
    }]
  }]
}
```

The AI service layer should abstract this so tool definitions are provider-agnostic.

---

## Tool Registry Design

### `toolRegistry.ts`

```typescript
interface RegisteredTool {
  definition: ToolDefinition;
  handler: (input: unknown) => Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  output: string;        // text result the AI will see
  metadata?: unknown;    // extra data (not sent to AI, stored in DB)
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  // Register a tool
  register(definition: ToolDefinition, handler: Function): void;

  // Get all tool definitions (to send to AI)
  getDefinitions(): ToolDefinition[];

  // Get definitions filtered by thread settings
  getDefinitionsForThread(threadId: string): ToolDefinition[];

  // Execute a tool by name
  execute(name: string, input: unknown): Promise<ToolResult>;

  // Check if a tool exists
  has(name: string): boolean;
}
```

### Registration Pattern

```typescript
// tools/webSearch.ts
import { ToolDefinition, ToolResult } from '../types';

export const definition: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for current information.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' }
    },
    required: ['query']
  }
};

export async function handler(input: { query: string }): Promise<ToolResult> {
  // Call a search API (e.g., Tavily, Serper, Brave Search)
  const results = await searchAPI(input.query);
  return {
    success: true,
    output: results.map(r => `${r.title}\n${r.snippet}\n${r.url}`).join('\n\n')
  };
}
```

```typescript
// toolRegistry setup (e.g., in server.ts)
import { toolRegistry } from './services/toolRegistry';
import * as webSearch from './tools/webSearch';
import * as calculator from './tools/calculator';

toolRegistry.register(webSearch.definition, webSearch.handler);
toolRegistry.register(calculator.definition, calculator.handler);
```

---

## Execution Loop (Agentic Loop)

This is the core change — replacing the single `textCompletion()` call with a loop that handles tool calls.

### `toolExecutor.ts`

```typescript
interface AgenticLoopOptions {
  threadId: string;
  messages: StructuredMessage[];
  tools: ToolDefinition[];
  aiService: AIService;
  maxIterations: number;         // safety limit (default: 10)
  onDelta: (text: string) => void;           // stream text chunks
  onToolUseStart: (call: ToolCall) => void;  // notify frontend
  onToolUseResult: (result: ToolCallResult) => void;
}

async function runAgenticLoop(options: AgenticLoopOptions): Promise<{
  finalText: string;
  toolCalls: ToolCallRecord[];
}> {
  const { messages, tools, aiService, maxIterations, onDelta, onToolUseStart, onToolUseResult } = options;

  let iterations = 0;
  let finalText = '';
  const allToolCalls: ToolCallRecord[] = [];

  while (iterations < maxIterations) {
    iterations++;

    // 1. Call AI with messages + tool definitions
    const response = await aiService.chatCompletion({
      messages,
      tools,
      stream: true,
      onDelta
    });

    // 2. If AI responded with text only (no tool calls) → done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      finalText = response.text;
      break;
    }

    // 3. AI requested tool calls → execute each one
    // Append assistant message with tool_use blocks
    messages.push({
      role: 'assistant',
      content: response.toolCalls.map(tc => ({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.arguments
      }))
    });

    for (const toolCall of response.toolCalls) {
      onToolUseStart(toolCall);

      const result = await toolRegistry.execute(toolCall.name, toolCall.arguments);

      allToolCalls.push({ ...toolCall, result });
      onToolUseResult({ toolCallId: toolCall.id, result });

      // 4. Append tool result to messages
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result.output
        }]
      });
    }

    // 5. Loop back → AI sees tool results and continues
  }

  if (iterations >= maxIterations) {
    finalText += '\n\n[Stopped: maximum tool call iterations reached]';
  }

  return { finalText, toolCalls: allToolCalls };
}
```

### Why a Max Iteration Limit?

Without a limit, a misbehaving AI could loop indefinitely — calling tools that return errors, triggering more tool calls, etc. A default limit of 10 iterations is standard. Most real conversations use 1-3 tool calls.

---

## Database Schema Changes

### New Model: `ToolCall`

```prisma
model ToolCall {
  id            String   @id @default(uuid())
  messageId     String   @map("message_id")
  name          String                        // tool name: "web_search"
  arguments     Json                          // input passed to the tool
  result        Json?                         // output from the tool
  status        ToolCallStatus @default(pending)
  durationMs    Int?     @map("duration_ms")  // execution time
  createdAt     DateTime @default(now()) @map("created_at")
  message       Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([messageId])
  @@map("tool_calls")
}

enum ToolCallStatus {
  pending
  running
  success
  error
}
```

### Updated Message Model

```prisma
model Message {
  // ... existing fields ...
  toolCalls     ToolCall[]    // add relation
}
```

### Why a Separate Table?

- A single assistant message can trigger multiple tool calls
- Each tool call has its own status, timing, and result
- Enables analytics: which tools are used most, average latency, error rates
- Keeps the `messages` table clean — `content` stores what the AI said, `tool_calls` stores what it did

---

## SSE Protocol Changes

### New Event Types

Add these to the existing SSE stream:

```
# AI decides to call a tool
data: {"type":"tool_use_start","tool_call_id":"tc_123","name":"web_search","arguments":{"query":"latest news"}}

# Tool execution completes
data: {"type":"tool_use_result","tool_call_id":"tc_123","name":"web_search","success":true,"output":"..."}

# AI continues generating text after seeing tool results
data: {"type":"delta","text":"Based on my search, ...","msg_id":"msg_456"}

# Final done event (unchanged)
data: {"type":"done","msg_id":"msg_456","stop_reason":"end_turn","tool_calls_count":1}
```

### Updated Event Flow (Example)

```
1. data: {"type":"message_created","user_msg_id":"u1","assistant_msg_id":"a1"}
2. data: {"type":"delta","text":"Let me search for that...","msg_id":"a1"}
3. data: {"type":"tool_use_start","tool_call_id":"tc1","name":"web_search","arguments":{"query":"..."}}
4. data: {"type":"tool_use_result","tool_call_id":"tc1","name":"web_search","success":true,"output":"..."}
5. data: {"type":"delta","text":"According to the results, ...","msg_id":"a1"}
6. data: {"type":"done","msg_id":"a1","stop_reason":"end_turn","tool_calls_count":1}
```

### Frontend Handling

The frontend should:
- Show a "Searching..." or "Running calculator..." indicator during `tool_use_start`
- Optionally display tool results in a collapsible section
- Continue rendering streamed text after tool results arrive

---

## AI Service Layer Changes

### Updated Base Class

The current `AIService` base class only has `textCompletion(prompt: string)`. It needs a new method that supports structured messages and tool definitions.

```typescript
// services/ai_services.ts (new TypeScript version)

interface ChatCompletionOptions {
  messages: StructuredMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
  onDelta?: (text: string) => void;
}

interface ChatCompletionResult {
  text: string;
  toolCalls?: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  inputTokens?: number;
  outputTokens?: number;
}

interface StructuredMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
}

abstract class AIService {
  // Legacy method (keep for backward compatibility)
  abstract textCompletion(prompt: string): Promise<string>;

  // New method for tool calling
  abstract chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
}
```

### OpenAI Implementation

```typescript
class OpenAIService extends AIService {
  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: this.formatMessages(options.messages),
      tools: options.tools?.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      })),
      stream: options.stream
    });

    // Handle streaming...
    // Handle tool_calls in response.choices[0].message.tool_calls...
  }
}
```

### Google Gemini Implementation

```typescript
class GoogleAIService extends AIService {
  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-pro',
      tools: [{
        functionDeclarations: options.tools?.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }))
      }]
    });

    const result = await model.generateContent({
      contents: this.formatMessages(options.messages)
    });

    // Handle functionCall in response.candidates[0].content.parts...
  }
}
```

### Provider Differences to Handle

| Behavior | OpenAI | Anthropic | Google |
|----------|--------|-----------|--------|
| Tool call format | `tool_calls[]` on message | `tool_use` content blocks | `functionCall` in parts |
| Tool result format | `role: "tool"` message | `tool_result` content block | `functionResponse` in parts |
| Parallel tool calls | Supported (multiple in one response) | Supported | Single per turn |
| Streaming + tools | Supported | Supported | Limited |

The AI service layer must normalize these differences so `messageController` and the agentic loop work identically regardless of provider.

---

## Standard Tools to Implement

### Phase 1: Core Tools

#### 1. Calculator

```typescript
// Purpose: Accurate arithmetic (LLMs hallucinate math)
// Complexity: Low
// Dependencies: None (use mathjs or built-in eval with sandboxing)

{
  name: "calculator",
  description: "Evaluate a mathematical expression. Use for any arithmetic, unit conversions, or numeric calculations.",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression, e.g. '(45 * 23) + 17'" }
    },
    required: ["expression"]
  }
}
```

#### 2. Get Date/Time

```typescript
// Purpose: LLMs don't know the current date or time
// Complexity: Low
// Dependencies: None

{
  name: "get_datetime",
  description: "Get the current date and time. Use when the user asks about today's date, current time, or day of the week.",
  parameters: {
    type: "object",
    properties: {
      timezone: { type: "string", description: "IANA timezone, e.g. 'America/New_York'", default: "UTC" }
    }
  }
}
```

#### 3. URL Fetch

```typescript
// Purpose: Read content from a URL the user provides
// Complexity: Medium
// Dependencies: axios/fetch, html-to-text or cheerio for parsing

{
  name: "fetch_url",
  description: "Fetch and extract the text content from a web page URL. Use when the user shares a link and asks about its content.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
      max_length: { type: "number", description: "Max characters to return", default: 5000 }
    },
    required: ["url"]
  }
}
```

### Phase 2: High-Value Tools

#### 4. Web Search

```typescript
// Purpose: Real-time information access
// Complexity: Medium
// Dependencies: Tavily, Serper, or Brave Search API key

{
  name: "web_search",
  description: "Search the web for current information. Use for recent events, real-time data, or facts that may have changed.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
      num_results: { type: "number", default: 5, description: "Number of results (1-10)" }
    },
    required: ["query"]
  }
}
```

#### 5. Code Execution (Sandboxed)

```typescript
// Purpose: Run code and return output
// Complexity: High
// Dependencies: Sandboxed runtime (Docker container, isolated-vm, or external API like Judge0)

{
  name: "run_code",
  description: "Execute code in a sandboxed environment and return the output. Supports Python and JavaScript.",
  parameters: {
    type: "object",
    properties: {
      language: { type: "string", enum: ["python", "javascript"] },
      code: { type: "string", description: "The code to execute" }
    },
    required: ["language", "code"]
  },
  timeoutMs: 30000
}
```

### Phase 3: Domain-Specific Tools

#### 6. Knowledge Base / RAG

```typescript
// Purpose: Search user's own documents
// Dependencies: Vector database (pgvector, Pinecone, etc.)

{
  name: "search_knowledge",
  description: "Search the user's uploaded documents and knowledge base for relevant information.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      collection: { type: "string", description: "Which knowledge base to search" }
    },
    required: ["query"]
  }
}
```

#### 7. Image Generation

```typescript
// Purpose: Create images from text descriptions
// Dependencies: OpenAI DALL-E API or Stability AI

{
  name: "generate_image",
  description: "Generate an image from a text description.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Detailed description of the image to generate" },
      size: { type: "string", enum: ["256x256", "512x512", "1024x1024"], default: "512x512" }
    },
    required: ["prompt"]
  }
}
```

#### 8. Database Query

```typescript
// Purpose: Query application data via natural language
// Dependencies: Read-only DB connection, SQL sanitization

{
  name: "query_database",
  description: "Execute a read-only SQL query against the application database.",
  parameters: {
    type: "object",
    properties: {
      sql: { type: "string", description: "A SELECT query (read-only)" },
      explain: { type: "boolean", description: "If true, return query plan instead of results" }
    },
    required: ["sql"]
  },
  requiresConfirmation: true
}
```

---

## Security Considerations

### Input Validation

```typescript
// Every tool handler MUST validate its input before execution
async function handler(input: unknown): Promise<ToolResult> {
  // 1. Validate against JSON Schema
  const validated = validateSchema(definition.parameters, input);
  if (!validated.valid) {
    return { success: false, output: `Invalid input: ${validated.errors}` };
  }

  // 2. Sanitize (tool-specific)
  // 3. Execute with timeout
  // 4. Truncate output if too large
}
```

### Critical Rules

| Risk | Mitigation |
|------|------------|
| **Prompt injection via tool results** | Sanitize tool output before sending back to AI. Never include raw HTML or executable content. |
| **Infinite loops** | Hard limit on agentic loop iterations (max 10). Timeout per tool call (30s default). |
| **Code execution escape** | Run code in isolated Docker containers or use a sandboxed runtime. Never execute on the host. |
| **SQL injection** | Read-only database connection. Whitelist allowed tables. Parse and validate SQL AST before execution. |
| **SSRF via URL fetch** | Block private IP ranges (10.x, 172.16.x, 192.168.x, 127.x). Allowlist protocols (http/https only). |
| **Excessive API costs** | Rate limit tool calls per thread (e.g., max 20 tool calls per message). Track costs per tool. |
| **Sensitive data exposure** | Never include API keys, secrets, or internal errors in tool results sent to the AI. |
| **Destructive actions** | Tools that modify state (send email, write file, DB mutations) must set `requiresConfirmation: true`. |

### Tool Output Limits

```typescript
const MAX_TOOL_OUTPUT_LENGTH = 10_000; // characters

function truncateOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT_LENGTH) return output;
  return output.substring(0, MAX_TOOL_OUTPUT_LENGTH) + '\n\n[Output truncated]';
}
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal:** Tool calling infrastructure with 2 simple tools working end-to-end.

- [ ] Create `ToolDefinition`, `ToolResult`, and `ToolCall` TypeScript interfaces
- [ ] Implement `ToolRegistry` (register, list, execute)
- [ ] Add `chatCompletion()` method to `AIService` base class
- [ ] Implement `chatCompletion()` for OpenAI (primary provider)
- [ ] Build the agentic loop in `toolExecutor.ts`
- [ ] Update `messageController.ts` to use the agentic loop
- [ ] Add `tool_use_start` and `tool_use_result` SSE events
- [ ] Create Prisma migration for `ToolCall` model
- [ ] Implement `calculator` tool
- [ ] Implement `get_datetime` tool
- [ ] Test end-to-end: user asks a math question, AI calls calculator, returns correct answer

### Phase 2: Core Tools (Week 3-4)

**Goal:** Add the tools that provide the most user value.

- [ ] Implement `fetch_url` tool (with SSRF protection)
- [ ] Implement `web_search` tool (integrate Tavily or Serper API)
- [ ] Implement `chatCompletion()` for Google Gemini
- [ ] Update `contextService` to build structured message arrays instead of flat strings
- [ ] Update frontend to show tool call indicators (loading state, collapsible results)
- [ ] Add per-tool timeout handling
- [ ] Add tool call rate limiting

### Phase 3: Advanced Tools (Week 5-8)

**Goal:** High-complexity tools and polish.

- [ ] Implement `run_code` tool (sandboxed execution via Docker)
- [ ] Implement `generate_image` tool (DALL-E integration)
- [ ] Implement `search_knowledge` tool (RAG with pgvector)
- [ ] Add `requiresConfirmation` flow (frontend confirmation dialog)
- [ ] Add tool usage analytics (which tools, how often, latency)
- [ ] Implement `chatCompletion()` for remaining providers (DeepSeek, Llama)
- [ ] Add per-thread tool configuration (enable/disable specific tools)

### Phase 4: Production Hardening

- [ ] Redis-backed tool result caching
- [ ] Structured logging for tool calls (for debugging and audit)
- [ ] Cost tracking per tool call
- [ ] Admin UI for tool management
- [ ] User-defined custom tools (via API)

---

## File Structure (Post-Implementation)

```
backend/src/
├── controllers/
│   └── messageController.ts      # updated with agentic loop
├── services/
│   ├── contextService.ts         # updated: structured messages
│   ├── toolRegistry.ts           # NEW: tool registration & lookup
│   └── toolExecutor.ts           # NEW: agentic loop runner
├── tools/
│   ├── index.ts                  # registers all tools
│   ├── calculator.ts             # math evaluation
│   ├── dateTime.ts               # current date/time
│   ├── fetchUrl.ts               # URL content extraction
│   ├── webSearch.ts              # web search API
│   ├── codeExecution.ts          # sandboxed code runner
│   ├── imageGeneration.ts        # DALL-E / Stability
│   ├── knowledgeSearch.ts        # RAG / vector search
│   └── databaseQuery.ts          # read-only SQL
├── types/
│   └── index.ts                  # updated with tool types
└── ai/
    ├── base.ts                   # updated AIService abstract class
    ├── openai.ts                 # OpenAI chatCompletion
    ├── google.ts                 # Gemini chatCompletion
    ├── deepseek.ts               # DeepSeek chatCompletion
    └── ollama.ts                 # Llama chatCompletion
```
