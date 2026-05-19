export type SSEEvent =
  | MessageCreatedEvent
  | DeltaEvent
  | ToolUseStartEvent
  | ToolUseResultEvent
  | DoneEvent
  | ErrorEvent;

export interface MessageCreatedEvent {
  type: 'message_created';
  user_msg_id: string;
  assistant_msg_id: string;
}

export interface DeltaEvent {
  type: 'delta';
  text: string;
  msg_id: string;
}

export interface ToolUseStartEvent {
  type: 'tool_use_start';
  tool_call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolUseResultEvent {
  type: 'tool_use_result';
  tool_call_id: string;
  name: string;
  success: boolean;
  output: string;
}

export interface DoneEvent {
  type: 'done';
  msg_id: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  tool_calls_count: number;
}

export interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
}
