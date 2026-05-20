import { PassThrough } from 'stream';

jest.mock('axios');
import axios from 'axios';

// Mock pino logger to suppress output in tests
jest.mock('../../src/config/logger', () => ({
  child: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { OllamaProvider } from '../../src/providers/ollama';

const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Builds a fake Axios stream response that emits NDJSON lines then ends. */
function makeStream(lines: object[]) {
  const stream = new PassThrough();
  const response = { data: stream };
  // Emit lines asynchronously so the provider has time to attach listeners
  setImmediate(() => {
    for (const line of lines) {
      stream.push(JSON.stringify(line) + '\n');
    }
    stream.push(null); // end
  });
  return Promise.resolve(response);
}

describe('OllamaProvider.chatCompletion (streaming)', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider('llama3.2');
    jest.clearAllMocks();
  });

  it('calls onDelta for each text chunk and returns accumulated text', async () => {
    mockedAxios.post.mockImplementation(() =>
      makeStream([
        { message: { role: 'assistant', content: 'Hello' }, done: false },
        { message: { role: 'assistant', content: ' world' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true },
      ]),
    );

    const deltas: string[] = [];
    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (t) => deltas.push(t),
    });

    expect(deltas).toEqual(['Hello', ' world']);
    expect(result.text).toBe('Hello world');
    expect(result.stopReason).toBe('end_turn');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('does not call onDelta when option is not provided', async () => {
    mockedAxios.post.mockImplementation(() =>
      makeStream([
        { message: { role: 'assistant', content: 'Hi' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true },
      ]),
    );

    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.text).toBe('Hi');
  });

  it('parses tool calls from the done chunk and returns stopReason tool_use', async () => {
    mockedAxios.post.mockImplementation(() =>
      makeStream([
        { message: { role: 'assistant', content: '' }, done: false },
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { function: { name: 'calculator', arguments: { expression: '2+2' } } },
            ],
          },
          done: true,
        },
      ]),
    );

    const result = await provider.chatCompletion({
      messages: [{ role: 'user', content: 'what is 2+2' }],
    });

    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('calculator');
    expect(result.toolCalls[0].arguments).toEqual({ expression: '2+2' });
    expect(result.contentBlocks.some((b) => b.type === 'tool_use')).toBe(true);
  });

  it('rejects when the stream emits an error', async () => {
    const stream = new PassThrough();
    mockedAxios.post.mockResolvedValue({ data: stream });
    setImmediate(() => stream.destroy(new Error('network failure')));

    await expect(
      provider.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('Ollama chat completion failed: network failure');
  });

  it('rejects when stream ends without done:true', async () => {
    const stream = new PassThrough();
    mockedAxios.post.mockResolvedValue({ data: stream });
    setImmediate(() => {
      stream.push('{"message":{"content":"partial"},"done":false}\n');
      stream.push(null); // end stream without done:true
    });

    await expect(
      provider.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('Ollama stream ended without done:true');
  });

  it('uses stream:true in the axios request', async () => {
    mockedAxios.post.mockImplementation(() =>
      makeStream([{ message: { role: 'assistant', content: '' }, done: true }]),
    );

    await provider.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/chat'),
      expect.objectContaining({ stream: true }),
      expect.objectContaining({ responseType: 'stream' }),
    );
  });
});
