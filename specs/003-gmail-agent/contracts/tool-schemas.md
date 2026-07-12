# Contract: Gmail Tool Schemas

All tools follow the `RunnableTool` interface defined in `backend/src/tools/types.ts`.

---

## read_emails

**File**: `backend/src/tools/readEmails.ts`
**Timeout**: 15,000ms

**Input schema** (Zod + JSON Schema):

```typescript
z.object({
  filter: z.enum(['unread', 'read', 'all']).default('unread')
    .describe('Filter emails by read status'),
  maxResults: z.number().int().min(1).max(50).default(20)
    .describe('Maximum number of emails to return'),
  dateRange: z.object({
    after: z.string().optional().describe('Start date (ISO 8601 or YYYY-MM-DD)'),
    before: z.string().optional().describe('End date (ISO 8601 or YYYY-MM-DD)'),
  }).optional().describe('Filter by date range'),
  includeBody: z.boolean().default(false)
    .describe('Include full email body text (default: metadata + snippet only)'),
})
```

**JSON Schema** (for tool definition):

```json
{
  "type": "object",
  "properties": {
    "filter": {
      "type": "string",
      "enum": ["unread", "read", "all"],
      "description": "Filter emails by read status. Default: unread."
    },
    "maxResults": {
      "type": "number",
      "description": "Maximum emails to return (1-50). Default: 20."
    },
    "dateRange": {
      "type": "object",
      "properties": {
        "after": { "type": "string", "description": "Start date (ISO 8601)" },
        "before": { "type": "string", "description": "End date (ISO 8601)" }
      },
      "description": "Optional date range filter."
    },
    "includeBody": {
      "type": "boolean",
      "description": "Include full email body. Default: false."
    }
  }
}
```

**Output format** (string):

```
Found 5 unread emails (5 of 12 total):

1. From: John Doe <john@example.com>
   Subject: Q3 Report Review
   Date: 2026-07-12 10:30 AM
   Snippet: Please review the attached Q3 report by Friday...
   Attachments: report.pdf (2.1 MB)

2. From: ...
```

When `includeBody: true`:
```
Email from John Doe <john@example.com>
Subject: Q3 Report Review
Date: 2026-07-12 10:30 AM

Body:
Hi team,

Please review the attached Q3 report by Friday...
[truncated at 50KB]

Attachments: report.pdf (2.1 MB)
```

---

## search_emails

**File**: `backend/src/tools/searchEmails.ts`
**Timeout**: 15,000ms

**Input schema**:

```typescript
z.object({
  from: z.string().optional().describe('Sender email address or name'),
  to: z.string().optional().describe('Recipient email address'),
  subject: z.string().optional().describe('Subject line keyword'),
  keywords: z.string().optional().describe('Search keywords in email body'),
  dateRange: z.object({
    after: z.string().optional().describe('Start date (ISO 8601 or YYYY-MM-DD)'),
    before: z.string().optional().describe('End date (ISO 8601 or YYYY-MM-DD)'),
  }).optional().describe('Filter by date range'),
  hasAttachment: z.boolean().optional().describe('Filter for emails with attachments'),
  maxResults: z.number().int().min(1).max(50).default(20)
    .describe('Maximum results to return'),
  includeBody: z.boolean().default(false)
    .describe('Include full email body text'),
})
```

**Query construction**: The tool constructs Gmail search queries from parameters:
- `from` → `from:value`
- `to` → `to:value`
- `subject` → `subject:value`
- `keywords` → raw search terms
- `dateRange.after` → `after:YYYY/MM/DD`
- `dateRange.before` → `before:YYYY/MM/DD`
- `hasAttachment` → `has:attachment`

**Output format**: Same as `read_emails`.

---

## summarize_emails

**File**: `backend/src/tools/summarizeEmails.ts`
**Timeout**: 30,000ms

**Input schema**:

```typescript
z.object({
  filter: z.enum(['unread', 'read', 'all']).default('unread')
    .describe('Which emails to summarize'),
  maxResults: z.number().int().min(1).max(50).default(50)
    .describe('Maximum emails to process for summary'),
})
```

**Output format** (string — raw data for LLM to categorize):

```
Fetched 30 emails for summarization:

1. From: boss@company.com | Subject: Action Required: Budget Approval | Date: 2026-07-12
   Snippet: Please approve the Q3 budget by EOD...
   Labels: IMPORTANT, UNREAD

2. From: newsletter@tech.com | Subject: Weekly Tech Digest | Date: 2026-07-12
   Snippet: This week in tech: AI advances...
   Labels: CATEGORY_PROMOTIONS, UNREAD

...
```

The LLM receives this raw list and produces the categorized summary in its response.

---

## draft_email

**File**: `backend/src/tools/draftEmail.ts`
**Timeout**: 10,000ms

**Input schema**:

```typescript
z.object({
  to: z.string().email().describe('Recipient email address'),
  subject: z.string().min(1).describe('Email subject line'),
  body: z.string().min(1).describe('Email body text'),
  cc: z.string().optional().describe('CC email addresses (comma-separated)'),
  bcc: z.string().optional().describe('BCC email addresses (comma-separated)'),
})
```

**Output format**:

```
Draft saved to Gmail.
  To: john@example.com
  Subject: Meeting Rescheduled to Friday
  Preview: Hi John, I wanted to let you know that our meeting has been rescheduled to Friday at 2 PM...
  Draft ID: r1234567890

Open Gmail to review and send.
```

---

## reply_email

**File**: `backend/src/tools/replyEmail.ts`
**Timeout**: 10,000ms

**Input schema**:

```typescript
z.object({
  emailId: z.string().min(1).describe('Gmail message ID of the email to reply to'),
  body: z.string().min(1).describe('Reply body text'),
})
```

**Output format**:

```
Reply draft saved to Gmail.
  Thread: Re: Q3 Report Review
  To: john@example.com
  Preview: Thanks for the report, John. I've reviewed it and have a few suggestions...
  Draft ID: r9876543210

Open Gmail to review and send.
```

**Threading**: The tool fetches the original email to extract `Message-ID`, `References`, and `threadId`. The draft is created with:
- `threadId`: original email's threadId
- `In-Reply-To` header: original email's `Message-ID`
- `References` header: original email's `References` + `Message-ID`
- Subject: `Re: <original subject>` (if not already prefixed)
