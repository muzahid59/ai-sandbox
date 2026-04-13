import { ZodType } from 'zod';
import { ToolDefinition, ToolResult } from '../types/messages';

/**
 * A runnable tool following Anthropic's betaZodTool pattern.
 * Combines a JSON Schema definition with a Zod schema for runtime
 * validation and a typed run() function.
 */
export interface RunnableTool<TInput = Record<string, unknown>> {
  definition: ToolDefinition;
  schema: ZodType<TInput>;
  timeoutMs?: number;
  run(input: TInput): Promise<string>;
}
