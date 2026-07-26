# Conversational Gmail Auth Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gmail/Calendar tools return a conversational auth prompt instead of throwing errors when not connected, so the AI guides the user through OAuth naturally.

**Architecture:** Add `AuthRequiredError` and `buildAuthRequiredMessage()` to `emailService.ts`. Update all 6 Google-related tool handlers to catch the missing-auth case and return the message as a successful tool result (not an error). Existing tests that assert `rejects.toThrow` change to assert resolved string output.

**Tech Stack:** TypeScript, Jest, Express

## Global Constraints

- Backend is `strict: true` TypeScript — no `any` types in new code (existing `any` in catch blocks stays)
- All tools return `Promise<string>` per the `RunnableTool` interface — the auth message is a plain string, not a special type
- The auth URL is always `http://localhost:5001/api/v1/auth/gmail` — hardcoded, not dynamically generated
- No frontend changes, no new endpoints, no agentic loop changes

---

### Task 1: Add AuthRequiredError and buildAuthRequiredMessage to EmailService

**Files:**
- Modify: `backend/src/services/emailService.ts:90-121`
- Test: `backend/tests/services/emailService.test.ts`

**Interfaces:**
- Consumes: Nothing new
- Produces:
  - `AuthRequiredError` class (exported) — tools use `instanceof` to detect auth failures
  - `emailService.buildAuthRequiredMessage(): string` — tools call this to get the auth prompt text
  - `emailService.getAuthClient(userId)` now throws `AuthRequiredError` instead of `Error` when tokens missing or expired-and-removed

- [ ] **Step 1: Write failing tests for buildAuthRequiredMessage and AuthRequiredError**

Add these tests to the end of `backend/tests/services/emailService.test.ts`, inside the top-level `describe('EmailService', ...)`:

```typescript
// ─── Auth Required ───

describe('buildAuthRequiredMessage', () => {
  it('returns a string containing the auth URL', () => {
    const message = emailService.buildAuthRequiredMessage();
    expect(message).toContain('http://localhost:5001/api/v1/auth/gmail');
  });

  it('starts with ACTION_REQUIRED prefix', () => {
    const message = emailService.buildAuthRequiredMessage();
    expect(message).toMatch(/^ACTION_REQUIRED:/);
  });

  it('instructs user to notify when done', () => {
    const message = emailService.buildAuthRequiredMessage();
    expect(message).toContain('let me know when you\'re done');
  });
});

describe('getAuthClient throws AuthRequiredError', () => {
  it('throws AuthRequiredError when user has no tokens', async () => {
    const { AuthRequiredError } = await import('../../src/services/emailService');
    await expect(emailService.getAuthClient('no-tokens-user'))
      .rejects.toThrow(AuthRequiredError);
  });

  it('throws AuthRequiredError when refresh fails and tokens are removed', async () => {
    const { AuthRequiredError } = await import('../../src/services/emailService');
    const expired = makeTokenEntry({ expiryDate: Date.now() - 1000 });
    emailService.saveTokens(TEST_USER_ID, expired);
    mockOAuth2Instance.refreshAccessToken.mockRejectedValue(new Error('Token revoked'));

    await expect(emailService.getAuthClient(TEST_USER_ID))
      .rejects.toThrow(AuthRequiredError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest tests/services/emailService.test.ts --verbose`

Expected: The `buildAuthRequiredMessage` tests fail with "emailService.buildAuthRequiredMessage is not a function". The `AuthRequiredError` tests fail because the thrown error is a plain `Error`, not `AuthRequiredError`.

- [ ] **Step 3: Implement AuthRequiredError and buildAuthRequiredMessage**

Add the `AuthRequiredError` class as a named export at the top of `backend/src/services/emailService.ts`, after the imports and before the constants:

```typescript
export class AuthRequiredError extends Error {
  constructor() {
    super('Gmail not connected');
    this.name = 'AuthRequiredError';
  }
}
```

Add the `buildAuthRequiredMessage` method to the `EmailService` class, after the `isConnected` method (around line 76):

```typescript
buildAuthRequiredMessage(): string {
  const authUrl = 'http://localhost:5001/api/v1/auth/gmail';
  return [
    'ACTION_REQUIRED: Gmail is not connected.',
    '',
    'To access your emails and calendar, you need to connect your Google account.',
    `Authorization URL: ${authUrl}`,
    '',
    'Open the link above in your browser, sign in with Google, and grant access.',
    'Then let me know when you\'re done so I can proceed with your request.',
  ].join('\n');
}
```

