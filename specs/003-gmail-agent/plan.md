# Implementation Plan: Gmail Automation Agent

**Feature Branch**: `003-gmail-agent`
**Spec**: `specs/003-gmail-agent/spec.md`
**Status**: Ready for implementation

## Technical Context

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js + Express (ts-node) |
| Database | PostgreSQL + Prisma (NOT used for this feature — tokens in file) |
| AI Integration | Agentic tool loop (`toolExecutor.ts`, max 10 iterations) |
| Tool Pattern | `RunnableTool` interface with Zod validation |
| Gmail API Client | `googleapis` npm package (already installed) |
| HTML Processing | `html-to-text` npm package (already installed) |
| Logging | pino with structured JSON + PII redaction |
| Auth | Hardcoded dev user (`req.user.id`) — tools keyed by user ID |
| Existing Reference | `googleCalendar.ts` — same OAuth2 + googleapis pattern |

**No new dependencies required.** All packages already in `backend/package.json`.

## Constitution Check

### I. Code Quality (NON-NEGOTIABLE)

- **TypeScript**: All new code in `backend/src/`. No new JS files. ✅
- **Single responsibility**: `EmailService` for Gmail API, one file per tool, one file for auth routes. ✅
- **Structured logging**: All Gmail operations use `logger.child({ tool: '...' })`. No `console.log`. ✅
- **Dead code**: No unused exports or commented-out blocks. ✅
- **Linting**: Must pass `npm run lint` before PR. ✅
- **Function size**: Service methods and tool handlers stay under 50 lines each. ✅

### II. Testing Standards

- **Unit tests**: `EmailService` methods with mocked `googleapis` client. ✅
- **Integration tests**: OAuth endpoints via supertest. ✅
- **Tool tests**: Each tool with mocked `EmailService`. ✅
- **Deterministic**: No external API calls in tests — all mocked. ✅
- **Coverage**: Target 80% line coverage for new files. Critical paths (token refresh, error handling) at 100% branch. ✅

### III. User Experience Consistency

- **No frontend changes required**: Tools work through existing chat UI + agentic loop. ✅
- **Tool feedback**: Existing SSE events (`tool_use_start`, `tool_use_result`) display tool execution in real-time. ✅
- **Error messages**: All `ToolError` messages are user-actionable ("Gmail not connected. Visit..."). ✅

### IV. Performance Requirements

- **Tool timeouts**: `read_emails` 15s, `search_emails` 15s, `summarize_emails` 30s, `draft_email` 10s, `reply_email` 10s. ✅
- **No in-memory caching**: Stateless per-request (NFR-003). ✅
- **Token file I/O**: Synchronous-safe — file is <1KB, read once per tool call. ✅

### Quality Gates

- Lint Gate: `npm run lint` (backend) — zero errors. ✅
- Type Gate: `npm run build` (backend) — zero TS errors. ✅
- Test Gate: `npm test` (backend) — all green. ✅
- Coverage Gate: 80% line coverage for new code. ✅
- Security Gate: No hardcoded secrets, tokens in gitignored file, PII redacted from logs, Zod input validation on all tools. ✅

## Architecture Decisions

### AD-1: Token Storage

**Decision**: JSON file (`backend/.gmail-tokens.json`) keyed by user ID.
**Rationale**: Spec requires file-based storage (FR-002). Dynamic read without restart. Multi-user ready via user ID key (NFR-004).
**See**: `research.md` §3

### AD-2: OAuth2 Flow

**Decision**: Server-side authorization code flow via Express routes.
**Rationale**: User-initiated flow via browser. Follows spec requirement for `GET /api/v1/auth/gmail` endpoint.
**See**: `research.md` §2, `contracts/oauth-endpoints.md`

### AD-3: AI Summary Strategy

