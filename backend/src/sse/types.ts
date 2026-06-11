// ─── SSE Event Types for POST /api/v1/threads/:id/messages ───

export interface MessageStartEvent {
  type: 'message_start';
  message_id: string;
  assistant_msg_id: string;
  user_msg_id: string;
}

export interface DeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta';
    text: string;
  };
}

export interface ToolUseStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
}

export interface ToolUseResultEvent {
  type: 'content_block_stop';
  index: number;
  tool_result: {
    tool_call_id: string;
    name: string;
    output: string;
    is_error: boolean;
  };
}

export interface MessageStopEvent {
  type: 'message_stop';
  stop_reason: string;
  tool_calls_count: number;
}

export interface ErrorEvent {
  type: 'error';
  error: {
    type: string;
    message: string;
    retryable: boolean;
  };
}
