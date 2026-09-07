import { z } from 'zod';
import { RunnableTool } from './types';
import { ToolExecutionContext } from '../types/context';
import { ToolError } from '../errors';
import { emailService } from '../services/emailService';
import { googleAuthService } from '../services/googleAuthService';
import { EmailSummary } from '../types/email';
import logger from '../config/logger';

const log = logger.child({ tool: 'list_drafts' });

const schema = z.object({
  maxResults: z.number().int().min(1).max(50).default(20)
    .describe('Maximum number of drafts to return'),
  includeBody: z.boolean().default(false)
    .describe('Include full draft body text (default: metadata + snippet only)'),
});

function formatDraftList(drafts: EmailSummary[], totalCount: number): string {
  if (drafts.length === 0) {
    return 'No drafts found in Gmail.';
  }

  const header = `Found ${drafts.length} drafts (${drafts.length} of ${totalCount} total):\n`;

  const items = drafts.map((draft, i) => {
    const toStr = draft.to.length > 0 ? draft.to.join(', ') : '(no recipient)';

    let entry = `${i + 1}. To: ${toStr}\n   Subject: ${draft.subject || '(no subject)'}\n   Snippet: ${draft.snippet}`;

    if (draft.body) {
      entry = `Draft to ${toStr}\nSubject: ${draft.subject || '(no subject)'}\n\nBody:\n${draft.body}`;
    }

    return entry;
  });

  return header + '\n' + items.join('\n\n');
}

export const listDrafts: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'list_drafts',
    description:
      'List draft emails from the user\'s Gmail. Use when the user asks to see their drafts, saved drafts, or unsent emails.',
    input_schema: {
      type: 'object',
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum drafts to return (1-50). Default: 20.',
        },
        includeBody: {
          type: 'boolean',
          description: 'Include full draft body. Default: false.',
        },
      },
    },
  },
  schema,
  timeoutMs: 15000,

  async run({ maxResults, includeBody }, context?: ToolExecutionContext) {
    const userId = context?.userId;
    if (!userId) {
      throw new ToolError('Gmail requires a connected Google account. Please connect your account first.');
    }

    await googleAuthService.hasScope(userId, 'gmail.readonly');

    try {
      log.info({ maxResults, includeBody }, 'Listing drafts');
      const result = await emailService.listDrafts(userId, maxResults, includeBody);
      log.info({ returnedCount: result.returnedCount, totalCount: result.totalCount }, 'Drafts fetched');
      return formatDraftList(result.emails, result.totalCount);
    } catch (err: any) {
      log.error({ err }, 'Failed to list drafts');
      if (err instanceof ToolError) throw err;
      throw new ToolError(`Failed to list drafts: ${err.message}`);
    }
  },
};
