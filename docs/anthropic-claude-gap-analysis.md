# Anthropic Claude API - Feature Gap Analysis

**Date:** 2026-04-13  
**Branch:** research/anthropic-claude-features  
**Current Implementation:** ai-sandbox backend (Express + TypeScript)

---

## Executive Summary

The current ai-sandbox backend implements core Anthropic-style patterns (discriminated union content blocks, tool use, agentic loop with parallel execution) but lacks several advanced Claude API features that would improve cost efficiency, reasoning quality, and capabilities.

**High-Priority Gaps:**
- Prompt Caching (90% cost savings on repeated context)
- Extended Thinking (improved complex reasoning)
- Streaming (real-time response generation)
- Vision/PDF Analysis (multi-modal support)

**Medium-Priority Gaps:**
- Batch API (50% cost reduction for async workloads)
- Strict Tool Use (guaranteed schema conformance)
- Output Configuration (structured JSON outputs)

**Low-Priority Gaps:**
- Computer Use Tool (server-side automation - edge use case)
- Artifacts (UI feature, not API-level)

---

## Current Implementation Status

### ✅ Implemented Features

| Feature | Current Implementation | File(s) |
|---------|----------------------|---------|
| **Tool Use (Function Calling)** | Anthropic-style `ToolDefinition` with `input_schema`, tool registry, parallel execution | `backend/src/services/toolRegistry.ts`<br>`backend/src/services/toolExecutor.ts` |
| **Agentic Loop** | Up to 10 iterations with tool execution feedback | `backend/src/services/toolExecutor.ts:34-115` |
| **Parallel Tool Execution** | `Promise.all()` on tool calls per Anthropic pattern | `backend/src/services/toolExecutor.ts:75-96` |
| **Content Blocks** | Discriminated unions (`text`, `tool_use`, `tool_result`) | `backend/src/types/content.ts` |
| **Message Format** | Anthropic-compatible `MessageParam` with role/content | `backend/src/types/messages.ts:21-25` |
| **Tool Registry** | 4 tools: `calculator`, `web_search`, `fetch_url`, custom tools | `backend/src/tools/index.ts` |
| **Multiple Providers** | OpenAI, Google Gemini, DeepSeek, Llama via factory | `backend/services/ai_factory.js` |
| **Context Management** | In-memory cache with 10-min TTL, token budget | `backend/src/services/contextService.ts` |

### ❌ Missing Claude Features

---

## 1. Prompt Caching

**Status:** ❌ Not Implemented  
**Priority:** 🔴 High (90% cost savings on repeated context)

### What It Is
Automatic caching of prompt prefixes (system prompts, tool definitions, long context) with workspace-level isolation. Cache hits within 5 minutes (default) or up to 1 hour (with `cache_control` blocks) provide 90% cost reduction on cached tokens.

### How Claude Does It
```json
{
  "model": "claude-4.6-opus",
  "system": [
    {
      "type": "text",
      "text": "You are an expert developer...",
      "cache_control": {"type": "ephemeral"}
    }
  ],
  "messages": [...]
}
```

**Billing:**
- Cached input tokens: 90% discount
- Cache writes: 25% markup (first use)
- Automatic for system prompts, tool definitions, messages with `cache_control`
- Workspace-level isolation (no cross-user leakage)

### Current Gap
- No cache-aware request building
- No `cache_control` blocks in message construction
- OpenAI/Gemini providers don't support prompt caching (feature is Claude-specific)
- Context service rebuilds full conversation history on every request

### Implementation Effort
- **Low-Medium:** Add `cache_control` blocks to system prompts and tool definitions in Claude provider
- **Medium:** Modify context service to mark long-lived context for caching
- **High:** Implement cross-request cache awareness to respect 5-min/1-hour TTLs

---

## 2. Extended Thinking

**Status:** ❌ Not Implemented  
**Priority:** 🔴 High (improves complex reasoning quality)

### What It Is
Internal reasoning token budget (minimum 1,024 tokens, configurable up to model limit) where Claude "thinks" before responding. Improves quality on complex tasks (coding, math, logic).

**Types:**
- `thinking.enabled: true` - automatic budget
- `thinking.type: "enabled"` with `thinking.budget_tokens: 5000` - custom budget

