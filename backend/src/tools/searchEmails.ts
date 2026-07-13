import { z } from 'zod';
import { RunnableTool } from './types';
import { ToolError } from '../errors';
import { emailService } from '../services/emailService';
import { EmailSummary } from '../types/email';
import logger from '../config/logger';

const log = logger.child({ tool: 'search_emails' });

const schema = z.object({
  from: z.string().optional().describe('Sender email address or name'),
  to: z.string().optional().describe('Recipient email address'),
  subject: z.string().optional().describe('Subject line keyword'),
  keywords: z.string().optional().describe('Search keywords in email body'),
  dateRange: z.object({
    after: z.string().optional().describe('Start date (ISO 8601 or YYYY-MM-DD)'),
    before: z.string().optional().describe('End date (ISO 8601 or YYYY-MM-DD)'),
  }).optional().describe('Filter by date range'),
  hasAttachment: z.coerce.boolean().optional().describe('Filter for emails with attachments'),
  maxResults: z.coerce.number().int().min(1).max(50).default(20)
    .describe('Maximum results to return'),
  includeBody: z.coerce.boolean().default(false)
    .describe('Include full email body text'),
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSearchResults(emails: EmailSummary[], totalCount: number): string {
  if (emails.length === 0) {
    return 'No emails found matching your search.';
  }

  const header = `Found ${emails.length} matching emails (${emails.length} of ${totalCount} total):\n`;

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

export const searchEmails: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'search_emails',
    description:
      'Search emails in the user\'s Gmail. Use when the user asks to find specific emails by sender, subject, keywords, date range, or attachments. Returns matching emails with metadata and snippets.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Sender email address or name' },
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Subject line keyword' },
        keywords: { type: 'string', description: 'Search keywords in email body' },
        dateRange: {
          type: 'object',
          properties: {
            after: { type: 'string', description: 'Start date (ISO 8601)' },
            before: { type: 'string', description: 'End date (ISO 8601)' },
          },
          description: 'Optional date range filter.',
        },
        hasAttachment: { type: 'boolean', description: 'Filter for emails with attachments' },
        maxResults: { type: 'number', description: 'Maximum results to return (1-50). Default: 20.' },
        includeBody: { type: 'boolean', description: 'Include full email body. Default: false.' },
      },
    },
  },
  schema,
  timeoutMs: 15000,

  async run(input) {
    const userId = '00000000-0000-0000-0000-000000000001';

    if (!emailService.isConnected(userId)) {
      throw new ToolError('Gmail not connected. Visit http://localhost:5001/api/v1/auth/gmail to authorize.');
    }

    try {
      log.info({ from: input.from, subject: input.subject, keywords: input.keywords }, 'Searching emails');
      const result = await emailService.searchEmails(userId, input);
      log.info({ returnedCount: result.returnedCount, totalCount: result.totalCount }, 'Search complete');
      return formatSearchResults(result.emails, result.totalCount);
    } catch (err: any) {
      log.error({ err }, 'Failed to search emails');
      if (err.message?.includes('Gmail not connected') || err.message?.includes('Gmail authorization')) {
        throw new ToolError(err.message);
      }
      throw new ToolError(`Failed to search emails: ${err.message}`);
    }
  },
};
