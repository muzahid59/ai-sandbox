import { Response } from 'express';
import {
  MessageStartEvent,
  DeltaEvent,
  ToolUseStartEvent,
  ToolUseResultEvent,
  MessageStopEvent,
  ErrorEvent,
} from './types';

export class SSEWriter {
  private closed = false;

  constructor(private readonly res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.on('close', () => {
      this.closed = true;
    });
  }

  sendMessageStart(data: Omit<MessageStartEvent, 'type'>): void {
    this.write({ type: 'message_start', ...data });
  }

  sendDelta(text: string): void {
    const event: DeltaEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    };
    this.write(event);
  }

  sendToolUseStart(data: Omit<ToolUseStartEvent, 'type' | 'index'>['content_block']): void {
    const event: ToolUseStartEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: data,
    };
    this.write(event);
  }

  sendToolUseResult(data: Omit<ToolUseResultEvent, 'type' | 'index'>['tool_result']): void {
    const event: ToolUseResultEvent = {
      type: 'content_block_stop',
      index: 0,
      tool_result: data,
    };
    this.write(event);
  }

  sendMessageStop(stopReason: string, toolCallsCount: number): void {
    const event: MessageStopEvent = {
      type: 'message_stop',
      stop_reason: stopReason,
      tool_calls_count: toolCallsCount,
    };
    this.write(event);
  }

  sendError(data: ErrorEvent['error']): void {
    this.write({ type: 'error', error: data });
  }

  end(): void {
    if (!this.closed) {
      this.closed = true;
      this.res.end();
    }
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  private write(payload: object): void {
    if (this.closed) return;
    this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}
