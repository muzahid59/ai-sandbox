# Google Calendar Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `google_calendar` tool so the AI can list events, search events, and check free/busy status from the user's Google Calendar.

**Architecture:** The tool uses the `googleapis` npm package to call Google Calendar API with OAuth2 credentials from env vars. It follows the existing tool pattern (export `definition` + `handler`, register in `tools/index.ts`). A one-time setup script helps generate the refresh token.

**Tech Stack:** googleapis, TypeScript, Jest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/package.json` | Modify | Add `googleapis` dependency |
| `backend/.env.example` | Modify | Add Google OAuth env vars |
| `backend/scripts/google-auth.js` | Create | One-time OAuth setup script |
| `backend/src/tools/googleCalendar.ts` | Create | Tool definition + handler with list/search/busy actions |
| `backend/src/tools/index.ts` | Modify | Register google_calendar tool |
| `backend/tests/tools/googleCalendar.test.ts` | Create | Unit tests for all actions and error paths |

---

### Task 1: Install googleapis and Add Env Vars

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/.env.example`
- Modify: `backend/.env`

- [ ] **Step 1: Install googleapis**

Run: `cd backend && npm install googleapis`

- [ ] **Step 2: Verify installation**

Run: `cd backend && node -e "const { google } = require('googleapis'); console.log('googleapis loaded, calendar API:', typeof google.calendar)"`

Expected: `googleapis loaded, calendar API: function`

- [ ] **Step 3: Add env vars to .env.example**

Append to `backend/.env.example`:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
```

- [ ] **Step 4: Add env vars to .env**

Append to `backend/.env`:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
```

(User fills these in after running the setup script in Task 2.)

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/.env.example
git commit -m "Add googleapis dependency and Google OAuth env vars"
```

Note: Do NOT commit `backend/.env`.

---

### Task 2: Create OAuth Setup Script

**Files:**
- Create: `backend/scripts/google-auth.js`

- [ ] **Step 1: Create the setup script**

Create `backend/scripts/google-auth.js`:

```javascript
#!/usr/bin/env node

/**
 * One-time setup script to generate a Google OAuth2 refresh token.
 *
 * Prerequisites:
 *   1. Create a project at https://console.cloud.google.com
 *   2. Enable the Google Calendar API
 *   3. Create OAuth credentials (Desktop app type)
 *   4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env
 *
 * Usage:
 *   cd backend && node scripts/google-auth.js
 *
 * The script will:
 *   1. Open your browser to the Google consent screen
 *   2. Ask you to paste the authorization code
 *   3. Print the refresh token to add to your .env file
 */

require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env first.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar.readonly'],
  prompt: 'consent',
});

console.log('\n=== Google Calendar OAuth Setup ===\n');
console.log('Opening browser for authorization...\n');

// Open browser
const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
require('child_process').exec(`${open} "${authUrl}"`);

// Start local server to capture the callback
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/callback')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost:3333');
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('Missing authorization code');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Success!</h1><p>You can close this tab and return to the terminal.</p>');

    console.log('\nSuccess! Add this to your backend/.env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    server.close();
    process.exit(0);
  } catch (error) {
    res.writeHead(500);
    res.end('Failed to exchange code for token');
    console.error('Error exchanging code:', error.message);
    server.close();
    process.exit(1);
  }
});

server.listen(3333, () => {
  console.log('Waiting for authorization callback on http://localhost:3333/callback ...\n');
  console.log('If the browser did not open, visit this URL manually:');
  console.log(authUrl + '\n');
});
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x backend/scripts/google-auth.js`

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/google-auth.js
git commit -m "Add Google Calendar OAuth setup script"
```

---

### Task 3: Implement google_calendar Tool

**Files:**
- Create: `backend/src/tools/googleCalendar.ts`
- Create: `backend/tests/tools/googleCalendar.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/tools/googleCalendar.test.ts`:

