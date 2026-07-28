const mockBuildMemorySystemPrompt = jest.fn();

jest.mock('../../src/services/memoryService', () => ({
  buildMemorySystemPrompt: mockBuildMemorySystemPrompt,
}));

const mockRunAgenticLoop = jest.fn();
jest.mock('../../src/services/toolExecutor', () => ({
  runAgenticLoop: mockRunAgenticLoop,
}));

const mockCreateProvider = jest.fn();
jest.mock('../../src/providers', () => ({
  createProvider: mockCreateProvider,
}));

jest.mock('../../src/services/toolRegistry', () => ({
  toolRegistry: { getDefinitions: jest.fn().mockReturnValue([]) },
}));

jest.mock('../../src/services/contextService', () => ({
  contextService: {
    buildContextWindow: jest.fn().mockResolvedValue([{ role: 'user', content: 'hello' }]),
    estimateTokens: (t: string) => Math.ceil(t.length / 4),
  },
}));

jest.mock('../../src/prompts', () => ({
  getSystemPrompt: jest.fn().mockReturnValue('BASE_SYSTEM_PROMPT'),
}));

import { processMessage } from '../../src/services/chatService';

const mockThread = {
  id: 'thread-1',
  userId: 'user-1',
  model: 'openai',
  title: null,
  systemPrompt: null,
  tokenCount: 0,
  status: 'active' as const,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCallbacks = {
  onDelta: jest.fn(),
  onToolUseStart: jest.fn(),
  onToolUseResult: jest.fn(),
};

const mockLoopResult = {
  finalText: 'Hello there',
  toolCallRecords: [],
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('chatService.processMessage — memory injection', () => {
  beforeEach(() => {
    mockCreateProvider.mockReturnValue({ name: 'openai', capabilities: {} });
    mockRunAgenticLoop.mockResolvedValue(mockLoopResult);
  });

  it('includes memory block in system prompt when user has memories', async () => {
    mockBuildMemorySystemPrompt.mockResolvedValue('MEMORY_BLOCK\n\n---');

    await processMessage(mockThread, [{ type: 'text', text: 'hi' }], undefined, mockCallbacks, 'user-1');

    const call = mockRunAgenticLoop.mock.calls[0];
    const messages = call[1];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('MEMORY_BLOCK');
    expect(systemMsg.content).toContain('BASE_SYSTEM_PROMPT');
  });

  it('uses only base system prompt when user has no memories', async () => {
    mockBuildMemorySystemPrompt.mockResolvedValue('');

    await processMessage(mockThread, [{ type: 'text', text: 'hi' }], undefined, mockCallbacks, 'user-1');

    const call = mockRunAgenticLoop.mock.calls[0];
    const messages = call[1];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toBe('BASE_SYSTEM_PROMPT');
  });

  it('calls buildMemorySystemPrompt with the userId passed to processMessage', async () => {
    mockBuildMemorySystemPrompt.mockResolvedValue('');

    await processMessage(mockThread, [{ type: 'text', text: 'hi' }], undefined, mockCallbacks, 'my-user-id');

    expect(mockBuildMemorySystemPrompt).toHaveBeenCalledWith('my-user-id');
  });

  it('calls buildMemorySystemPrompt with empty string when no userId provided', async () => {
    mockBuildMemorySystemPrompt.mockResolvedValue('');

    await processMessage(mockThread, [{ type: 'text', text: 'hi' }], undefined, mockCallbacks);

    expect(mockBuildMemorySystemPrompt).toHaveBeenCalledWith('');
  });
});
