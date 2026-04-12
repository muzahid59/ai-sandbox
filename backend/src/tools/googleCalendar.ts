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
