# Feature Specification: Gmail Automation Agent

**Feature Branch**: `003-gmail-agent`
**Created**: 2026-07-12
**Status**: Draft
**Input**: User wants an AI-powered Gmail automation agent that can read, search, summarize, draft, and reply to emails through the existing chat UI. Drafts are saved to Gmail for user review — no auto-sending.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Gmail OAuth2 Connection (Priority: P0)

A user needs to connect their Gmail account before any email tools work. The system must handle OAuth2 authorization, token storage, and automatic token refresh. Since the system is single-user today but must be multi-user ready, token management is keyed by user ID.

**Why this priority**: Nothing works without authentication. This is the foundation for every other story.

**Independent Test**: Complete the OAuth2 flow, store tokens, restart the server, and verify the stored refresh token automatically obtains a new access token without re-authorization.

**Acceptance Scenarios**:

1. **Given** a user with no Gmail connection, **When** they attempt to use any email tool, **Then** the tool returns a clear error: "Gmail not connected. Visit GET /api/v1/auth/gmail to authorize."
2. **Given** a valid OAuth2 authorization code, **When** the token exchange completes, **Then** access token, refresh token, and expiry are persisted (encrypted at rest) keyed by user ID.
3. **Given** a stored access token that has expired, **When** any email tool is invoked, **Then** the service automatically refreshes the token using the stored refresh token — no user intervention required.
4. **Given** a refresh token that has been revoked by the user in Google settings, **When** any email tool is invoked, **Then** the system returns a clear error indicating re-authorization is needed (not a generic 401).

---

### User Story 2 - Read Inbox (Priority: P1)

A user asks "show me my unread emails" or "show me recent emails." The agent fetches email metadata (sender, subject, date) and the body text, then returns a list with an AI-generated one-line summary per email.

**Why this priority**: Reading is the most fundamental email operation and the prerequisite for search, summarize, and reply.

**Independent Test**: Ask "show me my unread emails" and verify the response lists emails with sender, subject, date, and a one-line AI summary — without exposing full email bodies unless explicitly requested.

**Acceptance Scenarios**:

1. **Given** a user asks "show me my unread emails," **When** the tool executes, **Then** it returns a list of unread emails with: sender name/address, subject, date, and a one-line AI-generated summary.
2. **Given** an inbox with 100+ unread emails, **When** the tool executes without a limit parameter, **Then** it returns the 20 most recent by default and indicates the total count.
3. **Given** a user asks "show me emails from this week," **When** the tool executes, **Then** it filters by the date range and returns matching emails.
4. **Given** the default read mode, **When** the tool fetches emails, **Then** it reads the full body to generate the summary but only returns metadata + summary to the LLM — the full body is NOT included in the tool output unless the user explicitly asks to "read" or "open" a specific email.
5. **Given** no unread emails, **When** the tool executes, **Then** it returns a clear "no unread emails found" message — not an error.

---

### User Story 3 - Search Emails (Priority: P1)

A user asks "find emails from Sarah about the Q3 report" or "search for invoices from last month." The agent translates this into a Gmail search query and returns matching emails with summaries.

**Why this priority**: Search is essential for locating specific emails to reply to or reference.

**Independent Test**: Ask "find emails from john@example.com about project update" and verify the tool constructs the correct Gmail query and returns relevant results with summaries.

**Acceptance Scenarios**:

1. **Given** a user asks "find emails from sarah@company.com," **When** the tool executes, **Then** it constructs a Gmail API query with `from:sarah@company.com` and returns matching emails.
2. **Given** a user asks "find emails about quarterly report from last month," **When** the tool executes, **Then** it constructs a query combining subject/body keywords and date range (`after:` / `before:` operators).
3. **Given** a search with zero results, **When** the tool responds, **Then** it returns "no emails found matching your search" — not an error.
4. **Given** a search returning 50+ results, **When** the tool executes, **Then** it returns the top 20 most relevant by default and indicates more are available.
5. **Given** a natural language search query, **When** the LLM invokes the tool, **Then** the LLM translates intent into structured parameters (from, subject, keywords, dateRange) — the tool does NOT parse natural language itself.

---

### User Story 4 - Summarize Emails (Priority: P1)

A user asks "summarize my inbox" or "categorize my unread emails." The agent reads a batch of emails and produces a categorized summary (e.g., "3 meeting invitations, 2 action items from your manager, 5 newsletters").

**Why this priority**: Inbox summarization is the highest-value AI feature — it saves the user from reading dozens of emails.

**Independent Test**: Ask "summarize my unread inbox" and verify the response groups emails into meaningful categories with counts and highlights.

