const mockPrisma = {
  memory: {
    count: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

const mockChatCompletion = jest.fn();

jest.mock('../../src/providers', () => ({
  createProvider: jest.fn().mockReturnValue({
    chatCompletion: mockChatCompletion,
  }),
}));

jest.mock('../../src/services/contextService', () => ({
  contextService: { estimateTokens: (t: string) => Math.ceil(t.length / 4) },
}));

import { extractAndSaveMemories } from '../../src/services/memoryExtractionService';

const userId = 'user-1';
const threadId = 'thread-1';
const model = 'openai';

afterEach(() => {
  jest.clearAllMocks();
});

describe('extractAndSaveMemories', () => {
  it('calls provider with extraction prompt containing user message and AI response', async () => {
    mockChatCompletion.mockResolvedValue({ text: '[]', contentBlocks: [], toolCalls: [], stopReason: 'end_turn' });
    mockPrisma.memory.findMany.mockResolvedValue([]);

    await extractAndSaveMemories(userId, threadId, model, 'I am a backend engineer', 'Great!');

    expect(mockChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: expect.stringContaining('I am a backend engineer') }),
        ]),
      }),
    );
  });

  it('saves extracted facts with source extracted and correct sourceThreadId', async () => {
    mockChatCompletion.mockResolvedValue({ text: '["User is a backend engineer"]', contentBlocks: [], toolCalls: [], stopReason: 'end_turn' });
    mockPrisma.memory.findMany.mockResolvedValue([]);
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.create.mockResolvedValue({ id: 'm1', userId, content: 'User is a backend engineer', source: 'extracted', sourceThreadId: threadId });

    await extractAndSaveMemories(userId, threadId, model, 'I am a backend engineer', 'Great!');

    expect(mockPrisma.memory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'extracted',
          sourceThreadId: threadId,
        }),
      }),
    );
  });

  it('skips duplicate facts', async () => {
    mockChatCompletion.mockResolvedValue({ text: '["User is a backend engineer"]', contentBlocks: [], toolCalls: [], stopReason: 'end_turn' });
    mockPrisma.memory.findMany.mockResolvedValue([{ content: 'User is a backend engineer' }]);

    await extractAndSaveMemories(userId, threadId, model, 'I am a backend engineer', 'Great!');

    expect(mockPrisma.memory.create).not.toHaveBeenCalled();
  });

  it('handles JSON parse failure gracefully without throwing', async () => {
    mockChatCompletion.mockResolvedValue({ text: 'not valid json at all', contentBlocks: [], toolCalls: [], stopReason: 'end_turn' });

    await expect(extractAndSaveMemories(userId, threadId, model, 'message', 'reply')).resolves.toBeUndefined();
    expect(mockPrisma.memory.create).not.toHaveBeenCalled();
  });

  it('handles provider error gracefully without throwing', async () => {
    mockChatCompletion.mockRejectedValue(new Error('provider failure'));

    await expect(extractAndSaveMemories(userId, threadId, model, 'message', 'reply')).resolves.toBeUndefined();
  });

  it('does not save more than 5 facts per turn', async () => {
    const facts = [
      'User works at Acme Corporation as a principal engineer',
      'User studied mathematics at Cambridge University',
      'User owns three cats named Pixel Mochi Biscuit',
      'User runs marathons and completed Boston last spring',
      'User prefers dark chocolate over milk chocolate',
      'User recently moved to Berlin from Tokyo',
      'User speaks fluent Japanese Korean and Mandarin',
      'User builds custom mechanical keyboards as a hobby',
      'User is writing a science fiction novel set on Mars',
      'User volunteers at the local food bank every weekend',
    ];
    mockChatCompletion.mockResolvedValue({ text: JSON.stringify(facts), contentBlocks: [], toolCalls: [], stopReason: 'end_turn' });
    mockPrisma.memory.findMany.mockResolvedValue([]);
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.create.mockResolvedValue({ id: 'm1' });

    await extractAndSaveMemories(userId, threadId, model, 'message', 'reply');

    expect(mockPrisma.memory.create).toHaveBeenCalledTimes(5);
  });

  it('stops saving when user reaches 200-memory limit', async () => {
    mockChatCompletion.mockResolvedValue({ text: '["Fact one about user", "Fact two about user"]', contentBlocks: [], toolCalls: [], stopReason: 'end_turn' });
    mockPrisma.memory.findMany.mockResolvedValue([]);
    mockPrisma.memory.count.mockResolvedValue(200);

    await extractAndSaveMemories(userId, threadId, model, 'message', 'reply');

    expect(mockPrisma.memory.create).not.toHaveBeenCalled();
  });
});