```typescript
import { handler } from '../../src/tools/googleCalendar';

// Mock googleapis
jest.mock('googleapis', () => {
  const mockEventsList = jest.fn();
  const mockFreebusyQuery = jest.fn();
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({
          setCredentials: jest.fn(),
        })),
      },
      calendar: jest.fn().mockReturnValue({
        events: { list: mockEventsList },
        freebusy: { query: mockFreebusyQuery },
      }),
    },
    __mockEventsList: mockEventsList,
    __mockFreebusyQuery: mockFreebusyQuery,
  };
});

const { __mockEventsList: mockEventsList, __mockFreebusyQuery: mockFreebusyQuery } =
  jest.requireMock('googleapis');

describe('google_calendar handler', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_REFRESH_TOKEN: 'test-refresh-token',
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns error when credentials are missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    const result = await handler({ action: 'list' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('not configured');
  });

  it('returns error for invalid action', async () => {
    const result = await handler({ action: 'delete' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown action');
  });

  it('returns error when action is missing', async () => {
    const result = await handler({});

    expect(result.success).toBe(false);
    expect(result.output).toContain('Missing');
  });

  describe('list action', () => {
    it('lists events with formatted output', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Team Standup',
              start: { dateTime: '2026-04-13T10:00:00+06:00' },
              end: { dateTime: '2026-04-13T10:30:00+06:00' },
              location: 'Google Meet',
            },
            {
              summary: 'Sprint Planning',
              start: { dateTime: '2026-04-13T14:00:00+06:00' },
              end: { dateTime: '2026-04-13T15:00:00+06:00' },
              description: 'Review backlog',
            },
          ],
        },
      });

      const result = await handler({
        action: 'list',
        start_date: '2026-04-13T00:00:00',
        end_date: '2026-04-14T00:00:00',
        timezone: 'Asia/Dhaka',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Found 2 events');
      expect(result.output).toContain('Team Standup');
      expect(result.output).toContain('Google Meet');
      expect(result.output).toContain('Sprint Planning');
      expect(result.output).toContain('Review backlog');
    });

    it('handles all-day events', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Company Holiday',
              start: { date: '2026-04-13' },
              end: { date: '2026-04-14' },
            },
          ],
        },
      });

      const result = await handler({ action: 'list' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Company Holiday');
      expect(result.output).toContain('All day');
    });

    it('returns message when no events found', async () => {
      mockEventsList.mockResolvedValue({ data: { items: [] } });

      const result = await handler({ action: 'list' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No events found');
    });
  });

  describe('search action', () => {
    it('returns error when query is missing', async () => {
      const result = await handler({ action: 'search' });

      expect(result.success).toBe(false);
      expect(result.output).toContain("Missing 'query'");
    });

    it('searches events by keyword', async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              summary: 'Sprint Planning',
              start: { dateTime: '2026-04-13T14:00:00+06:00' },
              end: { dateTime: '2026-04-13T15:00:00+06:00' },
            },
          ],
        },
      });

      const result = await handler({ action: 'search', query: 'sprint' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Sprint Planning');
      expect(mockEventsList).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'sprint' }),
      );
    });
  });

  describe('busy action', () => {
    it('returns free/busy blocks', async () => {
      mockFreebusyQuery.mockResolvedValue({
        data: {
          calendars: {
            primary: {
              busy: [
                { start: '2026-04-13T10:00:00+06:00', end: '2026-04-13T10:30:00+06:00' },
                { start: '2026-04-13T14:00:00+06:00', end: '2026-04-13T15:00:00+06:00' },
              ],
            },
          },
        },
      });

      const result = await handler({
        action: 'busy',
        start_date: '2026-04-13T09:00:00',
        end_date: '2026-04-13T17:00:00',
        timezone: 'Asia/Dhaka',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Busy:');
      expect(result.output).toContain('Free:');
    });
  });

  it('handles API errors gracefully', async () => {
    mockEventsList.mockRejectedValue({ message: 'Invalid credentials', code: 401 });

    const result = await handler({ action: 'list' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('authentication failed');
  });

  it('handles generic API errors', async () => {
    mockEventsList.mockRejectedValue(new Error('Network error'));

    const result = await handler({ action: 'list' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Google Calendar error');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest tests/tools/googleCalendar.test.ts --verbose`

Expected: FAIL — `Cannot find module '../../src/tools/googleCalendar'`

- [ ] **Step 3: Implement the google_calendar tool**

Create `backend/src/tools/googleCalendar.ts`:

```typescript
import { google } from 'googleapis';
import { ToolDefinition, ToolResult } from '../types';
import logger from '../config/logger';

const log = logger.child({ tool: 'google_calendar' });

export const definition: ToolDefinition = {
  name: 'google_calendar',
  description:
    'Read events from Google Calendar. Use when the user asks about their schedule, upcoming meetings, availability, or calendar events.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Action to perform: "list" (events in date range), "search" (events by keyword), "busy" (free/busy status)',
      },
      start_date: {
        type: 'string',
        description: 'Start date in ISO 8601 format (e.g. "2026-04-13T00:00:00"). Defaults to today.',
      },
      end_date: {
        type: 'string',
        description: 'End date in ISO 8601 format. Defaults to start_date + 1 day.',
      },
      query: {
        type: 'string',
        description: 'Search keyword. Used with "search" action.',
      },
      timezone: {
        type: 'string',
        description: 'IANA timezone (e.g. "Asia/Dhaka", "America/New_York"). Defaults to Asia/Dhaka.',
      },
    },
    required: ['action'],
  },
  timeoutMs: 10000,
};

function getAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

function getDateRange(input: Record<string, unknown>, defaultDays: number): { start: string; end: string } {
  const timezone = (input.timezone as string) || 'Asia/Dhaka';
  const now = new Date();

  let start: Date;
  if (input.start_date) {
    start = new Date(input.start_date as string);
  } else {
    start = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    start.setHours(0, 0, 0, 0);
  }

  let end: Date;
  if (input.end_date) {
    end = new Date(input.end_date as string);
  } else {
    end = new Date(start);
    end.setDate(end.getDate() + defaultDays);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

function formatTime(dateTime: string | undefined, date: string | undefined, timezone: string): string {
  if (date) {
    return 'All day';
  }
  if (!dateTime) {
    return 'Unknown time';
  }
  return new Date(dateTime).toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

interface CalendarEvent {
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
}

function formatEvents(events: CalendarEvent[], timezone: string): string {
  if (!events || events.length === 0) {
    return '';
  }

  return events
    .map((event, i) => {
      const startStr = formatTime(event.start?.dateTime, event.start?.date, timezone);
      const endStr = formatTime(event.end?.dateTime, event.end?.date, timezone);
      const when = startStr === 'All day' ? 'All day' : `${startStr} - ${endStr}`;

      let entry = `${i + 1}. ${event.summary || '(No title)'}\n   When: ${when}`;
      if (event.location) entry += `\n   Location: ${event.location}`;
      if (event.description) entry += `\n   Description: ${event.description}`;
      return entry;
    })
    .join('\n\n');
}

async function listEvents(
  calendar: any,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const timezone = (input.timezone as string) || 'Asia/Dhaka';
  const { start, end } = getDateRange(input, 1);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start,
    timeMax: end,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
    timeZone: timezone,
  });

  const events = response.data.items || [];
  if (events.length === 0) {
    return { success: true, output: `No events found between ${start} and ${end}` };
  }

  const formatted = formatEvents(events, timezone);
  return { success: true, output: `Found ${events.length} events:\n\n${formatted}` };
}

async function searchEvents(
  calendar: any,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const query = input.query as string;
  if (!query) {
    return { success: false, output: "Missing 'query' parameter for search action" };
  }

  const timezone = (input.timezone as string) || 'Asia/Dhaka';
  const { start, end } = getDateRange(input, 30);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: start,
    timeMax: end,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
    q: query,
    timeZone: timezone,
  });

  const events = response.data.items || [];
  if (events.length === 0) {
    return { success: true, output: `No events found matching "${query}"` };
  }

  const formatted = formatEvents(events, timezone);
  return { success: true, output: `Found ${events.length} events matching "${query}":\n\n${formatted}` };
}

async function checkBusy(
  calendar: any,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const timezone = (input.timezone as string) || 'Asia/Dhaka';
  const { start, end } = getDateRange(input, 1);

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: start,
      timeMax: end,
      timeZone: timezone,
      items: [{ id: 'primary' }],
    },
  });

  const busySlots = response.data.calendars?.primary?.busy || [];
  const rangeStart = new Date(start);
  const rangeEnd = new Date(end);

  const formatBlock = (dt: Date) =>
    dt.toLocaleString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  const dateLabel = rangeStart.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  if (busySlots.length === 0) {
    return { success: true, output: `Free/busy for ${dateLabel}:\n\nFree: ${formatBlock(rangeStart)} - ${formatBlock(rangeEnd)} (entirely free)` };
  }

  const blocks: string[] = [];
  let cursor = rangeStart;

  for (const slot of busySlots) {
    const busyStart = new Date(slot.start);
    const busyEnd = new Date(slot.end);

    if (cursor < busyStart) {
      blocks.push(`Free: ${formatBlock(cursor)} - ${formatBlock(busyStart)}`);
    }
    blocks.push(`Busy: ${formatBlock(busyStart)} - ${formatBlock(busyEnd)}`);
    cursor = busyEnd;
  }

  if (cursor < rangeEnd) {
    blocks.push(`Free: ${formatBlock(cursor)} - ${formatBlock(rangeEnd)}`);
  }

  return { success: true, output: `Free/busy for ${dateLabel}:\n\n${blocks.join('\n')}` };
}

export async function handler(input: Record<string, unknown>): Promise<ToolResult> {
  const action = input.action as string;
  if (!action || typeof action !== 'string') {
    return { success: false, output: 'Missing or invalid "action" parameter' };
  }

  const auth = getAuthClient();
  if (!auth) {
    return {
      success: false,
      output:
        'Google Calendar not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN to backend/.env',
    };
  }

  const calendar = google.calendar({ version: 'v3', auth });

  try {
    switch (action) {
      case 'list':
        return await listEvents(calendar, input);
      case 'search':
        return await searchEvents(calendar, input);
      case 'busy':
        return await checkBusy(calendar, input);
      default:
        return { success: false, output: `Unknown action: "${action}". Use: list, search, busy.` };
    }
  } catch (error: any) {
    log.error({ err: error, action }, 'Google Calendar API failed');

    if (error.code === 401 || error.message?.includes('Invalid credentials')) {
      return {
        success: false,
        output: 'Google Calendar authentication failed. Re-run the setup script to generate a new refresh token.',
      };
    }

    return { success: false, output: `Google Calendar error: ${error.message}` };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest tests/tools/googleCalendar.test.ts --verbose`

Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/tools/googleCalendar.ts backend/tests/tools/googleCalendar.test.ts
git commit -m "Add google_calendar tool with tests"
```

---

### Task 4: Register the Tool

**Files:**
- Modify: `backend/src/tools/index.ts`

- [ ] **Step 1: Update tools/index.ts**

Replace `backend/src/tools/index.ts`:

```typescript
import { toolRegistry } from '../services/toolRegistry';
import * as calculator from './calculator';
import * as webSearch from './webSearch';
import * as fetchUrl from './fetchUrl';
import * as googleCalendar from './googleCalendar';