**Decision**: Tool returns `snippet` (Gmail's 200-char preview). LLM generates summary naturally.
**Rationale**: Avoids nested LLM calls inside tools. Tools are I/O-only. The agentic loop's LLM sees snippets and produces summaries.
**See**: `research.md` §9

### AD-4: No New Dependencies

**Decision**: Use existing `googleapis` and `html-to-text` packages.
**Rationale**: Both already in `package.json`. No bundle size impact.

## Implementation Phases

### Phase 1: Email Service Foundation (P0)

**Goal**: Gmail API client with OAuth2 token management.

**Files to create**:
1. `backend/src/services/emailService.ts` — Singleton service with:
   - `getAuthClient(userId)` — reads tokens from file, creates OAuth2 client, auto-refreshes if expired
   - `saveTokens(userId, tokens)` — atomic write to `.gmail-tokens.json`
   - `getTokens(userId)` — read from file
   - `removeTokens(userId)` — delete user's tokens
   - `isConnected(userId)` — check if valid tokens exist
   - Private helpers for retry logic (exponential backoff on 429)

**Files to modify**:
1. `backend/.gitignore` — add `.gmail-tokens.json`
2. `backend/src/config/logger.ts` — add email PII redaction paths (`emailBody`, `emailSubject`, `emailContent`, `body`, `subject`)

**Tests**: `backend/tests/services/emailService.test.ts`
- Token CRUD operations (read, write, delete)
- Token refresh flow (mocked googleapis)
- Error handling (expired token, revoked token, network error)
- Retry logic for 429 responses

### Phase 2: OAuth2 Routes (P0)

**Goal**: Browser-based authorization flow.

**Files to create**:
1. `backend/src/routes/gmailAuthRoutes.ts` — Express router with:
   - `GET /auth/gmail` — redirect to Google consent
   - `GET /auth/gmail/callback` — exchange code for tokens, save to file
   - `GET /auth/gmail/status` — return connection status

**Files to modify**:
1. `backend/src/server.ts` — mount `gmailAuthRoutes` under `/api/v1`

**Tests**: `backend/tests/routes/gmailAuth.test.ts`
- Redirect URL construction
- Callback with valid code
- Callback with denied access
- Status endpoint (connected / not connected)

### Phase 3: Read Tools (P1)

**Goal**: `read_emails` and `search_emails` tools.

**Files to create**:
1. `backend/src/services/emailService.ts` — add methods:
   - `listEmails(userId, filter, maxResults, dateRange?, includeBody?)` → `EmailListResult`
   - `searchEmails(userId, params)` → `EmailListResult`
   - `getEmail(userId, emailId, includeBody)` → `EmailSummary`
   - Private helpers: `parseEmail(message)`, `extractBody(payload)`, `truncateBody(text, maxBytes)`

2. `backend/src/tools/readEmails.ts` — `read_emails` tool
3. `backend/src/tools/searchEmails.ts` — `search_emails` tool

**Files to modify**:
1. `backend/src/tools/index.ts` — register `readEmails`, `searchEmails`

**Tests**:
- `backend/tests/tools/readEmails.test.ts` — Zod validation, email formatting, error handling
- `backend/tests/tools/searchEmails.test.ts` — query construction, result formatting
- `backend/tests/services/emailService.test.ts` — add `listEmails`, `searchEmails` tests

### Phase 4: Summarize Tool (P1)

**Goal**: `summarize_emails` tool.

**Files to create**:
1. `backend/src/tools/summarizeEmails.ts` — `summarize_emails` tool (uses `emailService.listEmails` with higher maxResults)

**Files to modify**:
1. `backend/src/tools/index.ts` — register `summarizeEmails`

**Tests**: `backend/tests/tools/summarizeEmails.test.ts`

### Phase 5: Draft & Reply Tools (P1)

**Goal**: `draft_email` and `reply_email` tools.

**Files to create**:
1. `backend/src/services/emailService.ts` — add methods:
   - `createDraft(userId, draft)` → `DraftResult`
   - `createReplyDraft(userId, emailId, body)` → `DraftResult`
   - Private helpers: `buildMimeMessage(draft)`, `buildReplyMimeMessage(originalEmail, body)`

2. `backend/src/tools/draftEmail.ts` — `draft_email` tool
3. `backend/src/tools/replyEmail.ts` — `reply_email` tool

**Files to modify**:
1. `backend/src/tools/index.ts` — register `draftEmail`, `replyEmail`

**Tests**:
- `backend/tests/tools/draftEmail.test.ts` — validation, draft creation, error handling
- `backend/tests/tools/replyEmail.test.ts` — thread context, headers, error handling
- `backend/tests/services/emailService.test.ts` — add `createDraft`, `createReplyDraft` tests

### Phase 6: Safety & Edge Cases

**Goal**: Validate all guardrails from spec User Story 7.

**Verification checklist**:
- [ ] No tool has send capability — only draft creation (FR-011)
- [ ] Default tool output has no email body — only metadata + snippet (FR-012)
- [ ] `includeBody: true` returns body for explicit requests only
- [ ] Email bodies redacted from pino logs (FR-013)
- [ ] 50KB truncation with `[truncated]` marker (FR-014)
- [ ] HTML→plaintext conversion via `html-to-text` (FR-015)
- [ ] 429 retry with exponential backoff (FR-016)
- [ ] Attachment metadata included (FR-019)
- [ ] Token refresh on expired access token (FR-003)
- [ ] Clear error on revoked refresh token (Scenario 1.4)
- [ ] OAuth scopes are `gmail.readonly` + `gmail.compose` only (FR-001)
- [ ] UTF-8 handling for international content
- [ ] `.gmail-tokens.json` in `.gitignore`

**Tests**: Safety-specific test cases in existing test files.

## File Summary

### New Files (8)

| File | Description |
|------|-------------|
| `backend/src/services/emailService.ts` | Gmail API client + token management |
| `backend/src/routes/gmailAuthRoutes.ts` | OAuth2 flow endpoints |
| `backend/src/tools/readEmails.ts` | `read_emails` tool |
| `backend/src/tools/searchEmails.ts` | `search_emails` tool |
| `backend/src/tools/summarizeEmails.ts` | `summarize_emails` tool |
| `backend/src/tools/draftEmail.ts` | `draft_email` tool |
| `backend/src/tools/replyEmail.ts` | `reply_email` tool |
| `backend/.gmail-tokens.json` | Token storage (gitignored, created at runtime) |

### Modified Files (3)

| File | Change |
|------|--------|
| `backend/src/tools/index.ts` | Register 5 new email tools |
| `backend/src/server.ts` | Mount `gmailAuthRoutes` |
| `backend/src/config/logger.ts` | Add email PII redaction paths |

### Test Files (4)

| File | Covers |
|------|--------|
| `backend/tests/services/emailService.test.ts` | Token CRUD, Gmail API methods, retry logic |
| `backend/tests/routes/gmailAuth.test.ts` | OAuth flow endpoints |
| `backend/tests/tools/readEmails.test.ts` | read_emails + searchEmails tools |
| `backend/tests/tools/draftEmail.test.ts` | draft_email + replyEmail tools |

### Unchanged Existing Files

- `backend/src/tools/types.ts` — `RunnableTool` interface is sufficient
- `backend/src/services/toolRegistry.ts` — no changes needed
- `backend/src/services/toolExecutor.ts` — agentic loop handles new tools automatically
- All frontend files — tools work through existing chat UI
- `backend/prisma/schema.prisma` — no database changes

## Dependencies Between Phases

```
Phase 1 (EmailService) ──→ Phase 2 (OAuth Routes)
         │
         ├──→ Phase 3 (Read/Search Tools)
         │         │
         │         └──→ Phase 4 (Summarize Tool)
         │
         └──→ Phase 5 (Draft/Reply Tools)
                  │
                  └──→ Phase 6 (Safety Verification)
```

Phase 1 is the foundation. Phases 3-5 can be parallelized after Phase 1. Phase 6 runs last as a cross-cutting verification.
