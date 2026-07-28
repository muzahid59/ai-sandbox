# AI Sandbox — Future Roadmap

Last updated: 2026-07-26

This document captures planned features, their rationale, technical approach, and rough sequencing. Features are grouped into phases; phases are ordered by dependency, not by priority within a phase.

---

## Current State (Baseline)

| Capability | Status |
|---|---|
| Multi-provider chat (OpenAI, Google, DeepSeek, Ollama) | Done |
| Thread / message persistence (Postgres + Prisma) | Done |
| SSE streaming | Done |
| Tool calling + agentic loop (up to 10 iterations) | Done |
| Gmail tools (read, search, summarize, draft, reply — draft-only) | Done |
| Google Calendar readonly | Done |
| Web search (SearXNG) | Done |
| Fetch URL tool | Done |
| Google OAuth 2.0 with encrypted token storage | Done |
| Hardcoded single-user auth | Done (dev placeholder) |

---

## Phase 1 — Foundation (Prerequisite for everything else)

### 1.1 Real Authentication

**What:** Replace the hardcoded dev user in `backend/src/middleware/auth.ts` with a proper JWT-based auth system.

**Why:** Every multi-user feature downstream (memory, shared threads, per-user integrations) depends on a real user identity. The hardcoded user is the single biggest blocker.

**Technical approach:**
- `POST /api/v1/auth/signup` — email + password, bcrypt hash stored in Postgres
- `POST /api/v1/auth/login` — returns short-lived access token (15 min) + long-lived refresh token (30 days, httpOnly cookie)
- `POST /api/v1/auth/refresh` — silent token rotation
- `POST /api/v1/auth/logout` — invalidate refresh token
- New Prisma model: `User` (id, email, passwordHash, createdAt)
- New Prisma model: `RefreshToken` (token, userId, expiresAt, revokedAt)
- `authMiddleware` reads Bearer token from Authorization header, verifies JWT, injects `req.user`
- Frontend: login/signup page, token storage in memory (access) + cookie (refresh), auto-refresh on 401

**Files touched:**
- `backend/src/middleware/auth.ts` — replace hardcoded logic
- `backend/src/routes/authRoutes.ts` — new file
- `backend/prisma/schema.prisma` — User + RefreshToken models
- `app/src/` — login/signup UI, token management

**Risks:** Session invalidation on password change; CSRF protection for cookie-based refresh token.

---

## Phase 2 — Memory & Personalization

### 2.1 Persistent User Memory ✅ Done

**What:** The AI can remember facts about you across threads — preferences, context, recurring tasks. Example: "My timezone is BST", "I prefer bullet-point summaries", "My manager is Sarah".

**Why:** The single biggest UX gap between a generic chat app and a personal AI assistant. Stateless chat feels like talking to a stranger every time.

**What was built:**
- `Memory` model (free-text facts, not key-value — more flexible for natural language)
- Background extraction: a secondary AI call runs after every response to detect and save durable facts — no tool call required from the main model
- Full injection: all memories prepended to every system prompt within a 2,000-token budget, ordered by recency
- Duplicate detection via Jaccard similarity (pure JS, no library) to avoid storing near-identical facts
- Memory CRUD API + Memory Manager UI
- `UserPreferences` model: custom instructions, default model, display name

**What this teaches:**
- Why tool-based memory (`save_memory` / `recall_memory`) is unreliable — the AI has to decide to call it, which is inconsistent. Background extraction is more robust.
- System prompt engineering: how injected context shapes AI behaviour without the user seeing it
- Token budgeting: you can't inject unlimited context — recency-ordered trimming is the simplest strategy

**The scaling problem — and what comes next (§2.2):**

Full injection works fine at up to ~50 memories. Beyond that, two problems emerge:

1. **Cost**: every message pays for the full memory block in input tokens, even if most memories are irrelevant to the current question. At scale, providers charge per token — this adds up.
2. **Quality**: injecting 200 memories dilutes attention. The AI may ignore older or less relevant facts.

The production solution is **semantic retrieval**: instead of injecting everything, embed the user's current message as a vector, then fetch only the top-5 most similar memories from the database. The pgvector infrastructure for this is built in §2.2 (for documents) — once it exists, upgrading memory injection is a small change: swap `findMany` for a vector similarity query.

