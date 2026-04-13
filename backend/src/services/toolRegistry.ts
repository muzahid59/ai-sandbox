import { ToolDefinition, ToolResult } from '../types/messages';
import { RunnableTool } from '../tools/types';
import { ToolError } from '../errors';
import logger from '../config/logger';

const log = logger.child({ component: 'toolRegistry' });

class ToolRegistry {
  private tools = new Map<string, RunnableTool>();

  register(tool: RunnableTool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool "${tool.definition.name}" is already registered`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { output: `Unknown tool: ${name}`, is_error: true };
    }

    const timeout = tool.timeoutMs ?? 30_000;

    // Validate input with Zod
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message).join(', ');
      return { output: `Invalid input: ${errors}`, is_error: true };
    }

    try {
      const output = await Promise.race([
        tool.run(parsed.data),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeout}ms`)), timeout),
        ),
      ]);
      return { output, is_error: false };
    } catch (error: any) {
      if (error instanceof ToolError) {
        return { output: error.content, is_error: true };
      }
      log.error({ err: error, tool: name }, 'Tool execution failed');
      return { output: `Tool error: ${error.message}`, is_error: true };
    }
  }
}

export const toolRegistry = new ToolRegistry();
