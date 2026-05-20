jest.mock('../../src/services/toolRegistry', () => ({
  toolRegistry: {
    execute: jest.fn(),
    getDefinitions: jest.fn(() => []),
  },
}));

jest.mock('../../src/config/logger', () => ({
  child: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { runAgenticLoop, AgenticLoopCallbacks } from '../../src/services/toolExecutor';
import { AIProvider, ProviderCapabilities } from '../../src/providers/types';
import { ChatCompletionOptions, ChatCompletionResult } from '../../src/types';

function makeProvider(
  behavior: (options: ChatCompletionOptions) => ChatCompletionResult,
): AIProvider {
  return {
    name: 'test',
    capabilities: { chatCompletion: true, streaming: false, imageAnalysis: false } as ProviderCapabilities,
    chatCompletion: jest.fn(async (options: ChatCompletionOptions) => behavior(options)),
  };
}

const baseMessages = [{ role: 'user' as const, content: 'hello' }];
const noTools: never[] = [];

describe('runAgenticLoop — onDelta double-fire prevention', () => {
  let callbacks: AgenticLoopCallbacks;

  beforeEach(() => {
    callbacks = {
      onDelta: jest.fn(),
      onToolUseStart: jest.fn(),
      onToolUseResult: jest.fn(),
    };
  });

  it('calls callbacks.onDelta once when provider does NOT call onDelta internally', async () => {
    // Simulates OpenAI/Google: ignores options.onDelta, returns full text
    const provider = makeProvider(() => ({
      text: 'Hello',
      contentBlocks: [{ type: 'text', text: 'Hello' }],
      toolCalls: [],
      stopReason: 'end_turn',
    }));

    await runAgenticLoop(provider, baseMessages, noTools, callbacks);

    expect(callbacks.onDelta).toHaveBeenCalledTimes(1);
    expect(callbacks.onDelta).toHaveBeenCalledWith('Hello');
  });

  it('does NOT double-fire when provider already called onDelta per-token (streaming)', async () => {
    // Simulates Ollama streaming: calls options.onDelta per token
    const provider = makeProvider((options: ChatCompletionOptions) => {
      options.onDelta?.('Hello');
      options.onDelta?.(' world');
      return {
        text: 'Hello world',
        contentBlocks: [{ type: 'text', text: 'Hello world' }],
        toolCalls: [],
        stopReason: 'end_turn',
      };
    });

    await runAgenticLoop(provider, baseMessages, noTools, callbacks);

    // onDelta called exactly twice (per-token), NOT a third time by the loop
    expect(callbacks.onDelta).toHaveBeenCalledTimes(2);
    expect(callbacks.onDelta).toHaveBeenNthCalledWith(1, 'Hello');
    expect(callbacks.onDelta).toHaveBeenNthCalledWith(2, ' world');
  });

  it('returns correct finalText regardless of streaming mode', async () => {
    const provider = makeProvider((options: ChatCompletionOptions) => {
      options.onDelta?.('streamed');
      return {
        text: 'streamed',
        contentBlocks: [{ type: 'text', text: 'streamed' }],
        toolCalls: [],
        stopReason: 'end_turn',
      };
    });

    const result = await runAgenticLoop(provider, baseMessages, noTools, callbacks);

    expect(result.finalText).toBe('streamed');
  });
});
