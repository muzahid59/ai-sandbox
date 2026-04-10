const mockPrisma = {
  thread: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import {
  createThread,
  listThreads,
  getThreadById,
  updateThread,
  softDeleteThread,
} from '../../src/services/threadService';

describe('threadService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createThread', () => {
    it('creates a thread with userId and model', async () => {
      const thread = { id: 'tid-1', userId: 'uid-1', model: 'lama', title: null };
      mockPrisma.thread.create.mockResolvedValue(thread);

      const result = await createThread('uid-1', { model: 'lama' });

      expect(mockPrisma.thread.create).toHaveBeenCalledWith({
        data: {
          userId: 'uid-1',
          model: 'lama',
          title: undefined,
          systemPrompt: undefined,
        },
      });
      expect(result).toEqual(thread);
    });
  });

  describe('listThreads', () => {
    it('lists non-deleted threads for a user, newest first', async () => {
      const threads = [{ id: 'tid-2' }, { id: 'tid-1' }];
      mockPrisma.thread.findMany.mockResolvedValue(threads);

      const result = await listThreads('uid-1');

      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'uid-1', status: { not: 'deleted' } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      );
      expect(result).toEqual(threads);
    });

    it('supports cursor-based pagination', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);

      await listThreads('uid-1', 'cursor-id', 10);

      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'cursor-id' },
          skip: 1,
          take: 10,
        }),
      );
    });
  });

  describe('getThreadById', () => {
    it('returns thread if owned by user', async () => {
      const thread = { id: 'tid-1', userId: 'uid-1' };
      mockPrisma.thread.findFirst.mockResolvedValue(thread);

      const result = await getThreadById('tid-1', 'uid-1');

      expect(mockPrisma.thread.findFirst).toHaveBeenCalledWith({
        where: { id: 'tid-1', userId: 'uid-1' },
      });
      expect(result).toEqual(thread);
    });

    it('returns null if not owned', async () => {
      mockPrisma.thread.findFirst.mockResolvedValue(null);
      const result = await getThreadById('tid-1', 'other-user');
      expect(result).toBeNull();
    });
  });

  describe('updateThread', () => {
    it('updates title if thread exists and is owned', async () => {
      mockPrisma.thread.findFirst.mockResolvedValue({ id: 'tid-1', userId: 'uid-1' });
      mockPrisma.thread.update.mockResolvedValue({ id: 'tid-1', title: 'New Title' });

      const result = await updateThread('tid-1', 'uid-1', { title: 'New Title' });

      expect(mockPrisma.thread.update).toHaveBeenCalledWith({
        where: { id: 'tid-1' },
        data: { title: 'New Title' },
      });
      expect(result.title).toBe('New Title');
    });

    it('throws if thread not found', async () => {
      mockPrisma.thread.findFirst.mockResolvedValue(null);
      await expect(updateThread('tid-1', 'uid-1', { title: 'x' })).rejects.toThrow(
        'Thread not found',
      );
    });
  });

  describe('softDeleteThread', () => {
    it('sets status to deleted', async () => {
      mockPrisma.thread.findFirst.mockResolvedValue({ id: 'tid-1', userId: 'uid-1' });
      mockPrisma.thread.update.mockResolvedValue({ id: 'tid-1', status: 'deleted' });

      await softDeleteThread('tid-1', 'uid-1');

      expect(mockPrisma.thread.update).toHaveBeenCalledWith({
        where: { id: 'tid-1' },
        data: { status: 'deleted' },
      });
    });
  });
});