export function registerAllTools(): void {
  toolRegistry.register(calculator.definition, calculator.handler);
  toolRegistry.register(webSearch.definition, webSearch.handler);
  toolRegistry.register(fetchUrl.definition, fetchUrl.handler);
  toolRegistry.register(googleCalendar.definition, googleCalendar.handler);
}
```

- [ ] **Step 2: Run full test suite**

Run: `cd backend && npx jest --verbose`

Expected: All tests pass (existing + new google_calendar tests).

- [ ] **Step 3: Commit**

```bash
git add backend/src/tools/index.ts
git commit -m "Register google_calendar tool"
```

---

### Task 5: Docker Verification

**Files:** None (verification only)

- [ ] **Step 1: Rebuild backend container**

Run: `docker-compose rm -sf backend && docker-compose up --build -d backend`

Note: Remove the backend container first to clear the anonymous `node_modules` volume so `googleapis` is installed fresh.

- [ ] **Step 2: Verify tool is registered**

Run: `sleep 10 && docker-compose logs backend --tail 10 2>/dev/null`

Expected: Startup log shows `tools: ["calculator", "web_search", "fetch_url", "google_calendar"]`

- [ ] **Step 3: Verify it handles missing credentials gracefully**

The tool should be registered but return a helpful error when called without credentials. Send a chat message like "What's on my calendar today?" and verify the AI receives the "not configured" error message and relays it to the user.

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Install googleapis + env vars | Manual |
| 2 | OAuth setup script | Manual (run script) |
| 3 | google_calendar tool + tests | 10 unit tests |
| 4 | Register tool | Full suite |
| 5 | Docker verification | Manual |
