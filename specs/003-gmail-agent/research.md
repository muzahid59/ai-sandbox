# Research: Gmail Automation Agent

## 1. Gmail API OAuth2 Scopes

**Decision**: Use `gmail.readonly` + `gmail.compose` scopes only.

**Rationale**:
- `gmail.readonly` (`https://www.googleapis.com/auth/gmail.readonly`) grants read access to all messages, threads, labels, and settings. Sufficient for `read_emails`, `search_emails`, and `summarize_emails` tools.
- `gmail.compose` (`https://www.googleapis.com/auth/gmail.compose`) grants permission to create, read, update, and delete drafts, as well as send messages. However, the application will only use draft creation — sending is explicitly excluded at the application layer (FR-011).
- `gmail.modify` is NOT needed. `gmail.compose` alone supports `users.drafts.create`.
- `gmail.send` scope is NOT requested per spec (SC-006 safety guardrail). The `gmail.compose` scope technically allows sending via `users.messages.send`, but the application will NOT expose any send tool — safety is enforced at the tool layer, not the scope layer. This is a pragmatic choice: `gmail.compose` is the narrowest scope that supports draft creation.

**Alternatives considered**:
- `gmail.modify` — overly broad (allows label changes, marking read/unread). Not needed.
- Restricting to `gmail.readonly` only — would prevent draft creation entirely.
- Using restricted scopes (`gmail.addons.current.message.readonly`) — too narrow, doesn't cover search or listing.

## 2. OAuth2 Flow Architecture

**Decision**: Server-side OAuth2 authorization code flow via a dedicated Express route (`GET /api/v1/auth/gmail` + `GET /api/v1/auth/gmail/callback`).

**Rationale**:
- Follows the same pattern as the existing Google Calendar tool which uses `googleapis` OAuth2 client.
- The existing `.env` already contains `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` — the Calendar tool uses a pre-obtained refresh token. For Gmail, we add a proper OAuth flow endpoint so the user can authorize in-browser.
- Redirect URI: `http://localhost:5001/api/v1/auth/gmail/callback` (must be registered in Google Cloud Console).
- On successful authorization, tokens are written to a JSON config file (`backend/.gmail-tokens.json`), NOT to `.env` (writing to `.env` would require restart; a JSON file can be read dynamically).
- The token file is added to `.gitignore`.

**Alternatives considered**:
- Storing tokens in `.env` — requires server restart after authorization. Poor DX.
- Storing tokens in PostgreSQL — spec explicitly says no database storage for tokens (FR-002, Clarification: "No. Pass-through from Gmail API, no local storage"). A local config file is specified.
- Manual token generation via CLI script (like current Calendar approach) — works but poor UX. The spec requests `GET /api/v1/auth/gmail` endpoint.

## 3. Token Storage & Refresh Strategy

**Decision**: JSON file (`backend/.gmail-tokens.json`) with structure `{ "<userId>": { accessToken, refreshToken, expiryDate, scopes } }`. Keyed by user ID for multi-user readiness (NFR-004).

**Rationale**:
- File-based storage aligns with FR-002: "stored persistently in a local config file."
- Keyed by user ID satisfies NFR-004: "support multiple users without code changes."
- The `EmailService` reads tokens from file on each request (NFR-003: stateless per-request, no in-memory caching).
- Auto-refresh: before each Gmail API call, check `expiryDate`. If expired, use `refreshToken` to obtain new `accessToken`, update the file atomically.
- If refresh fails (revoked token), return clear error: "Gmail authorization expired. Visit GET /api/v1/auth/gmail to re-authorize." (Scenario 1.4).

**Alternatives considered**:
- In-memory token cache with file persistence — would break NFR-003 (stateless per-request). However, reading from file on every tool call is acceptable for single-user local dev.
- Encrypted storage — NFR-002 says "Encryption at rest is not required for local dev."

## 4. Gmail API Client Pattern

**Decision**: Singleton `EmailService` class with per-request OAuth2 client instantiation. Located at `backend/src/services/emailService.ts`.

**Rationale**:
- FR-018 mandates a standalone module encapsulating all Gmail API interactions.
- Per-request OAuth2 client creation ensures fresh tokens and statelessness (NFR-003).
- The service exposes methods: `listEmails()`, `searchEmails()`, `getEmail()`, `createDraft()`, `createReplyDraft()`.
- Each method accepts a `userId` parameter for multi-user readiness.
- The service handles retry logic for 429 errors (FR-016: exponential backoff, max 3 retries).