**Prompt caching** is the other lever: providers (Anthropic, OpenAI, Google) cache the stable prefix of the system prompt at ~10% of normal token cost. A memory block that hasn't changed between messages is served from cache — so the marginal cost of large system prompts drops significantly in production.

---

### 2.2 RAG over Personal Documents

**What:** Upload PDFs, text files, or paste URLs; ask questions against them. "Summarise this contract", "What are the key dates in this document?".

**Why:** Extends the assistant from web-search-only to private knowledge. Teaches vector embeddings and retrieval augmented generation.

**Technical approach:**
- File upload endpoint: `POST /api/v1/documents` (multer, store in local disk or S3)
- Document processing pipeline:
  1. Extract text (pdf-parse for PDFs, html-to-text for URLs — already a dependency)
  2. Chunk into ~500 token segments with overlap
  3. Embed chunks via OpenAI `text-embedding-3-small` or local Ollama embedding model
  4. Store embeddings in pgvector (Postgres extension)
- New Prisma model: `Document` (id, userId, filename, mimeType, createdAt) + `DocumentChunk` (id, documentId, content, embedding vector)
- New tool: `search_documents(query)` — embeds query, cosine similarity search, returns top-K chunks
- Frontend: document library sidebar, upload button, document picker per thread

**Files touched:**
- `backend/src/tools/searchDocuments.ts` — new tool
- `backend/src/services/documentService.ts` — new service
- `backend/src/routes/documentRoutes.ts` — upload + list endpoints
- `backend/prisma/schema.prisma` — Document + DocumentChunk models
- Docker: enable pgvector extension in postgres container

---

## Phase 3 — Agentic Patterns

### 3.1 Human-in-the-Loop Approval Workflow

**What:** Instead of AI actions being fire-and-forget, high-stakes actions (sending email, creating calendar events, posting to Slack) go into a pending queue. The user reviews and approves or rejects in the UI before execution.

**Why:** The current draft-only pattern for email is safe but limited. A proper approval workflow is how enterprise platforms (Gemini, ChatGPT Enterprise) handle autonomous actions — it's the correct pattern for agentic AI.

**Technical approach:**
- New Prisma model: `PendingAction` (id, threadId, userId, tool, arguments, status: pending/approved/rejected, resolvedAt)
- Modified tool execution: tools flagged as `requiresApproval: true` create a `PendingAction` record and pause the agentic loop
- SSE event: `{"type": "action_pending", "action_id": "...", "tool": "send_email", "arguments": {...}}`
- Frontend: approval card rendered in the chat UI showing what the AI wants to do, with Approve / Reject buttons
- `POST /api/v1/actions/:id/approve` and `/reject` endpoints
- On approval: resume agentic loop with the action result injected
- Tools to flag: `send_email` (when added), `create_calendar_event`, any destructive action

**Files touched:**
- `backend/src/services/toolExecutor.ts` — pause/resume logic
- `backend/src/routes/actionRoutes.ts` — new file
- `backend/prisma/schema.prisma` — PendingAction model
- `app/src/components/ActionApproval/` — new UI component

---

### 3.2 Scheduled / Recurring Tasks

**What:** Users can set up recurring automations — "every Monday at 9am, summarise my unread emails and post a digest to Slack", "daily at 5pm, check my calendar for tomorrow and remind me of prep work".

**Why:** Transforms the assistant from reactive (you ask, it answers) to proactive (it acts on a schedule). Key enterprise use case.

**Technical approach:**
- Job runner: pg-boss (Postgres-backed queue, no Redis needed — fits the existing stack)
- New Prisma model: `ScheduledTask` (id, userId, cronExpression, prompt, threadId?, lastRunAt, nextRunAt, enabled)
- Task execution: pg-boss fires a job → backend creates a new message in the thread → runs the agentic loop → results appear in thread
- Frontend: task manager UI (create, enable/disable, view run history)
- `POST /api/v1/tasks` — create scheduled task
- `GET /api/v1/tasks` — list user's tasks
- `PATCH /api/v1/tasks/:id` — update / toggle enabled

