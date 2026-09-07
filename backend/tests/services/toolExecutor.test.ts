const mockExecute = jest.fn();
jest.mock('../../src/services/toolRegistry', () => ({
  toolRegistry: {
    execute: mockExecute,
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
import { ChatCompletionOptions, ChatCompletionResult, ToolDefinition } from '../../src/types';

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

describe('runAgenticLoop — approval suspension', () => {
  let callbacks: AgenticLoopCallbacks;

  beforeEach(() => {
    jest.clearAllMocks();
    callbacks = {
      onDelta: jest.fn(),
      onToolUseStart: jest.fn(),
      onToolUseResult: jest.fn(),
      onApprovalRequired: jest.fn(),
    };
  });

  const approvalTool: ToolDefinition = {
    name: 'test_approval',
    description: 'Test tool requiring approval',
    input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    requiresApproval: true,
  };

  const normalTool: ToolDefinition = {
    name: 'web_search',
    description: 'Search the web',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  };

  it('suspends when tool has requiresApproval: true', async () => {
    const provider = makeProvider(() => ({
      text: '',
      contentBlocks: [
        { type: 'tool_use', id: 'tc-1', name: 'test_approval', input: { message: 'hello' } },
      ],
      toolCalls: [{ id: 'tc-1', name: 'test_approval', arguments: { message: 'hello' } }],
      stopReason: 'tool_use',
    }));

    const result = await runAgenticLoop(
      provider,
      [{ role: 'user', content: 'test' }],
      [approvalTool],
      callbacks,
    );

    expect(result.suspended).toBeDefined();
    expect(result.suspended!.toolCall.name).toBe('test_approval');
    expect(result.suspended!.contentBlocks).toHaveLength(1);
    expect(callbacks.onApprovalRequired).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('does not suspend when tool does not have requiresApproval', async () => {
    mockExecute.mockResolvedValue({ output: 'search results', is_error: false });

    let callCount = 0;
    const provider = makeProvider(() => {
      callCount++;
      if (callCount === 1) {
        return {
          text: '',
          contentBlocks: [
            { type: 'tool_use', id: 'tc-1', name: 'web_search', input: { query: 'test' } },
          ],
          toolCalls: [{ id: 'tc-1', name: 'web_search', arguments: { query: 'test' } }],
          stopReason: 'tool_use',
        };
      }
      return {
        text: 'Here are the results',
        contentBlocks: [{ type: 'text', text: 'Here are the results' }],
        toolCalls: [],
        stopReason: 'end_turn',
      };
    });

    const result = await runAgenticLoop(
      provider,
      [{ role: 'user', content: 'search' }],
      [normalTool],
      callbacks,
    );

    expect(result.suspended).toBeUndefined();
    expect(result.finalText).toBe('Here are the results');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(callbacks.onApprovalRequired).not.toHaveBeenCalled();
  });

  it('suspends on the first approval-required tool among multiple tool calls', async () => {
    const provider = makeProvider(() => ({
      text: '',
      contentBlocks: [
        { type: 'tool_use', id: 'tc-1', name: 'web_search', input: { query: 'test' } },
        { type: 'tool_use', id: 'tc-2', name: 'test_approval', input: { message: 'hello' } },
      ],
      toolCalls: [
        { id: 'tc-1', name: 'web_search', arguments: { query: 'test' } },
        { id: 'tc-2', name: 'test_approval', arguments: { message: 'hello' } },
      ],
      stopReason: 'tool_use',
    }));

    const result = await runAgenticLoop(
      provider,
      [{ role: 'user', content: 'test' }],
      [normalTool, approvalTool],
      callbacks,
    );

    expect(result.suspended).toBeDefined();
    expect(result.suspended!.toolCall.name).toBe('test_approval');
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
