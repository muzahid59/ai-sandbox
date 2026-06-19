import { ContentBlock, ContentBlockParam, ToolUseBlock } from '../types/content';
import { ToolCall } from '../types/messages';

export function extractTextContent(
  content: string | (ContentBlock | ContentBlockParam)[],
): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join(' ');
}

export function mapToolResult(
  content: (ContentBlock | ContentBlockParam)[],
): { tool_use_id: string; content: string } | null {
  const block = content.find((b) => b.type === 'tool_result');
  if (!block || !('tool_use_id' in block)) return null;
  return {
    tool_use_id: block.tool_use_id,
    content: 'content' in block ? String(block.content) : '',
  };
}

export function buildToolCallContentBlock(toolCall: ToolCall): ToolUseBlock {
  return {
    type: 'tool_use',
    id: toolCall.id,
    name: toolCall.name,
    input: toolCall.arguments,
  };
}
