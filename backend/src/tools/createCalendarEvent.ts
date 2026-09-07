import { z } from 'zod';
import { google } from 'googleapis';
import { RunnableTool } from './types';
import { ToolExecutionContext } from '../types/context';
import { ToolError } from '../errors';
import { googleAuthService } from '../services/googleAuthService';
import logger from '../config/logger';

const log = logger.child({ tool: 'create_calendar_event' });

const schema = z.object({
  summary: z.string().min(1).describe('Event title'),
  start_time: z.string().describe('Start time in ISO 8601 format (e.g. "2026-09-07T17:00:00+06:00")'),
  end_time: z.string().describe('End time in ISO 8601 format (e.g. "2026-09-07T17:30:00+06:00")'),
  description: z.string().optional().describe('Event description or agenda'),
  location: z.string().optional().describe('Event location or meeting link'),
  attendees: z.array(z.string().email()).optional().describe('List of attendee email addresses'),
  timezone: z.string().default('Asia/Dhaka').optional().describe('IANA timezone. Defaults to Asia/Dhaka.'),
});

export const createCalendarEvent: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'create_calendar_event',
    description:
      'Create a new event on the user\'s Google Calendar. Use when the user asks to schedule a meeting, set an appointment, add a calendar event, or book time. User timezone is Asia/Dhaka.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title (e.g. "Meeting with John")' },
        start_time: { type: 'string', description: 'Start time in ISO 8601 (e.g. "2026-09-07T17:00:00+06:00")' },
        end_time: { type: 'string', description: 'End time in ISO 8601 (e.g. "2026-09-07T17:30:00+06:00")' },
        description: { type: 'string', description: 'Event description or agenda' },
        location: { type: 'string', description: 'Event location or meeting link' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses' },
        timezone: { type: 'string', description: 'IANA timezone. Default: Asia/Dhaka.' },
      },
      required: ['summary', 'start_time', 'end_time'],
    },
  },
  schema,
  timeoutMs: 10000,

  async run({ summary, start_time, end_time, description, location, attendees, timezone: tz }, context?: ToolExecutionContext) {
    if (!context?.userId) {
      throw new ToolError('Google Calendar requires a connected Google account. Please connect your Google account first.');
    }

    const timezone = tz || 'Asia/Dhaka';

    await googleAuthService.hasScope(context.userId, 'calendar.events');
    const auth = await googleAuthService.getAuthClient(context.userId);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
      log.info({ summary, start_time, end_time }, 'Creating calendar event');

      const event: Record<string, unknown> = {
        summary,
        start: { dateTime: start_time, timeZone: timezone },
        end: { dateTime: end_time, timeZone: timezone },
      };

      if (description) event.description = description;
      if (location) event.location = location;
      if (attendees?.length) {
        event.attendees = attendees.map((email) => ({ email }));
      }

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });

      const created = response.data;
      const startStr = new Date(start_time).toLocaleString('en-US', {
        timeZone: timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const endStr = new Date(end_time).toLocaleString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      log.info({ eventId: created.id }, 'Calendar event created');

      const lines = [
        'Event created on Google Calendar.',
        `  Title: ${created.summary}`,
        `  When: ${startStr} - ${endStr}`,
      ];
      if (location) lines.push(`  Location: ${location}`);
      if (description) lines.push(`  Description: ${description}`);
      if (attendees?.length) lines.push(`  Attendees: ${attendees.join(', ')}`);
      lines.push(`  Link: ${created.htmlLink}`);

      return lines.join('\n');
    } catch (error: any) {
      if (error instanceof ToolError) throw error;
      log.error({ err: error }, 'Google Calendar event creation failed');
      if (error.code === 401 || error.message?.includes('Invalid credentials')) {
        throw new ToolError('Google Calendar authentication failed. Please reconnect your Google account.');
      }
      throw new ToolError(`Failed to create calendar event: ${error.message}`);
    }
  },
};