**Alternatives considered**:
- Static utility functions — doesn't provide the encapsulation FR-018 requires.
- Per-tool Gmail client — would duplicate auth logic across 5 tools. Violates single responsibility.

## 5. Email Body Processing

**Decision**: Use `html-to-text` (already a dependency) for HTML→plaintext conversion. Truncate at 50KB.

**Rationale**:
- `html-to-text` is already in `backend/package.json` (used by `fetchUrl` tool). No new dependency.
- FR-015: HTML-only emails must be converted to plain text.
- FR-014: Emails exceeding 50KB must be truncated with `[truncated]` marker.
- Processing pipeline: raw email → extract `text/plain` part (prefer) → fallback to `text/html` → convert with `html-to-text` → truncate at 50KB.

**Alternatives considered**:
- Custom regex-based HTML stripping — fragile, misses edge cases (tables, encoded entities).
- Sending raw HTML to LLM — wastes tokens, LLM doesn't need HTML formatting.

## 6. Tool Interface Pattern

**Decision**: Follow existing `RunnableTool` interface exactly. Each tool is a separate file exporting a `RunnableTool` instance with Zod schema.

**Rationale**:
- FR-017 mandates following the existing `RunnableTool` interface.
- SC-007 specifies exact file locations: `src/tools/readEmails.ts`, `src/tools/searchEmails.ts`, etc.
- Each tool validates input via Zod, delegates to `EmailService`, and returns formatted string output.
- Tool timeouts per spec: 15s for read/search, 30s for summarize, 10s for draft/reply.

**Pattern** (matches `googleCalendar.ts`):
```
export const readEmails: RunnableTool<z.infer<typeof schema>> = {
  definition: { name, description, input_schema },
  schema,
  timeoutMs: 15000,
  async run(input) { ... }
};
```

## 7. Logging & PII Redaction

**Decision**: Add Gmail-specific redaction paths to pino config. Email tool logs include operation name, duration, result count, user ID — never email content.

**Rationale**:
- FR-013: "Email body content and subjects MUST be redacted from server logs."
- NFR-005: "All Gmail API calls MUST include structured logging."
- Add to existing pino redaction paths: `emailBody`, `emailSubject`, `emailContent`.
- Tool logs use the existing `logger.child({ tool: 'tool_name' })` pattern.

**Alternatives considered**:
- Separate logger for email tools — unnecessary complexity. Pino redaction handles it globally.

## 8. Error Handling for Gmail API

**Decision**: Map Gmail API error codes to `ToolError` messages. Implement exponential backoff for 429s.

**Rationale**:
- FR-016: 429 responses must be handled with exponential backoff (max 3 retries).
- Token errors (401/403) → clear re-authorization message.
- Network errors → generic "Gmail API unavailable" message.
- Follows existing pattern in `googleCalendar.ts` (catch, check error code, throw `ToolError`).

**Backoff strategy**: delays of 1s, 2s, 4s. If all 3 retries exhausted, throw `ToolError` with "Gmail rate limit exceeded. Please try again in a few minutes."

## 9. LLM Summary Generation

**Decision**: The `read_emails` and `search_emails` tools fetch email bodies server-side, generate a one-line summary as part of the tool output, but do NOT include the full body in the tool result (unless `includeBody: true`).

**Rationale**:
- FR-005: tool must return `summary` (AI-generated one-liner).
- FR-012: body content must NOT appear in tool output by default.
- The "AI-generated summary" is produced by the LLM itself during the agentic loop. The tool returns metadata + the Gmail `snippet` field. The LLM sees the snippet and produces a natural language summary in its response.
- This avoids a second LLM call inside the tool (which would be slow, expensive, and architecturally wrong — tools should be pure I/O, not AI).

**Clarification**: The spec says "AI-generated one-line summary" — this is the LLM's natural behavior when given email metadata + snippet. The tool provides `snippet` (Gmail's built-in 200-char preview), and the LLM summarizes. When the user asks to "open" or "read" a specific email, the tool returns the full body via `includeBody`.

**Alternatives considered**:
- Calling the LLM inside the tool to generate summaries — adds latency (each email = 1 LLM call), breaks the architecture (tools are I/O), and is unnecessary since the LLM will summarize naturally.
- Returning full bodies always — wastes tokens, violates FR-012 privacy requirement.
