const mockPrisma = {
  memory: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findUnique: jest.fn(),
  },
  userPreferences: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../src/services/contextService', () => ({
  contextService: { estimateTokens: (text: string) => Math.ceil(text.length / 4) },
}));

import * as memoryService from '../../src/services/memoryService';
import { MemoryLimitError, DuplicateMemoryError, isDuplicate } from '../../src/services/memoryService';

const userId = 'user-1';
const memoryId = 'mem-1';

const makeMemory = (overrides = {}) => ({
  id: memoryId,
  userId,
  content: 'User is a backend engineer',
  source: 'manual' as const,
  sourceThreadId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('isDuplicate', () => {
  it('returns true for identical content', () => {
    expect(isDuplicate('hello world', ['hello world'])).toBe(true);
  });

  it('returns false for unrelated content', () => {
    expect(isDuplicate('cats and dogs', ['user is a software engineer'])).toBe(false);
  });

  it('returns true for near-duplicate (jaccard >= 0.75)', () => {
    expect(isDuplicate('I am a backend engineer', ['User is a backend engineer'])).toBe(false);
  });

  it('returns false for empty existing list', () => {
    expect(isDuplicate('some content', [])).toBe(false);
  });
});

describe('listMemories', () => {
  it('returns memories ordered by updatedAt DESC', async () => {
    const memories = [makeMemory(), makeMemory({ id: 'mem-2' })];
    mockPrisma.memory.findMany.mockResolvedValue(memories);

    const result = await memoryService.listMemories(userId);

    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    expect(result).toBe(memories);
  });

  it('uses limit and beforeId cursor', async () => {
    const refMemory = makeMemory({ id: 'mem-ref', updatedAt: new Date('2024-01-15') });
    mockPrisma.memory.findFirst.mockResolvedValue(refMemory);
    mockPrisma.memory.findMany.mockResolvedValue([]);

    await memoryService.listMemories(userId, 10, 'mem-ref');

    expect(mockPrisma.memory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mem-ref', userId } }),
    );
    expect(mockPrisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });
});

describe('createMemory', () => {
  it('saves with source manual', async () => {
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.findMany.mockResolvedValue([]);
    const created = makeMemory();
    mockPrisma.memory.create.mockResolvedValue(created);

    const result = await memoryService.createMemory(userId, 'User is a backend engineer', 'manual');

    expect(mockPrisma.memory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'manual' }),
      }),
    );
    expect(result).toBe(created);
  });

  it('throws MemoryLimitError when count >= 200', async () => {
    mockPrisma.memory.count.mockResolvedValue(200);

    await expect(memoryService.createMemory(userId, 'content', 'manual')).rejects.toBeInstanceOf(MemoryLimitError);
  });

  it('throws DuplicateMemoryError for Jaccard >= 0.75', async () => {
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.findMany.mockResolvedValue([{ content: 'hello world foo bar' }]);

    await expect(memoryService.createMemory(userId, 'hello world foo bar', 'manual')).rejects.toBeInstanceOf(DuplicateMemoryError);
  });

  it('succeeds for content with Jaccard < 0.75', async () => {
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.findMany.mockResolvedValue([{ content: 'completely different topic' }]);
    const created = makeMemory();
    mockPrisma.memory.create.mockResolvedValue(created);

    const result = await memoryService.createMemory(userId, 'user loves cats and dogs', 'manual');
    expect(result).toBe(created);
  });
});

describe('updateMemory', () => {
  it('throws NotFoundError for another user\'s memory', async () => {
    mockPrisma.memory.findFirst.mockResolvedValue(null);

    const { NotFoundError } = await import('../../src/errors');
    await expect(memoryService.updateMemory('other-user', memoryId, 'new content')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates content successfully', async () => {
    const existing = makeMemory();
    mockPrisma.memory.findFirst.mockResolvedValue(existing);
    mockPrisma.memory.findMany.mockResolvedValue([]);
    const updated = makeMemory({ content: 'updated content' });
    mockPrisma.memory.update.mockResolvedValue(updated);

    const result = await memoryService.updateMemory(userId, memoryId, 'updated content');
    expect(result).toBe(updated);
  });
});

describe('deleteMemory', () => {
  it('throws NotFoundError for another user\'s memory', async () => {
    mockPrisma.memory.findFirst.mockResolvedValue(null);

    const { NotFoundError } = await import('../../src/errors');
    await expect(memoryService.deleteMemory('other-user', memoryId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes successfully for own memory', async () => {
    mockPrisma.memory.findFirst.mockResolvedValue(makeMemory());
    mockPrisma.memory.delete.mockResolvedValue(undefined);

    await expect(memoryService.deleteMemory(userId, memoryId)).resolves.toBeUndefined();
    expect(mockPrisma.memory.delete).toHaveBeenCalledWith({ where: { id: memoryId } });
  });
});

describe('buildMemorySystemPrompt', () => {
  it('returns empty string for user with no memories and no customInstructions', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([]);
    mockPrisma.userPreferences.findUnique.mockResolvedValue({ customInstructions: null });

    const result = await memoryService.buildMemorySystemPrompt(userId);
    expect(result).toBe('');
  });

  it('returns empty string for empty userId', async () => {
    const result = await memoryService.buildMemorySystemPrompt('');
    expect(result).toBe('');
  });

  it('includes customInstructions when set', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([]);
    mockPrisma.userPreferences.findUnique.mockResolvedValue({ customInstructions: 'Always respond in French' });

    const result = await memoryService.buildMemorySystemPrompt(userId);
    expect(result).toContain('Always respond in French');
  });

  it('includes memories in the [WHAT YOU KNOW ABOUT THE USER] block', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([{ content: 'User is a backend engineer' }]);
    mockPrisma.userPreferences.findUnique.mockResolvedValue({ customInstructions: null });

    const result = await memoryService.buildMemorySystemPrompt(userId);
    expect(result).toContain('[WHAT YOU KNOW ABOUT THE USER]');
    expect(result).toContain('- User is a backend engineer');
  });

  it('trims oldest memories when token budget is exceeded', async () => {
    const longContent = 'a'.repeat(400);
    const memories = Array.from({ length: 25 }, (_, i) => ({ content: `${longContent}-${i}` }));
    mockPrisma.memory.findMany.mockResolvedValue(memories);
    mockPrisma.userPreferences.findUnique.mockResolvedValue({ customInstructions: null });

    const result = await memoryService.buildMemorySystemPrompt(userId);
    const lineCount = (result.match(/^- /gm) ?? []).length;
    expect(lineCount).toBeLessThan(25);
  });

  it('preserves customInstructions even when no memories fit', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([]);
    mockPrisma.userPreferences.findUnique.mockResolvedValue({ customInstructions: 'Be concise' });

    const result = await memoryService.buildMemorySystemPrompt(userId);
    expect(result).toContain('Be concise');
  });
});
