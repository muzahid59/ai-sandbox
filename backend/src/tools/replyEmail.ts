import { z } from 'zod';
import { RunnableTool } from './types';
import { ToolError } from '../errors';
import { emailService, AuthRequiredError } from '../services/emailService';
import logger from '../config/logger';

const log = logger.child({ tool: 'reply_email' });

const schema = z.object({
  emailId: z.string().min(1).describe('Gmail message ID of the email to reply to'),
  body: z.string().min(1).describe('Reply body text'),
});

export const replyEmail: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'reply_email',
    description:
      'Create a reply draft to an existing email. Use when the user asks to reply to a specific email. The reply draft is saved to Gmail Drafts in the correct thread — it is NOT sent. The user must open Gmail to review and send.',
    input_schema: {
      type: 'object',
      properties: {
        emailId: { type: 'string', description: 'Gmail message ID of the email to reply to' },
        body: { type: 'string', description: 'Reply body text' },
      },
      required: ['emailId', 'body'],
    },
  },
  schema,
  timeoutMs: 10000,

  async run({ emailId, body }) {
    const userId = '00000000-0000-0000-0000-000000000001';

    if (!emailService.isConnected(userId)) {
      return emailService.buildAuthRequiredMessage();
    }

    try {
      log.info({ emailId }, 'Creating reply draft');
      const result = await emailService.createReplyDraft(userId, emailId, body);
      log.info({ draftId: result.draftId, threadId: result.threadId }, 'Reply draft created');

      return [
        'Reply draft saved to Gmail.',
        `  Thread: ${result.subject}`,
        `  To: ${result.to}`,
        `  Preview: ${result.bodyPreview}`,
        `  Draft ID: ${result.draftId}`,
        '',
        'Open Gmail to review and send.',
      ].join('\n');
    } catch (err: any) {
      log.error({ err }, 'Failed to create reply draft');
      if (err instanceof AuthRequiredError) {
        return emailService.buildAuthRequiredMessage();
      }
      throw new ToolError(`Failed to create reply: ${err.message}`);
    }
  },
};
