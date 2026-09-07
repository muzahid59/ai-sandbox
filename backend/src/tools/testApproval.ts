import { z } from 'zod';
import { RunnableTool } from './types';

const schema = z.object({
  message: z.string().describe('The message to echo back'),
});

export const testApproval: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'test_approval',
    description:
      'A test tool that requires user approval before execution. Echoes the provided message back.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to echo back' },
      },
      required: ['message'],
    },
    requiresApproval: true,
  },
  schema,

  async run({ message }) {
    return message;
  },
};
