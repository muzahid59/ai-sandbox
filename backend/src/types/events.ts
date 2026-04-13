import { ContentBlock } from './content';
import { StopReason } from './messages';

// ─── SSE Stream Events (Anthropic-style granular events) ───

export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | StreamErrorEvent;

export interface MessageStartEvent {
  type: 'message_start';
  message_id: string;
  assistant_msg_id: string;
  user_msg_id: string;
}

export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: TextDelta | InputJsonDelta;
}

export interface TextDelta {
  type: 'text_delta';
  text: string;
}

export interface InputJsonDelta {
  type: 'input_json_delta';
  partial_json: string;
}

export interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface MessageDeltaEvent {
  type: 'message_delta';
  stop_reason: StopReason;
  tool_calls_count: number;
}

export interface MessageStopEvent {
  type: 'message_stop';
}

export interface StreamErrorEvent {
  type: 'error';
  error: {
    type: string;
    message: string;
    retryable: boolean;
  };
}
