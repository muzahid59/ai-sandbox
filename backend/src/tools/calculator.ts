import { z } from 'zod';
import { evaluate } from 'mathjs';
import { RunnableTool } from './types';
import { ToolError } from '../errors';

const schema = z.object({
  expression: z.string().describe('The math expression to evaluate, e.g. "(45 * 23) + 17"'),
});

export const calculator: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'calculator',
    description:
      'Evaluate a mathematical expression and return the result. Use this for any arithmetic, algebra, unit conversions, or numeric calculations. Examples: "2 + 2", "(45 * 23) + 17", "sqrt(144)", "12.5% of 800".',
    input_schema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The math expression to evaluate, e.g. "(45 * 23) + 17"',
        },
      },
      required: ['expression'],
    },
  },
  schema,
  timeoutMs: 5000,

  async run({ expression }) {
    try {
      const result = evaluate(expression);
      return String(result);
    } catch (error: any) {
      throw new ToolError(`Could not evaluate "${expression}": ${error.message}`);
    }
  },
};
