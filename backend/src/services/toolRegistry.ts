import { ToolDefinition, ToolResult, ToolHandler } from '../types';

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered`);
    }
    this.tools.set(definition.name, { definition, handler });
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
      return { success: false, output: `Unknown tool: ${name}` };
    }

    const timeout = tool.definition.timeoutMs ?? 30_000;

    try {
      const result = await Promise.race([
        tool.handler(input),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeout}ms`)), timeout),
        ),
      ]);
      return result;
    } catch (error: any) {
      return { success: false, output: `Tool error: ${error.message}` };
    }
  }
}

export const toolRegistry = new ToolRegistry();
