import { z } from 'zod';
import { RunnableTool } from './types';

const schema = z.object({
  format: z
    .enum(['date', 'datetime', 'timestamp'])
    .optional()
    .describe('Format: "date" for YYYY-MM-DD, "datetime" for full date and time, "timestamp" for ISO string'),
});

export const getCurrentDate: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'get_current_date',
    description:
      'Get the current date and time. Use this when the user asks "what day is it", "what\'s the date", "what time is it", or needs to know the current date/time.',
    input_schema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['date', 'datetime', 'timestamp'],
          description: 'Format: "date" for YYYY-MM-DD, "datetime" for full date and time, "timestamp" for ISO string',
        },
      },
    },
  },
  schema,
  timeoutMs: 1000,

  async run({ format }) {
    const now = new Date();
    const selectedFormat = format || 'date';

    switch (selectedFormat) {
      case 'date':
        return now.toISOString().split('T')[0]; // YYYY-MM-DD

      case 'datetime': {
        // Human-readable format: "Wednesday, April 16, 2026 at 6:56 AM GMT+6"
        const options: Intl.DateTimeFormatOptions = {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          timeZone: 'Asia/Dhaka',
          timeZoneName: 'short',
        };
        return now.toLocaleString('en-US', options);
      }

      case 'timestamp':
        return now.toISOString();

      default:
        return now.toISOString().split('T')[0];
    }
  },
};
