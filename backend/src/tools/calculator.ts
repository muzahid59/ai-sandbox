import { evaluate } from 'mathjs';
import { LegacyToolDefinition as ToolDefinition, LegacyToolResult as ToolResult } from '../types';

export const definition: ToolDefinition = {
  name: 'calculator',
  description:
    'Evaluate a mathematical expression and return the result. Use this for any arithmetic, algebra, unit conversions, or numeric calculations. Examples: "2 + 2", "(45 * 23) + 17", "sqrt(144)", "12.5% of 800".',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The math expression to evaluate, e.g. "(45 * 23) + 17"',
      },
    },
    required: ['expression'],
  },
  timeoutMs: 5000,
};

export async function handler(input: Record<string, unknown>): Promise<ToolResult> {
  const expression = input.expression as string;
  if (!expression || typeof expression !== 'string') {
    return { success: false, output: 'Missing or invalid "expression" parameter' };
  }

  try {
    const result = evaluate(expression);
    return { success: true, output: String(result) };
  } catch (error: any) {
    return { success: false, output: `Could not evaluate "${expression}": ${error.message}` };
  }
}