**Acceptance Scenarios**:

1. **Given** a user asks "summarize my inbox," **When** the tool fetches unread emails, **Then** the LLM categorizes them (e.g., action required, FYI, newsletters, meeting invites) and returns a structured summary.
2. **Given** 30 unread emails, **When** the summarize tool runs, **Then** it processes all 30 (not just the default 20 page) to produce a complete summary.
3. **Given** the summarize tool output, **When** the LLM presents it, **Then** each category includes a count and the most important items highlighted.
4. **Given** an empty inbox, **When** the tool runs, **Then** it returns "inbox is empty — no emails to summarize."

---

### User Story 5 - Draft New Email (Priority: P1)

A user asks "draft an email to john@example.com about rescheduling our meeting to Friday." The agent composes the email and saves it as a draft in Gmail. The user reviews and sends from Gmail.

**Why this priority**: Drafting is the core write operation and must be safe-by-default (never auto-send).

**Independent Test**: Ask the agent to draft an email, verify it appears in Gmail Drafts with correct recipient, subject, and body, and confirm no email was sent.

**Acceptance Scenarios**:

1. **Given** a user asks "draft an email to john@example.com about rescheduling," **When** the tool executes, **Then** it creates a draft in Gmail with the specified recipient, an appropriate subject line, and a composed body.
2. **Given** the draft is saved, **When** the tool responds, **Then** it confirms "Draft saved to Gmail" and shows the recipient, subject, and a preview of the body in the chat.
3. **Given** the user provides only a recipient and a topic (no explicit body), **When** the LLM invokes the tool, **Then** it generates appropriate subject and body content based on the topic.
4. **Given** the user says "send it" after seeing the draft, **When** the agent processes this, **Then** it does NOT send the email. It reminds the user to send from Gmail. (Sending is not a v1 feature.)
5. **Given** an invalid email address, **When** the tool attempts to create the draft, **Then** it returns a validation error before calling the Gmail API.

---

### User Story 6 - Reply to Email (Priority: P1)

A user asks "reply to Sarah's email about the project deadline." The agent finds the email, reads the thread context, composes a contextual reply, and saves it as a draft in Gmail.

**Why this priority**: Contextual replies are the second core write operation and require thread-awareness.

**Independent Test**: Ask the agent to reply to a specific email, verify it creates a Gmail draft in the correct thread with proper `In-Reply-To` and `References` headers.

**Acceptance Scenarios**:

1. **Given** a user asks "reply to Sarah's last email about the deadline," **When** the agent processes this, **Then** it first searches for the email, reads the thread context, composes a reply, and saves it as a draft in the correct Gmail thread.
2. **Given** the reply draft is saved, **When** the tool responds, **Then** it shows the original email subject, the reply body preview, and confirms "Reply draft saved to Gmail."
3. **Given** an ambiguous reference ("reply to John's email"), **When** multiple emails from John exist, **Then** the agent lists the recent matches and asks the user to clarify which one.
4. **Given** a thread with 10 messages, **When** the agent composes a reply, **Then** it uses the thread context to write a relevant response — not a generic reply.
5. **Given** a reply request, **When** the draft is created, **Then** it includes proper email threading headers (`In-Reply-To`, `References`) so the reply appears in the correct Gmail thread.

---

### User Story 7 - Safety Guardrails (Priority: P0)

The system must enforce privacy and safety boundaries: metadata-only access by default, no auto-sending, and clear boundaries on what the AI can read.

**Why this priority**: Safety is non-negotiable. Incorrect guardrails could expose sensitive email content or send unintended emails.

**Independent Test**: Verify that the tool output for a `read_emails` call contains only metadata + AI summary (not raw bodies), and that no tool in the system can send an email.

**Acceptance Scenarios**:

1. **Given** the default `read_emails` call, **When** the tool returns results, **Then** the tool output contains sender, subject, date, and AI summary — NOT the full email body.
2. **Given** a user asks "read the full email from John about the contract," **When** the user explicitly requests body access, **Then** the tool includes the full body for that specific email only.
3. **Given** any tool in the email system, **When** examining its capabilities, **Then** no tool has the ability to send an email (only create drafts).
4. **Given** the Gmail OAuth scopes, **When** the service initializes, **Then** it requests `gmail.readonly`, `gmail.compose`, and `gmail.modify` — NOT `gmail.send` in v1. (Note: `gmail.compose` allows draft creation; `gmail.modify` is NOT needed. If `gmail.compose` alone cannot create drafts, use the minimum scope that allows it.)
5. **Given** a tool call that returns email content, **When** the response is logged, **Then** email bodies and subjects are NOT written to server logs (PII redaction).

