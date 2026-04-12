export interface ContentBlock {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result';
  text?: string;
  url?: string;
  mime?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

// ─── Tool Calling Types ───

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  timeoutMs?: number;
}

export interface ToolResult {
  success: boolean;
  output: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StructuredMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  tool_calls?: ToolCall[];
}

export interface ChatCompletionOptions {
  messages: StructuredMessage[];
  tools?: ToolDefinition[];
  model?: string;
}

export interface ChatCompletionResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

// Augment Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
