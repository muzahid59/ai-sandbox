# Data Model: Gmail Automation Agent

## Overview

This feature does NOT add database models. All email data is pass-through from the Gmail API (no local storage). The data model defines TypeScript interfaces used internally by the `EmailService` and tool layer.

## Entities

### 1. GmailTokens

Persisted in `backend/.gmail-tokens.json`. Keyed by user ID.

```typescript
interface GmailTokenStore {
  [userId: string]: GmailTokenEntry;
}

interface GmailTokenEntry {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;        // Unix timestamp (ms)
  scopes: string[];          // e.g. ['gmail.readonly', 'gmail.compose']
  email: string;             // Gmail address for display
  obtainedAt: string;        // ISO 8601 timestamp
}
```

**Storage**: JSON file on disk (`backend/.gmail-tokens.json`).
**Lifecycle**: Created on OAuth callback, updated on token refresh, deleted on user-initiated disconnect.
**Validation**: `accessToken` and `refreshToken` must be non-empty strings. `expiryDate` must be a positive number.

### 2. EmailSummary

Returned by `read_emails`, `search_emails`, and `summarize_emails` tools.

```typescript
interface EmailSummary {
  id: string;                // Gmail message ID
  threadId: string;          // Gmail thread ID
  from: {
    name: string;            // Sender display name
    address: string;         // Sender email address
  };
  to: string[];              // Recipient addresses
  subject: string;           // Email subject line
  date: string;              // ISO 8601 timestamp
  snippet: string;           // Gmail's built-in ~200 char preview
  isUnread: boolean;         // Based on UNREAD label
  hasAttachments: boolean;   // True if any MIME parts are attachments
  attachments?: AttachmentMeta[];  // Present only if hasAttachments
  body?: string;             // Full plain-text body (only when includeBody=true)
}

interface AttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;              // Bytes
}
```

**Source**: Constructed from Gmail API `users.messages.get` response.
**No persistence**: Ephemeral, returned directly in tool output.

### 3. EmailDraft

Input to `draft_email` and `reply_email` tools. Represents a draft to be created in Gmail.

```typescript
interface EmailDraft {
  to: string;                // Recipient email address
  subject: string;           // Subject line
  body: string;              // Plain text body
  cc?: string;               // CC addresses (comma-separated)
  bcc?: string;              // BCC addresses (comma-separated)
}

interface ReplyDraft {
  emailId: string;           // Gmail message ID being replied to
  body: string;              // Reply body text
}
```

**Lifecycle**: Constructed from tool input, used to create Gmail draft via API, then discarded.

### 4. DraftResult

Returned by `draft_email` and `reply_email` tools after successful draft creation.

```typescript
interface DraftResult {
  draftId: string;           // Gmail draft ID
  threadId: string;          // Gmail thread ID (for replies)
  to: string;                // Recipient
  subject: string;           // Subject line
  bodyPreview: string;       // First 200 chars of body
}
```

### 5. EmailListResult

Wrapper for paginated email results.

```typescript
interface EmailListResult {
  emails: EmailSummary[];
  totalCount: number;        // Total matching emails (not just returned page)
  returnedCount: number;     // Number returned in this response
}
```

## Relationships

```
GmailTokenStore
  └── [userId] → GmailTokenEntry (1:1 per user)

EmailService (runtime)
  ├── uses GmailTokenEntry for auth
  ├── returns EmailSummary[] for read/search
  ├── accepts EmailDraft / ReplyDraft for compose
  └── returns DraftResult for compose confirmation

Tools (read_emails, search_emails, etc.)
  └── delegate to EmailService
  └── format results as string for tool output
```

## State Transitions

### OAuth Token Lifecycle

```
[No Token] → OAuth Flow → [Active Token] → Expired → [Auto-Refresh] → [Active Token]
                                                  → Refresh Failed → [Re-auth Required]
                          [Active Token] → User Revokes → [Re-auth Required]
```

### Email Tool Data Flow

```
Tool Input (Zod-validated) → EmailService method → Gmail API call → Raw Response
  → Parse to EmailSummary/DraftResult → Format as string → Tool Output
```

No data is cached or stored between requests. Each tool call is a fresh Gmail API round-trip.