### How Claude Does It
```json
{
  "model": "claude-4.6-opus",
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  },
  "messages": [...]
}
```

**Response includes thinking content:**
```json
{
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me reason through this step by step..."
    },
    {
      "type": "text",
      "text": "The answer is..."
    }
  ]
}
```

### Current Gap
- No `thinking` parameter in provider interfaces
- OpenAI/Gemini don't have equivalent feature
- Type system doesn't include `thinking` content blocks
- UI doesn't display thinking content separately

### Implementation Effort
- **Low:** Add `thinking` parameter to `ChatCompletionOptions` and Claude provider
- **Low:** Add `thinking` content block type to type system
- **Medium:** Update frontend to display thinking content (collapsible/expandable UI)

---

## 3. Streaming

**Status:** ⚠️ Partial (SSE implemented, but no provider streaming)  
**Priority:** 🔴 High (real-time UX)

### What It Is
Server-sent events (SSE) streaming for real-time token-by-token response generation. Reduces perceived latency and enables live tool use feedback.

**Event types:**
- `message_start` - conversation metadata
- `content_block_start` - new content block (text/tool_use)
- `content_block_delta` - incremental text/input_json
- `content_block_stop` - block complete
- `message_delta` - stop_reason update
- `message_stop` - response complete

### How Claude Does It
```typescript
const stream = await anthropic.messages.stream({
  model: "claude-4.6-opus",
  messages: [...]
});

for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    console.log(event.delta.text);
  }
}
```

### Current Gap
- **Backend:** SSE endpoint exists (`/api/v1/threads/:id/messages POST`) but does NOT stream from providers
- **Current flow:** Wait for full `provider.chatCompletion()` response → send all at once via SSE
- **No streaming from:** OpenAI SDK, Gemini SDK, DeepSeek, Llama
- **Agentic loop:** Executes synchronously, no intermediate streaming

### Implementation Effort
- **Medium:** Add streaming support to provider interfaces (`chatCompletionStream()` method)
- **Medium:** Implement streaming in OpenAI/Claude providers using their SDK stream APIs
- **High:** Refactor agentic loop to stream partial responses between tool iterations
- **Low:** Frontend already handles SSE delta events correctly

---

## 4. Vision & PDF Analysis

**Status:** ❌ Not Implemented  
**Priority:** 🔴 High (multi-modal support)

### What It Is
Multi-modal content support: images (PNG, JPEG, GIF, WebP), PDFs (up to 100 pages), and documents in message content.

**Supported formats:**
- Images: `image/png`, `image/jpeg`, `image/gif`, `image/webp`
- Documents: `application/pdf`
- Input methods: Base64, HTTP(S) URLs

### How Claude Does It
```json
{
  "model": "claude-4.6-opus",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "Analyze this diagram"},
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "iVBORw0KGgo..."
          }
        }
      ]
    }
  ]
}
```

**PDF support:**
```json
{
  "type": "document",
  "source": {
    "type": "base64",
    "media_type": "application/pdf",
    "data": "JVBERi0xLjQK..."
  }
}
```

### Current Gap
- **Type system:** No `image` or `document` content block types
- **Providers:** OpenAI has `imageAnalysis()` method but not integrated into chat flow
- **Message handling:** Cannot attach images/PDFs to thread messages
- **Database:** JSONB content blocks don't store base64 data (would hit size limits)
- **Frontend:** No UI for uploading images/PDFs to messages

### Implementation Effort
- **Low:** Add `image` and `document` content block types to type system
- **Medium:** Extend message API to accept multipart/form-data uploads
- **Medium:** Store images/PDFs in S3/blob storage, reference by URL in content blocks
- **High:** Integrate vision into agentic loop (tools can reference image content)
- **High:** Frontend file upload UI with preview

---

## 5. Batch API

**Status:** ❌ Not Implemented  
**Priority:** 🟡 Medium (50% cost reduction for async workloads)

### What It Is
Asynchronous batch processing with 50% cost reduction. Submit up to 10,000 requests, get results within 24 hours. Ideal for evals, data labeling, content moderation.

