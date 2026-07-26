import { z } from 'zod';
import { RunnableTool } from './types';
import { ToolExecutionContext } from '../types/context';
import { ToolError } from '../errors';
import { emailService } from '../services/emailService';
import { googleAuthService } from '../services/googleAuthService';
import logger from '../config/logger';

const log = logger.child({ tool: 'summarize_emails' });

const schema = z.object({
  filter: z.enum(['unread', 'read', 'all']).default('unread')
    .describe('Which emails to summarize'),
  maxResults: z.number().int().min(1).max(50).default(50)
    .describe('Maximum emails to process for summary'),
});

export const summarizeEmails: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'summarize_emails',
    description:
      'Fetch emails for summarization. Use when the user asks to summarize their inbox, get an overview of recent emails, or categorize their messages. Returns raw email metadata for the AI to categorize and summarize.',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['unread', 'read', 'all'],
          description: 'Which emails to summarize. Default: unread.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum emails to process (1-50). Default: 50.',
        },
      },
    },
  },
  schema,
  timeoutMs: 30000,

  async run({ filter, maxResults }, context?: ToolExecutionContext) {
    const userId = context?.userId;
    if (!userId) {
      throw new ToolError('Gmail requires a connected Google account. Please connect your account at /api/v1/auth/google');
    }

    await googleAuthService.hasScope(userId, 'gmail.readonly');

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
      if (err.message?.includes('Gmail not connected') || err.message?.includes('Gmail authorization')) {
        throw new ToolError(err.message);
      }
      throw new ToolError(`Failed to summarize emails: ${err.message}`);
    }
  },
};