Update `getAuthClient` to throw `AuthRequiredError`. Change line 93-94 from:

```typescript
if (!entry) {
  throw new Error('Gmail not connected. Visit /api/v1/auth/gmail to authorize.');
}
```

to:

```typescript
if (!entry) {
  throw new AuthRequiredError();
}
```

And change the token refresh failure block (around line 116) from:

```typescript
throw new Error('Gmail authorization expired. Visit /api/v1/auth/gmail to re-authorize.');
```

to:

```typescript
throw new AuthRequiredError();
```

- [ ] **Step 4: Update existing test expectations**

The existing test `'throws when user has no tokens'` in `emailService.test.ts` (line 113) expects the message `'Gmail not connected'`. This still passes because `AuthRequiredError` uses that same message. No change needed.

The existing test `'removes tokens and throws on refresh failure'` (line 143) expects `'Gmail authorization expired'`. This now throws `AuthRequiredError` with message `'Gmail not connected'`. Update the assertion:

Change:
```typescript
await expect(emailService.getAuthClient(TEST_USER_ID))
  .rejects.toThrow('Gmail authorization expired');
```

To:
```typescript
await expect(emailService.getAuthClient(TEST_USER_ID))
  .rejects.toThrow('Gmail not connected');
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest tests/services/emailService.test.ts --verbose`

