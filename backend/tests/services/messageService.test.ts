const mockPrisma = {
  message: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  thread: {
    update: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import {
  createMessage,
  getByThread,
  updateMessageStatus,
  countByThread,
  incrementThreadTokens,
} from '../../src/services/messageService';

describe('messageService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createMessage', () => {
    it('creates a message with content blocks', async () => {
      const msg = {
        id: 'mid-1',
        threadId: 'tid-1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        status: 'complete',
      };
      mockPrisma.message.create.mockResolvedValue(msg);

      const result = await createMessage({
        threadId: 'tid-1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        status: 'complete',
      });

      expect(result).toEqual(msg);
      expect(mockPrisma.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          threadId: 'tid-1',
          role: 'user',
          status: 'complete',
        }),
      });
    });
  });

  describe('getByThread', () => {
    it('returns messages in chronological order', async () => {
      const msgs = [{ id: 'mid-2', createdAt: '2' }, { id: 'mid-1', createdAt: '1' }];
      mockPrisma.message.findMany.mockResolvedValue(msgs);

      const result = await getByThread('tid-1');

      // findMany returns DESC, getByThread reverses to chronological
      expect(result).toEqual([{ id: 'mid-1', createdAt: '1' }, { id: 'mid-2', createdAt: '2' }]);
    });

    it('supports cursor pagination', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);

      await getByThread('tid-1', 'mid-5', 10);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'mid-5' },
          skip: 1,
          take: 10,
        }),
      );
    });
  });

  describe('updateMessageStatus', () => {
    it('sets status and completedAt on complete', async () => {
      mockPrisma.message.update.mockResolvedValue({ id: 'mid-1', status: 'complete' });

      await updateMessageStatus('mid-1', 'complete', {
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      });

      const call = mockPrisma.message.update.mock.calls[0][0];
      expect(call.data.status).toBe('complete');
      expect(call.data.completedAt).toBeDefined();
      expect(call.data.stopReason).toBe('end_turn');
    });
  });

  describe('incrementThreadTokens', () => {
    it('increments token_count atomically', async () => {
      mockPrisma.thread.update.mockResolvedValue({});

      await incrementThreadTokens('tid-1', 500);

      expect(mockPrisma.thread.update).toHaveBeenCalledWith({
        where: { id: 'tid-1' },
        data: { tokenCount: { increment: 500 } },
      });
    });
  });
});
