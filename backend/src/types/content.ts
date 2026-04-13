// ─── Content Blocks (Anthropic-style discriminated unions) ───

/**
 * Response content blocks — returned by AI providers.
 * Each variant is narrowed by the `type` discriminant.
 */
export type ContentBlock =
  | TextBlock
  | ToolUseBlock;

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

/**
 * Request content blocks — sent by users or as tool results.
 * Separate from response types following Anthropic's Param convention.
 */
export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | ToolResultBlockParam;

export interface TextBlockParam {
  type: 'text';
  text: string;
}

export interface ImageBlockParam {
  type: 'image_url';
  url: string;
  mime?: string;
}

export interface ToolResultBlockParam {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
