import { ZodType } from 'zod';
import { ToolDefinition, ToolResult } from '../types/messages';
import { ToolExecutionContext } from '../types/context';

export interface RunnableTool<TInput = Record<string, unknown>> {
  definition: ToolDefinition;
  schema: ZodType<TInput>;
  timeoutMs?: number;
  run(input: TInput, context?: ToolExecutionContext): Promise<string>;
}
