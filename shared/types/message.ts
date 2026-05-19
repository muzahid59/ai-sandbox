export interface Message {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ContentBlock[];
  toolCalls?: ToolCall[];
  createdAt: string;
}

export type ContentBlock = TextBlock | ToolUseBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
