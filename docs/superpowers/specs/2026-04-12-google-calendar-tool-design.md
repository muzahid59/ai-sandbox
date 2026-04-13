# Google Calendar Tool Design

## Overview

Add a `google_calendar` tool to the AI Sandbox that lets the AI read events from the user's Google Calendar. The tool connects to Google Calendar API using OAuth2 credentials stored in environment variables (manually configured). Read-only for now; designed so write operations can be added later.

## Authentication

OAuth2 via three env vars in `backend/.env`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

The tool creates an OAuth2 client from these at call time and auto-refreshes the access token. No frontend changes, no database changes, no OAuth redirect flow — the user generates the refresh token once via a setup script.

A one-time setup script (`backend/scripts/google-auth.js`) opens a browser to the Google consent screen, captures the authorization code, exchanges it for a refresh token, and prints it for the user to paste into `.env`.

**Google Cloud setup required:**
1. Create a project in Google Cloud Console
2. Enable the Google Calendar API
3. Create OAuth credentials (Desktop app type)
4. Run the setup script to get the refresh token

## Tool Definition

```typescript
{
  name: 'google_calendar',
  description: 'Read events from Google Calendar. Use when the user asks about their schedule, upcoming meetings, availability, or calendar events.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform: "list" (events in date range), "search" (events by keyword), "busy" (free/busy status)'
      },
      start_date: {
        type: 'string',
        description: 'Start date in ISO 8601 format (e.g. "2026-04-13T00:00:00"). Defaults to today.'
      },
      end_date: {
        type: 'string',
        description: 'End date in ISO 8601 format. Defaults to start_date + 1 day.'
      },
      query: {
        type: 'string',
        description: 'Search keyword. Used with "search" action.'
      },
      timezone: {
        type: 'string',
        description: 'IANA timezone (e.g. "Asia/Dhaka", "America/New_York"). Defaults to Asia/Dhaka.'
      }
    },
    required: ['action']
  },
  timeoutMs: 10000
}
```

## Actions

### `list` — List events in a date range

Calls `calendar.events.list()` on the `primary` calendar with `timeMin` and `timeMax`.

- `start_date` defaults to today (start of day)
- `end_date` defaults to `start_date + 1 day`
- Orders by start time ascending
- Max 20 events per call

### `search` — Search events by keyword

Same API call as `list` but with the `q` parameter for keyword filtering.

- Requires `query` parameter
- `start_date` and `end_date` define the search window (defaults to next 30 days)

### `busy` — Check free/busy status

Calls `calendar.freebusy.query()` to get busy time blocks, then derives free blocks within the requested range.

- Returns alternating busy/free blocks
- Useful for "Am I free Thursday afternoon?" type questions

## Output Format

**`list` and `search`:**

```
Found 3 events:

1. Team Standup
   When: Mon Apr 13, 10:00 AM - 10:30 AM (Asia/Dhaka)
   Location: Google Meet

2. Sprint Planning
   When: Mon Apr 13, 2:00 PM - 3:00 PM (Asia/Dhaka)
   Description: Review backlog items for sprint 14

3. 1:1 with Manager
   When: Mon Apr 13, 4:00 PM - 4:30 PM (Asia/Dhaka)
```

No events: `"No events found between <start> and <end>"`

**`busy`:**

```
Free/busy for Mon Apr 13:

Busy: 10:00 AM - 10:30 AM
Free: 10:30 AM - 2:00 PM
Busy: 2:00 PM - 3:00 PM
Free: 3:00 PM - 4:00 PM
Busy: 4:00 PM - 4:30 PM
```

## Error Handling

- Missing credentials: `"Google Calendar not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN to backend/.env"`
- Invalid/expired token: `"Google Calendar authentication failed. Re-run the setup script to generate a new refresh token."`
- API error: `"Google Calendar error: <message>"`
- Invalid action: `"Unknown action: <action>. Use: list, search, busy."`
- Missing query for search: `"Missing 'query' parameter for search action"`

## Dependencies

- `googleapis` — Google API client library (includes Calendar API)

## File Changes

| File | Change |
|------|--------|
| `backend/src/tools/googleCalendar.ts` | New — tool definition + handler |
| `backend/src/tools/index.ts` | Register google_calendar tool |
| `backend/scripts/google-auth.js` | New — one-time OAuth setup script |
| `backend/.env.example` | Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN |
| `backend/package.json` | Add `googleapis` dependency |

## Future Extensions (out of scope for now)

- Write operations: create, update, delete events
- Multiple calendar support (list calendars, query specific ones)
- OAuth redirect flow in the frontend UI
- Recurring event handling
- Calendar-based reminders/notifications