**Files touched:**
- `backend/src/services/schedulerService.ts` — new service wrapping pg-boss
- `backend/src/routes/taskRoutes.ts` — new file
- `backend/prisma/schema.prisma` — ScheduledTask model
- `app/src/components/TaskManager/` — new UI

---

### 3.3 Multi-Agent Orchestration

**What:** An orchestrator agent that decomposes complex requests and delegates to specialised sub-agents. Example: "Plan my week" → orchestrator calls calendar agent (reads schedule) + email agent (reads unread) + memory agent (recalls preferences) → synthesises a plan.

**Why:** Mirrors how Gemini Workspace Studio and Claude's managed agents work internally. Teaches the most important architectural pattern in modern agentic AI.

**Technical approach:**
- Orchestrator agent: a separate system prompt and tool set focused on task decomposition
- Sub-agent registry: each sub-agent has a name, description, system prompt, and allowed tool subset
  - `email_agent` — Gmail tools only
  - `calendar_agent` — Calendar tools only
  - `search_agent` — web_search + fetch_url
  - `memory_agent` — save_memory + recall_memory
- New tool: `delegate(agent_name, task_description)` — orchestrator calls this to spawn a sub-agent
- Sub-agent execution: runs its own agentic loop, returns a structured result to the orchestrator
- SSE: stream sub-agent activity to the frontend so users can see what's running

**Files touched:**
- `backend/src/agents/` — new directory, one file per agent definition
- `backend/src/services/agentOrchestrator.ts` — new service
- `backend/src/tools/delegate.ts` — new tool

---

## Phase 4 — More Integrations

### 4.1 Google Calendar Write

**What:** Create, update, and delete calendar events via natural language. "Book a 1-hour meeting with Sarah tomorrow at 2pm", "Cancel my 3pm".

**Why:** Calendar readonly is already in place. Write access is a small OAuth scope addition and unlocks scheduling workflows.

**Technical approach:**
- Add `calendar.events` scope to Google OAuth
- New tools: `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`
- These tools should be flagged `requiresApproval: true` (Phase 3.1 dependency)
- `emailService` pattern → new `calendarService` with write methods

---

### 4.2 Send Email (beyond draft-only)

**What:** Actually send emails, not just create drafts. Gated behind the approval workflow (Phase 3.1).

**Why:** The draft-only constraint is the right safety call for a sandbox, but a production assistant needs to send. The approval workflow is the safeguard that makes this safe.

**Technical approach:**
- Add `gmail.send` scope to Google OAuth (already implied by `gmail.compose` but needs explicit send call)
- New tool: `send_email` — calls `gmail.users.messages.send`
- Flagged `requiresApproval: true`
- `replyEmail` tool updated to have a send variant alongside the existing draft variant

---

### 4.3 GitHub Integration

**What:** Read repos, issues, PRs; create issues; comment. "What open bugs are assigned to me?", "Summarise the PR #42", "Create an issue for the login bug I just described".

**Why:** Directly useful for a developer-focused assistant. GitHub OAuth is simpler than Google's (no refresh token complexity).

**Technical approach:**
- GitHub OAuth app (separate from Google OAuth — new `GitHubOAuthToken` model)
- New tools: `list_github_issues`, `get_github_pr`, `create_github_issue`, `add_github_comment`
- Uses `@octokit/rest` npm package

---

### 4.4 Slack Integration

**What:** Read channel messages, send messages, search Slack.

**Why:** Slack is where most team communication lives. Teaches webhook-based OAuth (different pattern from Google/GitHub).

**Technical approach:**
- Slack OAuth app with Bot Token scopes: `channels:read`, `chat:write`, `search:read`
- New tools: `send_slack_message`, `search_slack`, `list_slack_channels`
- Token stored in same encrypted pattern as Google tokens

---

## Phase 5 — Platform & Developer Experience

### 5.1 MCP Server

**What:** Expose your Gmail, Calendar, and memory tools as a proper MCP (Model Context Protocol) server so any MCP-compatible client (Claude Desktop, Claude Code, Cursor, Windsurf) can connect to them.

**Why:** This is the architecture that enterprise platforms converge on. Building it teaches you how the underlying protocol works, and makes your tools reusable outside this app.

