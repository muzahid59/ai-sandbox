import { z } from 'zod';
import { google } from 'googleapis';
import { RunnableTool } from './types';
import { ToolError } from '../errors';
import logger from '../config/logger';

const log = logger.child({ tool: 'google_calendar' });

const schema = z.object({
  action: z.enum(['list', 'search', 'busy']).describe('Action: "list", "search", or "busy"'),
  start_date: z.string().optional().describe('Start date in ISO 8601 format. Defaults to today.'),
  end_date: z.string().optional().describe('End date in ISO 8601 format. Defaults to start_date + 1 day.'),
  query: z.string().optional().describe('Search keyword. Used with "search" action.'),
  timezone: z.string().default('Asia/Dhaka').optional().describe('IANA timezone. Defaults to Asia/Dhaka.'),
});

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

function getDateRange(startDate: string | undefined, endDate: string | undefined, timezone: string, defaultDays: number) {
  const now = new Date();

  let start: Date;
  if (startDate) {
    const parsed = new Date(startDate);
    start = isNaN(parsed.getTime())
      ? new Date(now.toLocaleString('en-US', { timeZone: timezone }))
      : parsed;
  } else {
    start = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  }
  start.setHours(0, 0, 0, 0);

  let end: Date;
  if (endDate) {
    const parsed = new Date(endDate);
    end = isNaN(parsed.getTime()) ? new Date(start) : parsed;
  } else {
    end = new Date(start);
  }
  if (!endDate || isNaN(new Date(endDate).getTime())) {
    end.setDate(end.getDate() + defaultDays);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

function formatTime(dateTime: string | undefined, date: string | undefined, timezone: string): string {
  if (date) return 'All day';
  if (!dateTime) return 'Unknown time';
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

export const googleCalendar: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'google_calendar',
    description:
      'Read events from Google Calendar. Use when the user asks about their schedule, upcoming meetings, availability, or calendar events.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: "list" (events in date range), "search" (by keyword), "busy" (free/busy status)' },
        start_date: { type: 'string', description: 'Start date in ISO 8601 format. Defaults to today.' },
        end_date: { type: 'string', description: 'End date in ISO 8601 format. Defaults to start_date + 1 day.' },
        query: { type: 'string', description: 'Search keyword. Used with "search" action.' },
        timezone: { type: 'string', description: 'IANA timezone (e.g. "Asia/Dhaka"). Defaults to Asia/Dhaka.' },
      },
      required: ['action'],
    },
  },
  schema,
  timeoutMs: 10000,

  async run({ action, start_date, end_date, query, timezone: tz }) {
    const timezone = tz || 'Asia/Dhaka';

    const auth = getAuthClient();
    if (!auth) {
      throw new ToolError(
        'Google Calendar not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN to backend/.env',
      );
    }

    const calendar = google.calendar({ version: 'v3', auth });

    try {
      switch (action) {
        case 'list': {
          const { start, end } = getDateRange(start_date, end_date, timezone, 1);
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
          if (events.length === 0) return `No events found between ${start} and ${end}`;
          return `Found ${events.length} events:\n\n${formatEvents(events, timezone)}`;
        }

        case 'search': {
          if (!query) throw new ToolError("Missing 'query' parameter for search action");
          const { start, end } = getDateRange(start_date, end_date, timezone, 30);
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
          if (events.length === 0) return `No events found matching "${query}"`;
          return `Found ${events.length} events matching "${query}":\n\n${formatEvents(events, timezone)}`;
        }

        case 'busy': {
          const { start, end } = getDateRange(start_date, end_date, timezone, 1);
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
          const fmt = (dt: Date) =>
            dt.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true });
          const dateLabel = rangeStart.toLocaleString('en-US', {
            timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric',
          });

          if (busySlots.length === 0) {
            return `Free/busy for ${dateLabel}:\n\nFree: ${fmt(rangeStart)} - ${fmt(rangeEnd)} (entirely free)`;
          }

          const blocks: string[] = [];
          let cursor = rangeStart;
          for (const slot of busySlots) {
            const busyStart = new Date(slot.start!);
            const busyEnd = new Date(slot.end!);
            if (cursor < busyStart) blocks.push(`Free: ${fmt(cursor)} - ${fmt(busyStart)}`);
            blocks.push(`Busy: ${fmt(busyStart)} - ${fmt(busyEnd)}`);
            cursor = busyEnd;
          }
          if (cursor < rangeEnd) blocks.push(`Free: ${fmt(cursor)} - ${fmt(rangeEnd)}`);
          return `Free/busy for ${dateLabel}:\n\n${blocks.join('\n')}`;
        }
      }
    } catch (error: any) {
      if (error instanceof ToolError) throw error;
      log.error({ err: error, action }, 'Google Calendar API failed');
      if (error.code === 401 || error.message?.includes('Invalid credentials')) {
        throw new ToolError('Google Calendar authentication failed. Re-run the setup script.');
      }
      throw new ToolError(`Google Calendar error: ${error.message}`);
    }
  },
};
