import { ContentBlock, ContentBlockParam, ToolUseBlock } from './content';

// ─── Stop Reasons ───

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

// ─── Tool Calling ───

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ─── Messages ───

/**
 * Message sent to AI providers (request direction).
 * `content` can be a plain string shorthand or structured blocks.
 */
export interface MessageParam {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | (ContentBlock | ContentBlockParam)[];
  tool_calls?: ToolCall[];
}

// ─── Tool Definitions (Anthropic-style) ───

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

// ─── Tool Execution ───

export interface ToolResult {
  output: string;
  is_error: boolean;
}

// ─── Chat Completion ───

export interface ChatCompletionOptions {
  messages: MessageParam[];
  tools?: ToolDefinition[];
  model?: string;
}

export interface ChatCompletionResult {
  text: string;
  contentBlocks: ContentBlock[];
  toolCalls: ToolCall[];
  stopReason: StopReason;
}