---

### Edge Cases

- **Expired/revoked tokens**: The system MUST detect expired tokens and attempt refresh. If refresh fails, it MUST return a clear "re-authorize Gmail" error — not a cryptic API failure.
- **Gmail API rate limits**: The system MUST handle 429 responses gracefully with exponential backoff and a user-facing message if the limit cannot be satisfied.
- **Large emails**: Emails with bodies exceeding 50KB of text MUST be truncated with a "[truncated]" marker to avoid blowing the LLM context window.
- **HTML-only emails**: Emails with no plain text part MUST be converted to plain text (strip HTML tags) before processing.
- **Emails with attachments**: Attachment metadata (filename, size, type) MUST be included in the email summary. Attachment content is NOT downloaded or processed in v1.
- **Non-ASCII content**: The system MUST handle UTF-8 encoded emails (international characters, emoji) without corruption.
- **Thread with mixed participants**: When replying, the draft MUST reply to the correct sender — not to yourself or an unrelated participant.
- **Concurrent tool calls**: If `read_emails` and `search_emails` are called in parallel by the agentic loop, they MUST NOT interfere with each other (stateless API calls).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST authenticate with Gmail using OAuth2 with the minimum required scopes: `gmail.readonly` and `gmail.compose`.
- **FR-002**: OAuth2 tokens (access token, refresh token, expiry) MUST be stored persistently in a local config file (e.g., `.env` or JSON config). Single-user scope — no database table required.
- **FR-003**: Access tokens MUST be refreshed automatically when expired — no user intervention for routine token renewal.
- **FR-004**: The `read_emails` tool MUST accept parameters: `filter` (unread, read, all), `maxResults` (default 20, max 50), and `dateRange` (optional).
- **FR-005**: The `read_emails` tool MUST return per-email: `id`, `threadId`, `from` (name + address), `subject`, `date`, and `snippet` (Gmail's built-in ~200 character preview). The LLM generates human-readable summaries naturally from the snippet — no separate `summary` field in the tool output.
- **FR-006**: The `search_emails` tool MUST accept parameters: `from`, `to`, `subject`, `keywords`, `dateRange` (after/before), `hasAttachment`, and `maxResults`.
- **FR-007**: The `search_emails` tool MUST construct Gmail API search queries from structured parameters — NOT pass raw Gmail query syntax from the user.
- **FR-008**: The `summarize_emails` tool MUST fetch up to 50 emails and return them for the LLM to categorize and summarize.
- **FR-009**: The `draft_email` tool MUST accept: `to`, `subject`, `body`, `cc` (optional), `bcc` (optional) — and create a draft in the user's Gmail Drafts folder.
- **FR-010**: The `reply_email` tool MUST accept: `emailId` (the email being replied to), `body` — and create a draft reply in the correct Gmail thread with proper `In-Reply-To` and `References` headers.
- **FR-011**: No tool in the email system MUST have the capability to send an email. All compose operations create drafts only.
- **FR-012**: Email body content MUST NOT appear in tool output by default. The tool returns metadata + AI summary. Full body is returned only when the user explicitly requests it via a `includeBody` parameter.
- **FR-013**: Email body content and subjects MUST be redacted from server logs (Pino redaction paths).
- **FR-014**: Emails exceeding 50KB of text content MUST be truncated before processing.
- **FR-015**: HTML-only emails MUST be converted to plain text before processing.
- **FR-016**: Gmail API 429 (rate limit) responses MUST be handled with exponential backoff (max 3 retries) and a user-facing error if retries are exhausted.
- **FR-017**: All email tools MUST follow the existing `RunnableTool` interface with Zod input validation and per-tool timeouts.
- **FR-018**: The email service layer MUST be a standalone module (`src/services/emailService.ts`) encapsulating all Gmail API interactions — no Gmail API calls outside this module.
- **FR-019**: Attachment metadata (filename, size, MIME type) MUST be included in email data when present. Attachment content is NOT downloaded.

### Non-Functional Requirements

- **NFR-001**: Each email tool call MUST complete within 15 seconds (tool timeout). Batch operations (summarize 50 emails) MUST complete within 30 seconds.
- **NFR-002**: OAuth2 tokens are stored in a local config file. The file SHOULD be excluded from version control (`.gitignore`). Encryption at rest is not required for local dev — tokens are protected by file system permissions.
- **NFR-003**: The email service MUST be stateless per-request — no in-memory caching of email data between tool calls. (Gmail API is the source of truth.)
- **NFR-004**: The architecture MUST support multiple users without code changes — only the token lookup needs a user ID parameter.
- **NFR-005**: All Gmail API calls MUST include structured logging: operation name, duration, result count, and user ID — but NOT email content.

### Key Entities

- **EmailService**: Singleton service encapsulating Gmail API client, OAuth2 token management, and all Gmail operations. Keyed by user ID for multi-user readiness.
- **GmailToken**: Stored credential containing access token, refresh token, and expiry timestamp. Persisted in a local config file (not database).
- **EmailSummary**: The data shape returned by read/search tools: `id`, `threadId`, `from`, `subject`, `date`, `snippet`, `hasAttachments`, `attachments[]?`.
- **EmailDraft**: The data shape for draft creation: `to`, `subject`, `body`, `cc?`, `bcc?`, `threadId?` (for replies), `inReplyTo?`, `references?`.

### Tools Summary

| Tool | Input Parameters | Output | Timeout |
|------|-----------------|--------|---------|
| `read_emails` | `filter`, `maxResults`, `dateRange?` | `EmailSummary[]` + total count | 15s |
| `search_emails` | `from?`, `to?`, `subject?`, `keywords?`, `dateRange?`, `hasAttachment?`, `maxResults` | `EmailSummary[]` + total count | 15s |
| `summarize_emails` | `filter?`, `maxResults` (up to 50) | Raw `EmailSummary[]` for LLM to categorize | 30s |
| `draft_email` | `to`, `subject`, `body`, `cc?`, `bcc?` | Draft ID + confirmation | 10s |
| `reply_email` | `emailId`, `body` | Draft ID + thread subject + confirmation | 10s |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can ask "show me my unread emails" and receive a formatted list with AI summaries within 15 seconds.
- **SC-002**: A user can ask "draft an email to X about Y" and find the draft in their Gmail Drafts folder with correct recipient, subject, and body.
- **SC-003**: A user can ask "reply to [specific email]" and find a contextual reply draft in the correct Gmail thread.
- **SC-004**: No email body content appears in server logs under any code path.
- **SC-005**: OAuth2 token refresh works transparently — the user authorizes once and never re-authorizes unless they revoke access.
- **SC-006**: All 5 email tools pass Zod input validation and follow the `RunnableTool` interface.
- **SC-007**: The entire email feature is contained in: `src/services/emailService.ts`, `src/tools/readEmails.ts`, `src/tools/searchEmails.ts`, `src/tools/summarizeEmails.ts`, `src/tools/draftEmail.ts`, `src/tools/replyEmail.ts`, and registration in `src/tools/index.ts` — no changes to existing tool or service files beyond registration.

## Clarifications

### Session 2026-07-12

- Q: Should drafts be shown in the chat UI or saved to Gmail? → A: Saved to Gmail Drafts. User reviews and sends from Gmail.
- Q: AI-generated summary vs. Gmail snippet? → A: AI-generated one-line summary per email. Gmail snippet is included as fallback metadata.
- Q: Should the AI read full email bodies by default? → A: No. Metadata only by default. Full body only when user explicitly asks to "read" or "open" a specific email.
- Q: Should the system auto-send emails? → A: No. Drafts only in v1. If user says "send it," remind them to send from Gmail.
- Q: Should email data be stored in PostgreSQL? → A: No. Pass-through from Gmail API, no local storage.
- Q: Single user or multi-user? → A: Single user now, but architecture must support multi-user with no code changes (user ID keyed).
- Q: Standalone service or integrated? → A: Integrated into existing tool system with a dedicated email service layer.
- Q: How does the user initiate OAuth2 authorization? → A: Dedicated server endpoint (`GET /api/v1/auth/gmail`) that initiates the OAuth redirect flow. User visits the URL in a browser.
- Q: Where are OAuth2 tokens stored? → A: Environment/config file (e.g., `.env` or a local config file). Single-user only — no database table for tokens.
- Q: Reuse existing Google Cloud credentials or new ones? → A: Reuse existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Gmail API is an additional scope on the same Google Cloud project.

## Assumptions

- The user already has Google Cloud project credentials with Gmail API enabled (reuses existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the calendar tool setup).
- Gmail API quotas (250 units/second default) are sufficient for single-user usage.
- The existing agentic tool loop (10 iteration max) is sufficient for email workflows — no need for a separate orchestration layer.
- The LLM (not the tool) handles natural language understanding — tools receive structured parameters.
- Email content is ephemeral — not stored in the database, not cached between requests.
- The existing `google-auth.ts` script can be extended for Gmail scopes, or a new authorization endpoint can be added.