**Workflow:**
1. Create batch with JSONL file of requests
2. Poll batch status (validating → in_progress → ended)
3. Download results JSONL when complete

### How Claude Does It
```bash
# Create batch
curl https://api.anthropic.com/v1/messages/batches \
  -H "anthropic-version: 2025-02-15" \
  -d '{
    "requests": [
      {
        "custom_id": "req-1",
        "params": {
          "model": "claude-4.6-opus",
          "messages": [...]
        }
      }
    ]
  }'

# Poll status
curl https://api.anthropic.com/v1/messages/batches/{batch_id}

# Download results
curl https://api.anthropic.com/v1/messages/batches/{batch_id}/results
```

### Current Gap
- No batch submission endpoint
- No async processing infrastructure (job queue)
- No batch status tracking
- No JSONL import/export

### Implementation Effort
- **High:** Add job queue (BullMQ/Celery) for async processing
- **Medium:** Create batch submission endpoint (`/api/v1/batches POST`)
- **Medium:** Implement batch status tracking with polling endpoint
- **Low:** JSONL parser for batch input/output format

---

## 6. Strict Tool Use

**Status:** ❌ Not Implemented  
**Priority:** 🟡 Medium (guaranteed schema conformance)

### What It Is
Guaranteed schema conformance for tool inputs using `strict: true`. Claude validates tool arguments match JSON schema exactly before returning tool_use blocks.

**Benefits:**
- No runtime validation errors from malformed tool inputs
- Safe to skip client-side schema validation
- Reduces error handling code

### How Claude Does It
```json
{
  "tools": [
    {
      "name": "calculate",
      "strict": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "expression": {"type": "string"}
        },
        "required": ["expression"]
      }
    }
  ]
}
```

### Current Gap
- No `strict` field in `ToolDefinition` type
- No schema validation on tool inputs before execution
- Current tool executor assumes well-formed inputs from provider

### Implementation Effort
- **Low:** Add `strict?: boolean` to `ToolDefinition` type
- **Low:** Pass `strict` flag to Claude provider tool definitions
- **Medium:** Add runtime validation fallback for providers without strict mode (OpenAI/Gemini)

---

## 7. Tool Choice Control

**Status:** ⚠️ Partial (OpenAI supports `tool_choice`, not exposed in API)  
**Priority:** 🟡 Medium (workflow control)

### What It Is
Control when/which tools the model uses:
- `auto` (default) - model decides
- `any` - must use at least one tool
- `none` - no tools allowed
- `{type: "tool", name: "calculator"}` - force specific tool

### How Claude Does It
```json
{
  "tools": [...],
  "tool_choice": {
    "type": "tool",
    "name": "web_search"
  }
}
```

### Current Gap
- No `tool_choice` parameter in `ChatCompletionOptions`
- OpenAI provider supports it but not exposed in API
- No endpoint to control tool behavior per request

### Implementation Effort
- **Low:** Add `tool_choice` to `ChatCompletionOptions` type
- **Low:** Pass through to OpenAI/Claude providers
- **Low:** Update message API to accept `tool_choice` parameter

---

## 8. Output Configuration

**Status:** ❌ Not Implemented  
**Priority:** 🟡 Medium (structured outputs)

### What It Is
Force model to respond with valid JSON matching a schema. Guarantees structured output for data extraction, form filling, API responses.

### How Claude Does It
```json
{
  "output": {
    "type": "json_schema",
    "json_schema": {
      "name": "user_profile",
      "schema": {
        "type": "object",
        "properties": {
          "name": {"type": "string"},
          "age": {"type": "integer"}
        },
        "required": ["name", "age"]
      }
    }
  }
}
```

### Current Gap
- No output schema validation
- No structured output support in provider interface
- Response parsing assumes plain text

### Implementation Effort
- **Low:** Add `output?: OutputConfig` to `ChatCompletionOptions`
- **Medium:** Implement JSON schema validation on responses
- **Low:** Map to OpenAI structured outputs (similar feature)

---

## 9. Computer Use Tool

**Status:** ❌ Not Implemented  
**Priority:** 🟢 Low (server-side automation, edge use case)

### What It Is
Server-side tool that controls desktop environments: click buttons, type text, take screenshots. Runs in containerized environment on Anthropic infrastructure.