**Technical approach:**
- New package: `backend/src/mcp/` — an MCP server running alongside the Express server
- Uses `@modelcontextprotocol/sdk` (Anthropic's official SDK)
- Exposes all registered tools via the MCP tool protocol
- Auth: per-user API key that maps to a `userId` (so OAuth tokens resolve correctly)
- Transport: HTTP + SSE (the remote MCP transport)
- Users can connect Claude Desktop by adding a server entry pointing at `http://localhost:5001/mcp`

**Files touched:**
- `backend/src/mcp/server.ts` — new MCP server
- `backend/src/mcp/toolAdapter.ts` — adapts existing RunnableTool format to MCP tool format
- `backend/src/server.ts` — mount MCP server

---

### 5.2 Tool Usage Analytics

**What:** Dashboard showing tool call frequency, latency per tool, error rate, token cost per thread, model usage breakdown.

**Why:** Once the agentic loop is running real workflows, you need observability. Teaches structured logging and simple analytics patterns.

**Technical approach:**
- New Prisma model: `ToolCallLog` (id, userId, threadId, toolName, durationMs, success, tokenCount, createdAt)
- `toolRegistry.execute()` wraps every call with timing and logs to DB
- New endpoint: `GET /api/v1/analytics/tools` — aggregate stats
- Frontend: simple analytics page with bar charts (Recharts)

---

### 5.3 Artifact Rendering

**What:** When the AI produces code, a table, or structured data, render it in a dedicated side panel rather than inline in the chat bubble — like Claude.ai's artifact pane.

**Why:** Major UX upgrade. Code with syntax highlighting, tables with sorting, JSON with collapsible nodes — makes the assistant feel production-grade.

**Technical approach:**
- Detect artifact type by parsing the assistant's message for fenced code blocks, markdown tables, or JSON
- New `ArtifactPanel` component in React rendered alongside the message
- Support: code (with language-aware syntax highlighting via Prism.js), tables, JSON, HTML preview (sandboxed iframe)
- Artifact history: previous artifacts accessible from a sidebar tab

---

## Sequencing Summary

```
Phase 1: Real Auth ✅
    │
    ├── Phase 2.1: Persistent Memory ✅
    │       │
    │       └── Phase 2.2: RAG / Documents  ← shares pgvector infra;
    │                                          completing this upgrades 2.1
    │                                          from full injection → semantic retrieval
    └── Phase 3.1: Approval Workflow
            │
            ├── Phase 3.2: Scheduled Tasks
            ├── Phase 3.3: Multi-Agent Orchestration
            ├── Phase 4.1: Calendar Write
            └── Phase 4.2: Send Email
                    │
                    ├── Phase 4.3: GitHub
                    ├── Phase 4.4: Slack
                    └── Phase 5.1: MCP Server
                            │
                            ├── Phase 5.2: Analytics
                            └── Phase 5.3: Artifact Rendering
```

Phase 1 is the hard dependency. Phases 2, 3, 4, 5 can be worked in parallel once Phase 1 is done — the sequencing within each phase is what matters.

Note on §2.1 → §2.2: these two phases look independent but share infrastructure. §2.2 introduces pgvector (vector embeddings in Postgres). Once that exists, the memory injection in §2.1 can be upgraded from "inject everything" to "embed the user's message and fetch only the most relevant memories" — a much more scalable pattern. Build §2.2 with that upgrade in mind.

---

## What Each Phase Teaches

| Phase | Core learning |
|---|---|
| 1 — Auth | JWT lifecycle, token rotation, secure cookie patterns |
| 2.1 — Memory | Stateful AI, system prompt engineering, background extraction vs tool-based recall, token budgeting, duplicate detection |
| 2.2 — RAG | Embeddings, chunking, pgvector, retrieval patterns |
| 3.1 — Approval | Human-in-the-loop agentic design, async state machines |
| 3.2 — Scheduling | Background job queues, pg-boss, proactive AI agents |
| 3.3 — Multi-agent | Orchestrator patterns, agent specialisation, parallel tool execution |
| 4.x — Integrations | OAuth variants, API client patterns, tool design |
| 5.1 — MCP | Open agent protocols, interoperability, server design |
| 5.2 — Analytics | Observability, structured logging, aggregate queries |
| 5.3 — Artifacts | Rich UI rendering, sandboxed execution, content type detection |