Expected: All tests pass, including the new ones.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/emailService.ts backend/tests/services/emailService.test.ts
git commit -m "feat: add AuthRequiredError and buildAuthRequiredMessage to EmailService"
```

---

### Task 2: Update Gmail tool handlers to return auth message

**Files:**
- Modify: `backend/src/tools/readEmails.ts:101-119`
- Modify: `backend/src/tools/searchEmails.ts:98-117`
- Modify: `backend/src/tools/summarizeEmails.ts:39-76`
- Modify: `backend/src/tools/draftEmail.ts:37-66`
- Modify: `backend/src/tools/replyEmail.ts:30-60`
- Test: `backend/tests/tools/readEmails.test.ts`
- Test: `backend/tests/tools/draftEmail.test.ts`

**Interfaces:**
- Consumes: `emailService.isConnected(userId): boolean`, `emailService.buildAuthRequiredMessage(): string`, `AuthRequiredError` from Task 1
- Produces: Each tool's `run()` now resolves with the auth message string when not connected (instead of rejecting)

- [ ] **Step 1: Update test expectations in readEmails.test.ts**

In `backend/tests/tools/readEmails.test.ts`, add the import for `AuthRequiredError`:

```typescript
import { emailService, AuthRequiredError } from '../../src/services/emailService';
```

Change the `read_emails` test `'throws when Gmail not connected'` (line 57-59) from:

```typescript
it('throws when Gmail not connected', async () => {
  await expect(readEmails.run({ filter: 'unread', maxResults: 10, includeBody: false }))
    .rejects.toThrow('Gmail not connected');
});
```

to:

```typescript
it('returns auth required message when Gmail not connected', async () => {
  const result = await readEmails.run({ filter: 'unread', maxResults: 10, includeBody: false });
  expect(result).toContain('ACTION_REQUIRED');
  expect(result).toContain('http://localhost:5001/api/v1/auth/gmail');
});
```

Change the `search_emails` test `'throws when Gmail not connected'` (line 88-93) from:

```typescript
it('throws when Gmail not connected', async () => {
  await expect(searchEmails.run({
    maxResults: 10,
    includeBody: false,
    from: 'test@example.com',
  })).rejects.toThrow('Gmail not connected');
});
```

to:

```typescript
it('returns auth required message when Gmail not connected', async () => {
  const result = await searchEmails.run({
    maxResults: 10,
    includeBody: false,
    from: 'test@example.com',
  });
  expect(result).toContain('ACTION_REQUIRED');
  expect(result).toContain('http://localhost:5001/api/v1/auth/gmail');
});
```

- [ ] **Step 2: Update test expectations in draftEmail.test.ts**

In `backend/tests/tools/draftEmail.test.ts`, change the `summarize_emails` test `'throws when Gmail not connected'` (line 50-52) from:

```typescript
it('throws when Gmail not connected', async () => {
  await expect(summarizeEmails.run({ filter: 'unread', maxResults: 50 }))
    .rejects.toThrow('Gmail not connected');
});
```

to:

```typescript
it('returns auth required message when Gmail not connected', async () => {
  const result = await summarizeEmails.run({ filter: 'unread', maxResults: 50 });
  expect(result).toContain('ACTION_REQUIRED');
  expect(result).toContain('http://localhost:5001/api/v1/auth/gmail');
});
```

Change the `draft_email` test `'throws when Gmail not connected'` (line 95-100) from:

```typescript
it('throws when Gmail not connected', async () => {
  await expect(draftEmail.run({
    to: 'test@example.com',
    subject: 'Test',
    body: 'Hello',
  })).rejects.toThrow('Gmail not connected');
});
```

to:

```typescript
it('returns auth required message when Gmail not connected', async () => {
  const result = await draftEmail.run({
    to: 'test@example.com',
    subject: 'Test',
    body: 'Hello',
  });
  expect(result).toContain('ACTION_REQUIRED');
  expect(result).toContain('http://localhost:5001/api/v1/auth/gmail');
});
```

Change the `reply_email` test `'throws when Gmail not connected'` (line 137-139) from:

```typescript
it('throws when Gmail not connected', async () => {
  await expect(replyEmail.run({ emailId: 'msg-123', body: 'Reply' }))
    .rejects.toThrow('Gmail not connected');
});
```

to:

```typescript
it('returns auth required message when Gmail not connected', async () => {
  const result = await replyEmail.run({ emailId: 'msg-123', body: 'Reply' });
  expect(result).toContain('ACTION_REQUIRED');
  expect(result).toContain('http://localhost:5001/api/v1/auth/gmail');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx jest tests/tools/ --verbose`

Expected: All 5 "returns auth required message" tests fail because the tools still throw `ToolError`.

- [ ] **Step 4: Update readEmails.ts**

In `backend/src/tools/readEmails.ts`, add `AuthRequiredError` to the import:

```typescript
import { emailService, AuthRequiredError } from '../services/emailService';
```

Replace the `run` method body (lines 101-121):

```typescript
async run({ filter, maxResults, dateRange, includeBody }) {
  const userId = '00000000-0000-0000-0000-000000000001';

  if (!emailService.isConnected(userId)) {
    return emailService.buildAuthRequiredMessage();
  }

  try {
    log.info({ filter, maxResults, includeBody }, 'Reading emails');
    const result = await emailService.listEmails(userId, filter, maxResults, dateRange, includeBody);
    log.info({ returnedCount: result.returnedCount, totalCount: result.totalCount }, 'Emails fetched');
    return formatEmailList(result.emails, result.totalCount, filter);
  } catch (err: any) {
    log.error({ err }, 'Failed to read emails');
    if (err instanceof AuthRequiredError) {
      return emailService.buildAuthRequiredMessage();
    }
    throw new ToolError(`Failed to read emails: ${err.message}`);
  }
},
```

- [ ] **Step 5: Update searchEmails.ts**

In `backend/src/tools/searchEmails.ts`, add `AuthRequiredError` to the import:

```typescript
import { emailService, AuthRequiredError } from '../services/emailService';
```

Replace the `run` method body (lines 98-118):

```typescript
async run(input) {
  const userId = '00000000-0000-0000-0000-000000000001';

  if (!emailService.isConnected(userId)) {
    return emailService.buildAuthRequiredMessage();
  }

  try {
    log.info({ from: input.from, subject: input.subject, keywords: input.keywords }, 'Searching emails');
    const result = await emailService.searchEmails(userId, input);
    log.info({ returnedCount: result.returnedCount, totalCount: result.totalCount }, 'Search complete');
    return formatSearchResults(result.emails, result.totalCount);
  } catch (err: any) {
    log.error({ err }, 'Failed to search emails');
    if (err instanceof AuthRequiredError) {
      return emailService.buildAuthRequiredMessage();
    }
    throw new ToolError(`Failed to search emails: ${err.message}`);
  }
},
```

- [ ] **Step 6: Update summarizeEmails.ts**

In `backend/src/tools/summarizeEmails.ts`, add `AuthRequiredError` to the import:

```typescript
import { emailService, AuthRequiredError } from '../services/emailService';
```

Replace the `run` method body (lines 39-76):

```typescript
async run({ filter, maxResults }) {
  const userId = '00000000-0000-0000-0000-000000000001';

  if (!emailService.isConnected(userId)) {
    return emailService.buildAuthRequiredMessage();
  }

  try {
    log.info({ filter, maxResults }, 'Fetching emails for summarization');
    const result = await emailService.listEmails(userId, filter, maxResults);

    if (result.emails.length === 0) {
      return `No ${filter === 'all' ? '' : filter + ' '}emails found to summarize.`;
    }

    const items = result.emails.map((email, i) => {
      const fromStr = email.from.name
        ? `${email.from.name} <${email.from.address}>`
        : email.from.address;
      let entry = `${i + 1}. From: ${fromStr} | Subject: ${email.subject} | Date: ${email.date}`;
      entry += `\n   Snippet: ${email.snippet}`;
      if (email.labels && email.labels.length > 0) {
        entry += `\n   Labels: ${email.labels.join(', ')}`;
      }
      return entry;
    });

    log.info({ emailCount: result.emails.length }, 'Emails fetched for summarization');
    return `Fetched ${result.emails.length} emails for summarization:\n\n${items.join('\n\n')}`;
  } catch (err: any) {
    log.error({ err }, 'Failed to fetch emails for summarization');
    if (err instanceof AuthRequiredError) {
      return emailService.buildAuthRequiredMessage();
    }
    throw new ToolError(`Failed to summarize emails: ${err.message}`);
  }
},
```

- [ ] **Step 7: Update draftEmail.ts**

In `backend/src/tools/draftEmail.ts`, add `AuthRequiredError` to the import:

```typescript
import { emailService, AuthRequiredError } from '../services/emailService';
```

Replace the `run` method body (lines 37-66):

```typescript
async run(input) {
  const userId = '00000000-0000-0000-0000-000000000001';

  if (!emailService.isConnected(userId)) {
    return emailService.buildAuthRequiredMessage();
  }

  try {
    log.info({ to: input.to }, 'Creating email draft');
    const result = await emailService.createDraft(userId, input);
    log.info({ draftId: result.draftId }, 'Draft created');

    return [
      'Draft saved to Gmail.',
      `  To: ${result.to}`,
      `  Subject: ${result.subject}`,
      `  Preview: ${result.bodyPreview}`,
      `  Draft ID: ${result.draftId}`,
      '',
      'Open Gmail to review and send.',
    ].join('\n');
  } catch (err: any) {
    log.error({ err }, 'Failed to create draft');
    if (err instanceof AuthRequiredError) {
      return emailService.buildAuthRequiredMessage();
    }
    throw new ToolError(`Failed to create draft: ${err.message}`);
  }
},
```

- [ ] **Step 8: Update replyEmail.ts**

In `backend/src/tools/replyEmail.ts`, add `AuthRequiredError` to the import:

```typescript
import { emailService, AuthRequiredError } from '../services/emailService';
```

Replace the `run` method body (lines 30-60):

```typescript
async run({ emailId, body }) {
  const userId = '00000000-0000-0000-0000-000000000001';

  if (!emailService.isConnected(userId)) {
    return emailService.buildAuthRequiredMessage();
  }

  try {
    log.info({ emailId }, 'Creating reply draft');
    const result = await emailService.createReplyDraft(userId, emailId, body);
    log.info({ draftId: result.draftId, threadId: result.threadId }, 'Reply draft created');

    return [
      'Reply draft saved to Gmail.',
      `  Thread: ${result.subject}`,
      `  To: ${result.to}`,
      `  Preview: ${result.bodyPreview}`,
      `  Draft ID: ${result.draftId}`,
      '',
      'Open Gmail to review and send.',
    ].join('\n');
  } catch (err: any) {
    log.error({ err }, 'Failed to create reply draft');
    if (err instanceof AuthRequiredError) {
      return emailService.buildAuthRequiredMessage();
    }
    throw new ToolError(`Failed to create reply: ${err.message}`);
  }
},
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd backend && npx jest tests/tools/ --verbose`

Expected: All tests pass. The 5 "returns auth required message" tests now resolve with the auth message string.

- [ ] **Step 10: Commit**

```bash
git add backend/src/tools/readEmails.ts backend/src/tools/searchEmails.ts backend/src/tools/summarizeEmails.ts backend/src/tools/draftEmail.ts backend/src/tools/replyEmail.ts backend/tests/tools/readEmails.test.ts backend/tests/tools/draftEmail.test.ts
git commit -m "feat: Gmail tools return auth prompt instead of throwing on missing auth"
```

---

### Task 3: Update Google Calendar tool to return auth message

**Files:**
- Modify: `backend/src/tools/googleCalendar.ts:106-113`
- Create: `backend/tests/tools/googleCalendar.test.ts`

**Interfaces:**
- Consumes: `emailService.isConnected(userId): boolean`, `emailService.buildAuthRequiredMessage(): string`, `AuthRequiredError` from Task 1
- Produces: `googleCalendar.run()` resolves with auth message string when not connected

- [ ] **Step 1: Write failing test for googleCalendar auth behavior**

Create `backend/tests/tools/googleCalendar.test.ts`:

```typescript
jest.mock('@googleapis/gmail', () => ({
  gmail: jest.fn(() => ({
    users: {
      messages: { list: jest.fn(), get: jest.fn() },
      drafts: { create: jest.fn() },
    },
  })),
}));

jest.mock('@googleapis/calendar', () => ({
  calendar: jest.fn(() => ({
    events: { list: jest.fn() },
    freebusy: { query: jest.fn() },
  })),
}));

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => ({ setCredentials: jest.fn(), refreshAccessToken: jest.fn() })),
}));

