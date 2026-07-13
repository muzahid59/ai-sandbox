import { z } from 'zod';
import { RunnableTool } from './types';
import { ToolError } from '../errors';
import { emailService } from '../services/emailService';
import { EmailSummary } from '../types/email';
import logger from '../config/logger';

const log = logger.child({ tool: 'read_emails' });

const schema = z.object({
  filter: z.enum(['unread', 'read', 'all']).default('unread')
    .describe('Filter emails by read status'),
  maxResults: z.coerce.number().int().min(1).max(50).default(20)
    .describe('Maximum number of emails to return'),
  dateRange: z.object({
    after: z.string().optional().describe('Start date (ISO 8601 or YYYY-MM-DD)'),
    before: z.string().optional().describe('End date (ISO 8601 or YYYY-MM-DD)'),
  }).optional().describe('Filter by date range'),
  includeBody: z.coerce.boolean().default(false)
    .describe('Include full email body text (default: metadata + snippet only)'),
});

function formatEmailList(emails: EmailSummary[], totalCount: number, filter: string): string {
  if (emails.length === 0) {
    return `No ${filter === 'all' ? '' : filter + ' '}emails found.`;
  }

  const header = `Found ${emails.length} ${filter === 'all' ? '' : filter + ' '}emails (${emails.length} of ${totalCount} total):\n`;

  const items = emails.map((email, i) => {
    const fromStr = email.from.name
      ? `${email.from.name} <${email.from.address}>`
      : email.from.address;

    let entry = `${i + 1}. From: ${fromStr}\n   Subject: ${email.subject}\n   Date: ${email.date}\n   Snippet: ${email.snippet}`;

    if (email.hasAttachments && email.attachments) {
      const attachStr = email.attachments
        .map(a => `${a.filename} (${formatSize(a.size)})`)
        .join(', ');
      entry += `\n   Attachments: ${attachStr}`;
    }

    if (email.body) {
      entry = `Email from ${fromStr}\nSubject: ${email.subject}\nDate: ${email.date}\n\nBody:\n${email.body}`;
      if (email.hasAttachments && email.attachments) {
        const attachStr = email.attachments
          .map(a => `${a.filename} (${formatSize(a.size)})`)
          .join(', ');
        entry += `\n\nAttachments: ${attachStr}`;
      }
    }

    return entry;
  });

  return header + '\n' + items.join('\n\n');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const readEmails: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'read_emails',
    description:
      'Read emails from the user\'s Gmail inbox. Use when the user asks to see their emails, check inbox, or read specific messages. Returns email metadata and snippets by default; set includeBody=true for full content.',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['unread', 'read', 'all'],
          description: 'Filter emails by read status. Default: unread.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum emails to return (1-50). Default: 20.',
        },
        dateRange: {
          type: 'object',
          properties: {
            after: { type: 'string', description: 'Start date (ISO 8601)' },
            before: { type: 'string', description: 'End date (ISO 8601)' },
          },
          description: 'Optional date range filter.',
        },
        includeBody: {
          type: 'boolean',
          description: 'Include full email body. Default: false.',
        },
      },
    },
  },
  schema,
  timeoutMs: 15000,

  async run({ filter, maxResults, dateRange, includeBody }) {
    const userId = '00000000-0000-0000-0000-000000000001';

    if (!emailService.isConnected(userId)) {
      throw new ToolError('Gmail not connected. Visit http://localhost:5001/api/v1/auth/gmail to authorize.');
    }

    try {
      log.info({ filter, maxResults, includeBody }, 'Reading emails');
      const result = await emailService.listEmails(userId, filter, maxResults, dateRange, includeBody);
      log.info({ returnedCount: result.returnedCount, totalCount: result.totalCount }, 'Emails fetched');
      return formatEmailList(result.emails, result.totalCount, filter);
    } catch (err: any) {
      log.error({ err }, 'Failed to read emails');
      if (err.message?.includes('Gmail not connected') || err.message?.includes('Gmail authorization')) {
        throw new ToolError(err.message);
      }
      throw new ToolError(`Failed to read emails: ${err.message}`);
    }
  },
};
