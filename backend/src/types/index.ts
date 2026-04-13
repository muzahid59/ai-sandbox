export * from './content';
export * from './messages';
export * from './events';

// ─── Auth ───

export interface AuthUser {
  id: string;
  email: string;
}

// Augment Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ─── Backward-compatible aliases (removed as consumers migrate) ───

import { MessageParam, ToolResult as NewToolResult, ToolDefinition as NewToolDefinition } from './messages';

/** @deprecated Use MessageParam */
export type StructuredMessage = MessageParam;

/** @deprecated Use ToolDefinition with input_schema */
export interface LegacyToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  timeoutMs?: number;
}

/** @deprecated Use ToolResult with is_error */
export interface LegacyToolResult {
  success: boolean;
  output: string;
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<LegacyToolResult>;
