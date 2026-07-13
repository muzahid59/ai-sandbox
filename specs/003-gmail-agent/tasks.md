# Tasks: Gmail Automation Agent

**Feature Branch**: `003-gmail-agent`
**Generated**: 2026-07-12
**Spec**: `specs/003-gmail-agent/spec.md`
**Plan**: `specs/003-gmail-agent/plan.md`

## Summary

- **Total Tasks**: 36
- **Phases**: 7 (Setup, Foundation, US1 OAuth, US2 Read Inbox, US3 Search, US4 Summarize + US5 Draft + US6 Reply, US7 Safety)
- **User Stories**: 7 (P0: US1, US7 | P1: US2, US3, US4, US5, US6)
- **Parallel Opportunities**: 12 tasks marked [P]

---

## Phase 1: Setup

**Goal**: Project scaffolding — gitignore, env vars, shared types.

- [X] T001 Add `.gmail-tokens.json` to root `.gitignore`
- [X] T002 Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` entries to `backend/.env.example` (already present — verify; add Gmail-specific comments)
- [X] T003 Create shared Gmail type interfaces (`GmailTokenStore`, `GmailTokenEntry`, `EmailSummary`, `AttachmentMeta`, `EmailDraft`, `ReplyDraft`, `DraftResult`, `EmailListResult`) in `backend/src/types/email.ts`

---

## Phase 2: Foundation (Blocking)

**Goal**: Email service core — token management, Gmail API client, retry logic, logging. All user story phases depend on this.

- [X] T004 Implement `EmailService` singleton class skeleton with constructor, logger child, and Google OAuth2 client factory in `backend/src/services/emailService.ts`
- [X] T005 Implement token CRUD methods in `EmailService`: `getTokens(userId)`, `saveTokens(userId, tokens)`, `removeTokens(userId)`, `isConnected(userId)` — reads/writes `backend/.gmail-tokens.json` in `backend/src/services/emailService.ts`
- [X] T006 Implement `getAuthClient(userId)` in `EmailService` that reads tokens, creates `google.auth.OAuth2` client, checks expiry, auto-refreshes if expired, and persists refreshed tokens in `backend/src/services/emailService.ts`
- [X] T007 Implement exponential backoff retry wrapper (`withRetry`) for Gmail API 429 responses (delays 1s, 2s, 4s, max 3 retries) as private method in `backend/src/services/emailService.ts`
- [X] T008 Add email PII redaction paths (`emailBody`, `emailSubject`, `emailContent`, `body`, `subject`) to pino redact config in `backend/src/config/logger.ts`
- [X] T009 Implement private email parsing helpers in `EmailService`: `parseEmail(message)` extracts headers/metadata into `EmailSummary`, `extractBody(payload)` walks MIME parts for text/plain or text/html fallback, `truncateBody(text, maxBytes)` truncates at 50KB with `[truncated]` marker in `backend/src/services/emailService.ts`
- [X] T010 Unit tests for EmailService core: token CRUD, getAuthClient with refresh, withRetry backoff, parseEmail/extractBody/truncateBody helpers — mock `googleapis` and filesystem in `backend/tests/services/emailService.test.ts`

---

## Phase 3: User Story 1 — Gmail OAuth2 Connection (P0)

**Goal**: User can connect their Gmail account via browser-based OAuth2 flow. Tokens are stored, refreshed automatically, and errors are clear.

**Independent Test**: Complete OAuth2 flow, store tokens, restart server, verify stored refresh token auto-obtains new access token.

- [X] T011 [US1] Create `gmailAuthRoutes` Express router with `GET /auth/gmail` endpoint that redirects to Google consent URL with `gmail.readonly` + `gmail.compose` scopes, `access_type=offline`, `prompt=consent`, and `state={userId}` in `backend/src/routes/gmailAuthRoutes.ts`
- [X] T012 [US1] Implement `GET /auth/gmail/callback` endpoint that exchanges authorization code for tokens, saves via `EmailService.saveTokens()`, returns HTML confirmation page, and handles denied/missing code errors in `backend/src/routes/gmailAuthRoutes.ts`
- [X] T013 [US1] Implement `GET /auth/gmail/status` endpoint that returns `{connected, email, scopes}` or `{connected: false, authorizeUrl}` in `backend/src/routes/gmailAuthRoutes.ts`
- [X] T014 [US1] Mount `gmailAuthRoutes` under `/api/v1` in `backend/src/server.ts` (the callback route needs to be accessible without auth middleware — mount before `authMiddleware` or handle within route)
- [X] T015 [US1] Integration tests for OAuth routes via supertest: redirect URL construction, callback with valid code, callback with denied access, status endpoint (connected / not connected) in `backend/tests/routes/gmailAuth.test.ts`

---

## Phase 4: User Story 2 — Read Inbox (P1)

**Goal**: User can ask "show me my unread emails" and receive a formatted list with metadata and snippets.

**Independent Test**: Ask "show me my unread emails" — verify response lists emails with sender, subject, date, snippet. No full body unless explicitly requested.

- [X] T016 [US2] Implement `listEmails(userId, filter, maxResults, dateRange?, includeBody?)` method in `EmailService` that calls `gmail.users.messages.list` with query filters, fetches each message with `gmail.users.messages.get`, parses via `parseEmail()`, returns `EmailListResult` in `backend/src/services/emailService.ts`
- [X] T017 [US2] Implement `getEmail(userId, emailId, includeBody)` method in `EmailService` that fetches a single message and returns `EmailSummary` (with optional body) in `backend/src/services/emailService.ts`
- [X] T018 [P] [US2] Create `read_emails` tool following `RunnableTool` interface with Zod schema (`filter`, `maxResults`, `dateRange`, `includeBody`), 15s timeout, delegates to `EmailService.listEmails()`, formats output as numbered list with sender/subject/date/snippet/attachments in `backend/src/tools/readEmails.ts`

---

## Phase 5: User Story 3 — Search Emails (P1)

**Goal**: User can ask "find emails from Sarah about Q3 report" and receive matching results.

**Independent Test**: Ask "find emails from john@example.com about project update" — verify correct Gmail query construction and relevant results.

- [X] T019 [US3] Implement `searchEmails(userId, params)` method in `EmailService` that constructs Gmail query string from structured params (`from:`, `to:`, `subject:`, keywords, `after:`, `before:`, `has:attachment`), calls `gmail.users.messages.list`, fetches and parses results in `backend/src/services/emailService.ts`
- [X] T020 [P] [US3] Create `search_emails` tool following `RunnableTool` interface with Zod schema (`from`, `to`, `subject`, `keywords`, `dateRange`, `hasAttachment`, `maxResults`, `includeBody`), 15s timeout, delegates to `EmailService.searchEmails()`, formats output same as read_emails in `backend/src/tools/searchEmails.ts`
- [X] T021 Unit tests for read_emails and search_emails tools: Zod validation, email formatting, query construction, error handling — mock `EmailService` in `backend/tests/tools/readEmails.test.ts`

---

## Phase 6: User Stories 4, 5, 6 — Summarize, Draft, Reply (P1)

**Goal**: User can summarize inbox, draft new emails, and reply to existing emails. All compose operations create Gmail drafts only — no sending.

**Independent Test (US4)**: Ask "summarize my unread inbox" — verify grouped categories with counts.
**Independent Test (US5)**: Ask to draft an email — verify it appears in Gmail Drafts with correct recipient/subject/body; no email sent.
**Independent Test (US6)**: Ask to reply to a specific email — verify draft created in correct thread with proper `In-Reply-To`/`References` headers.

### Summarize (US4)

- [X] T022 [P] [US4] Create `summarize_emails` tool following `RunnableTool` interface with Zod schema (`filter`, `maxResults` up to 50), 30s timeout, delegates to `EmailService.listEmails()` with higher maxResults, formats raw email list for LLM categorization in `backend/src/tools/summarizeEmails.ts`

### Draft (US5)

- [X] T023 [US5] Implement `createDraft(userId, draft)` method in `EmailService` that builds RFC 2822 MIME message from `EmailDraft`, base64url-encodes it, calls `gmail.users.drafts.create`, returns `DraftResult` in `backend/src/services/emailService.ts`
- [X] T024 [P] [US5] Create `draft_email` tool following `RunnableTool` interface with Zod schema (`to` with email validation, `subject`, `body`, `cc?`, `bcc?`), 10s timeout, delegates to `EmailService.createDraft()`, formats confirmation with recipient/subject/preview/draftId in `backend/src/tools/draftEmail.ts`

### Reply (US6)

- [X] T025 [US6] Implement `createReplyDraft(userId, emailId, body)` method in `EmailService` that fetches original email for thread context, extracts `Message-ID`/`References`/`threadId`, builds reply MIME with `In-Reply-To` and `References` headers, `Re:` subject prefix, creates draft in correct thread in `backend/src/services/emailService.ts`
- [X] T026 [P] [US6] Create `reply_email` tool following `RunnableTool` interface with Zod schema (`emailId`, `body`), 10s timeout, delegates to `EmailService.createReplyDraft()`, formats confirmation with thread subject/recipient/preview/draftId in `backend/src/tools/replyEmail.ts`

### Tests & Registration

- [X] T027 Unit tests for summarize_emails, draft_email, and reply_email tools: Zod validation, draft creation, threading headers, error handling — mock `EmailService` in `backend/tests/tools/draftEmail.test.ts`
- [X] T028 Register all 5 email tools (`readEmails`, `searchEmails`, `summarizeEmails`, `draftEmail`, `replyEmail`) in `backend/src/tools/index.ts`

---

## Phase 7: User Story 7 — Safety Guardrails & Polish (P0)

**Goal**: Verify all safety constraints, edge cases, and cross-cutting concerns are met.

**Independent Test**: Verify `read_emails` default output has no body content; confirm no tool can send email; check logs contain no PII.

### Safety Verification

- [X] T029 [US7] Verify OAuth2 scopes are exactly `gmail.readonly` + `gmail.compose` — no `gmail.send` scope requested anywhere in codebase
- [X] T030 [US7] Verify no tool in the email system exposes send capability — only draft creation via `gmail.users.drafts.create` (audit all `EmailService` methods and tool files)
- [X] T031 [US7] Verify default `read_emails` / `search_emails` tool output contains only metadata + snippet — no email body unless `includeBody: true`
- [X] T032 [US7] Verify email body/subject PII redaction works in pino logs — log an email operation and confirm body/subject are `[REDACTED]`

### Edge Cases

- [X] T033 Validate edge case handling across all tools: HTML-only emails converted via `html-to-text`, 50KB truncation with `[truncated]` marker, attachment metadata included, UTF-8/international content preserved, empty inbox/search returns friendly message not error
- [X] T034 Validate error handling across all tools: expired token triggers auto-refresh, revoked refresh token returns clear re-auth message, 429 rate limit triggers backoff then user-facing error, invalid email address in draft returns validation error, Gmail API network errors return actionable message

### Cross-Cutting

- [X] T035 Update Postman collection with Gmail OAuth endpoints (`GET /auth/gmail`, `GET /auth/gmail/callback`, `GET /auth/gmail/status`) in `docs/postman/chat-thread-api.postman_collection.json`
- [X] T036 Run full test suite (`npm test` in backend), verify all tests pass and check coverage is reasonable for new code

---

## Dependencies

```
Phase 1 (Setup)
  └──→ Phase 2 (Foundation + Tests)
         ├──→ Phase 3 (US1: OAuth + Tests)
         ├──→ Phase 4 (US2: Read)
         │      └──→ Phase 5 (US3: Search + Tests for Read/Search)
         │      └──→ Phase 6 (US4-6: Summarize/Draft/Reply + Tests)
         └──→ Phase 7 (US7: Safety — runs last)
