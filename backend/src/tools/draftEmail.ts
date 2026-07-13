import { z } from 'zod';
import { RunnableTool } from './types';
import { ToolError } from '../errors';
import { emailService, AuthRequiredError } from '../services/emailService';
import logger from '../config/logger';

const log = logger.child({ tool: 'draft_email' });

const schema = z.object({
  to: z.string().email().describe('Recipient email address'),
  subject: z.string().min(1).describe('Email subject line'),
  body: z.string().min(1).describe('Email body text'),
  cc: z.string().optional().describe('CC email addresses (comma-separated)'),
  bcc: z.string().optional().describe('BCC email addresses (comma-separated)'),
});

export const draftEmail: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'draft_email',
    description:
      'Create an email draft in the user\'s Gmail. Use when the user asks to compose, write, or draft an email. The draft is saved to Gmail Drafts — it is NOT sent. The user must open Gmail to review and send.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body text' },
        cc: { type: 'string', description: 'CC email addresses (comma-separated)' },
        bcc: { type: 'string', description: 'BCC email addresses (comma-separated)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  schema,
  timeoutMs: 10000,

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
};
