import { SSEWriter } from '../../src/sse/sseWriter';
import { EventEmitter } from 'events';

function createMockResponse() {
  const emitter = new EventEmitter();
  const written: string[] = [];
  const headers: Record<string, string> = {};
  let ended = false;

  const res = {
    setHeader: jest.fn((key: string, value: string) => { headers[key] = value; }),
    write: jest.fn((data: string) => { written.push(data); return true; }),
    end: jest.fn(() => { ended = true; }),
    on: emitter.on.bind(emitter),
  };

  return {
    res: res as any,
    emitter,
    written,
    headers,
    isEnded: () => ended,
  };
}

describe('SSEWriter', () => {
  it('sets SSE headers on construction', () => {
    const { res } = createMockResponse();
    new SSEWriter(res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
  });

  it('sends message_start event', () => {
    const { res, written } = createMockResponse();
    const writer = new SSEWriter(res);
    writer.sendMessageStart({ message_id: 'm1', assistant_msg_id: 'a1', user_msg_id: 'u1' });
    expect(written).toHaveLength(1);
    const parsed = JSON.parse(written[0].replace('data: ', '').trim());
    expect(parsed).toEqual({
      type: 'message_start',
      message_id: 'm1',
      assistant_msg_id: 'a1',
      user_msg_id: 'u1',
    });
  });

  it('sends delta event', () => {
    const { res, written } = createMockResponse();
    const writer = new SSEWriter(res);
    writer.sendDelta('hello');
    const parsed = JSON.parse(written[0].replace('data: ', '').trim());
    expect(parsed).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    });
  });

  it('sends tool_use_start event', () => {
    const { res, written } = createMockResponse();
    const writer = new SSEWriter(res);
    writer.sendToolUseStart({ type: 'tool_use', id: 'c1', name: 'calc', input: { x: 1 } });
    const parsed = JSON.parse(written[0].replace('data: ', '').trim());
    expect(parsed.type).toBe('content_block_start');
    expect(parsed.content_block.name).toBe('calc');
  });

  it('sends tool_use_result event', () => {
    const { res, written } = createMockResponse();
    const writer = new SSEWriter(res);
    writer.sendToolUseResult({ tool_call_id: 'c1', name: 'calc', output: '4', is_error: false });
    const parsed = JSON.parse(written[0].replace('data: ', '').trim());
    expect(parsed.type).toBe('content_block_stop');
    expect(parsed.tool_result.output).toBe('4');
  });

  it('sends message_stop event', () => {
    const { res, written } = createMockResponse();
    const writer = new SSEWriter(res);
    writer.sendMessageStop('end_turn', 0);
    const parsed = JSON.parse(written[0].replace('data: ', '').trim());
    expect(parsed).toEqual({
      type: 'message_stop',
      stop_reason: 'end_turn',
      tool_calls_count: 0,
    });
  });

  it('sends error event', () => {
    const { res, written } = createMockResponse();
    const writer = new SSEWriter(res);
    writer.sendError({ type: 'internal_error', message: 'oops', retryable: true });
    const parsed = JSON.parse(written[0].replace('data: ', '').trim());
    expect(parsed.type).toBe('error');
    expect(parsed.error.message).toBe('oops');
  });

  it('does not write after end() is called', () => {
    const { res, written } = createMockResponse();
    const writer = new SSEWriter(res);
    writer.end();
    writer.sendDelta('should not appear');
    expect(written).toHaveLength(0);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('does not write after client disconnects', () => {
    const { res, written, emitter } = createMockResponse();
    const writer = new SSEWriter(res);
    emitter.emit('close');
    writer.sendDelta('should not appear');
    expect(written).toHaveLength(0);
  });

  it('end() is idempotent', () => {
    const { res } = createMockResponse();
    const writer = new SSEWriter(res);
    writer.end();
    writer.end();
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('reports connection state via isOpen', () => {
    const { res, emitter } = createMockResponse();
    const writer = new SSEWriter(res);
    expect(writer.isOpen).toBe(true);
    emitter.emit('close');
    expect(writer.isOpen).toBe(false);
  });
});