```

- **Phase 1 → Phase 2**: Types must exist before service implementation.
- **Phase 2 → Phases 3-6**: `EmailService` core (tokens, auth client, parsing) blocks all tools.
- **Phase 3 (OAuth)** can run in parallel with **Phases 4-6** after Phase 2 completes (OAuth routes and tools are independent).
- **Phase 4 (Read)** should complete before Phase 5 (Search) since `searchEmails` reuses the same `listEmails`/parsing pattern.
- **Phase 6** tasks are internally parallelizable: summarize, draft, and reply tools are independent.
- **Phase 7** runs last — cross-cutting safety verification across all implemented code.

## Parallel Execution Opportunities

### After Phase 2 completes:
- **Parallel group A**: T011-T015 (OAuth routes + tests) can run alongside T016-T018 (Read tool)
- **Parallel group B**: T022 (Summarize tool), T024 (Draft tool), T026 (Reply tool) — all [P] marked, different files, no dependencies on each other

### Within Phase 6:
- T022 (summarize), T024 (draft), T026 (reply) are all independent tool files

## Implementation Strategy

1. **MVP (Phase 1-4)**: Setup + Foundation + OAuth + Read Inbox = minimal working feature. User can connect Gmail and read emails through chat.
2. **Core (Phase 5-6)**: Add search, summarize, draft, and reply. Full tool suite available.
3. **Hardening (Phase 7)**: Safety verification and edge case validation.

**Suggested MVP scope**: Phases 1-4 (Tasks T001-T018). After MVP, a user can connect Gmail and ask "show me my unread emails" end-to-end through the chat UI.