import fs from 'fs';
import path from 'path';
import { googleCalendar } from '../../src/tools/googleCalendar';

const TOKEN_FILE = path.join(__dirname, '../../.gmail-tokens.json');

function cleanupTokenFile() {
  try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
}

describe('google_calendar tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cleanupTokenFile();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterAll(() => cleanupTokenFile());

  it('has correct definition', () => {
    expect(googleCalendar.definition.name).toBe('google_calendar');
    expect(googleCalendar.timeoutMs).toBe(10000);
  });

  it('returns auth required message when not connected', async () => {
    const result = await googleCalendar.run({ action: 'list' });
    expect(result).toContain('ACTION_REQUIRED');
    expect(result).toContain('http://localhost:5001/api/v1/auth/gmail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/tools/googleCalendar.test.ts --verbose`

Expected: The "returns auth required message" test fails because `googleCalendar.run()` throws a `ToolError` instead of resolving.

- [ ] **Step 3: Update googleCalendar.ts**

In `backend/src/tools/googleCalendar.ts`, add `AuthRequiredError` to the import:

```typescript
import { emailService, AuthRequiredError } from '../services/emailService';
```

Replace the auth block at the start of the `run` method (lines 106-113). Change:

```typescript
let auth;
try {
  auth = await emailService.getAuthClient(DEV_USER_ID);
} catch {
  throw new ToolError(
    'Google Calendar not connected. Visit http://localhost:5001/api/v1/auth/gmail to authorize.',
  );
}
```

to:

```typescript
if (!emailService.isConnected(DEV_USER_ID)) {
  return emailService.buildAuthRequiredMessage();
}

let auth;
try {
  auth = await emailService.getAuthClient(DEV_USER_ID);
} catch (err) {
  if (err instanceof AuthRequiredError) {
    return emailService.buildAuthRequiredMessage();
  }
  throw new ToolError(`Google Calendar authentication failed: ${(err as Error).message}`);
}
```

Also update the catch block at the bottom of the `run` method (line 189-196). Change:

```typescript
if (error.code === 401 || error.message?.includes('Invalid credentials')) {
  throw new ToolError('Google Calendar authentication failed. Re-run the setup script.');
}
```

to:

```typescript
if (error instanceof AuthRequiredError) {
  return emailService.buildAuthRequiredMessage();
}
if (error.code === 401 || error.message?.includes('Invalid credentials')) {
  throw new ToolError('Google Calendar authentication failed. Please re-authorize.');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest tests/tools/googleCalendar.test.ts --verbose`

Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

Run: `cd backend && npx jest --verbose`

Expected: All tests pass across all test files.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tools/googleCalendar.ts backend/tests/tools/googleCalendar.test.ts
git commit -m "feat: Calendar tool returns auth prompt instead of throwing on missing auth"
```