**Use cases:** Web automation, UI testing, research tasks

### How Claude Does It
```json
{
  "tools": [
    {
      "type": "computer_use",
      "name": "computer",
      "display_width_px": 1920,
      "display_height_px": 1080
    }
  ]
}
```

**Tool calls:**
```json
{
  "type": "tool_use",
  "name": "computer",
  "input": {
    "action": "screenshot"
  }
}
```

### Current Gap
- No server-side containerized environment
- No desktop automation infrastructure
- Out of scope for conversational AI backend

### Implementation Effort
- **Very High:** Requires headless browser infrastructure (Playwright/Puppeteer)
- **Very High:** Sandboxed execution environment
- **Questionable ROI:** Limited use case for chat application

---

## 10. Artifacts

**Status:** ⚠️ UI Feature (not API-level)  
**Priority:** 🟢 Low (frontend enhancement)

### What It Is
Live preview and interaction with generated content (code, HTML, diagrams) in a side panel on claude.ai web interface.

**Not an API feature** - purely frontend presentation layer.

### Current Gap
- Backend API supports rich content blocks
- Frontend displays messages as text bubbles
- No interactive preview panel

### Implementation Effort
- **Medium-High:** Frontend-only feature
- **Requires:** Content renderer for code/HTML/diagrams, sandbox iframe for live preview

---

## Feature Priority Matrix

| Feature | Cost Savings | UX Impact | Complexity | Recommended Priority |
|---------|-------------|-----------|-----------|---------------------|
| Prompt Caching | 90% | Low | Medium | 🔴 High |
| Extended Thinking | N/A | High | Low | 🔴 High |
| Streaming | N/A | Very High | Medium | 🔴 High |
| Vision/PDF | N/A | High | High | 🔴 High |
| Batch API | 50% | Low | High | 🟡 Medium |
| Strict Tool Use | N/A | Medium | Low | 🟡 Medium |
| Tool Choice | N/A | Medium | Low | 🟡 Medium |
| Output Config | N/A | Medium | Medium | 🟡 Medium |
| Computer Use | N/A | Low | Very High | 🟢 Low |
| Artifacts | N/A | Medium | High | 🟢 Low |

---

## Recommended Implementation Roadmap

### Phase 1: Quick Wins (1-2 weeks)
1. **Extended Thinking** - Add `thinking` parameter to Claude provider
2. **Strict Tool Use** - Add `strict` flag to tool definitions
3. **Tool Choice Control** - Expose existing OpenAI support in API

**Impact:** Better reasoning quality, safer tool execution, workflow control

### Phase 2: Streaming & Vision (3-4 weeks)
1. **Streaming** - Refactor providers to stream responses via SSE
2. **Vision Analysis** - Add image/PDF upload to messages with S3 storage

**Impact:** Real-time UX, multi-modal support

### Phase 3: Cost Optimization (2-3 weeks)
1. **Prompt Caching** - Implement cache-aware context building for Claude
2. **Output Configuration** - Add JSON schema validation

**Impact:** 90% cost reduction on repeated context, structured outputs

### Phase 4: Advanced Features (4-6 weeks)
1. **Batch API** - Add async job queue for batch processing

**Impact:** 50% cost reduction on batch workloads

### Phase 5: Nice-to-Have (optional)
1. **Artifacts** - Frontend preview panel for code/diagrams
2. **Computer Use** - Evaluate ROI for automation use cases

---

## Next Steps

1. ✅ **Gap analysis complete** (this document)
2. 🔄 **Search Claude Code codebase** for reference implementations
3. ⏳ **Architecture overview** of proposed system design
4. ⏳ **Technical design doc** with implementation specs

---

## References

- [Anthropic Messages API Docs](https://platform.anthropic.com/docs/api-reference/messages)
- [Anthropic Tool Use Guide](https://platform.anthropic.com/docs/tool-use)
- [Prompt Caching Documentation](https://platform.anthropic.com/docs/prompt-caching)
- [Extended Thinking Documentation](https://platform.anthropic.com/docs/extended-thinking)
- Current Implementation: `backend/src/providers/`, `backend/src/services/`, `backend/src/types/`
