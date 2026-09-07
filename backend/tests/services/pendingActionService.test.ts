const mockPrisma = {
  pendingAction: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

const mockCreateMessage = jest.fn();
jest.mock('../../src/services/messageService', () => ({
  createMessage: mockCreateMessage,
}));

jest.mock('../../src/config/logger', () => ({
  child: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import {
  createPendingAction,
  getPendingAction,
  getThreadPendingAction,
  resolvePendingAction,
  expireOverdue,
} from '../../src/services/pendingActionService';

const makePendingAction = (overrides: Record<string, unknown> = {}) => ({
  id: 'pa-1',
  threadId: 'thread-1',
  userId: 'user-1',
  messageId: 'msg-1',
  toolName: 'test_approval',
  toolCallId: 'tc-1',
  arguments: { message: 'hello' },
  status: 'pending',
  expiresAt: new Date(Date.now() + 600_000),
  resolvedAt: null,
  createdAt: new Date(),
  ...overrides,
});

describe('pendingActionService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createPendingAction', () => {
    it('creates a pending action with default TTL', async () => {
      const created = makePendingAction();
      mockPrisma.pendingAction.create.mockResolvedValue(created);

      const result = await createPendingAction({
        threadId: 'thread-1',
        userId: 'user-1',
        messageId: 'msg-1',
        toolName: 'test_approval',
        toolCallId: 'tc-1',
        arguments: { message: 'hello' },
      });

      expect(result).toEqual(created);
      expect(mockPrisma.pendingAction.create).toHaveBeenCalledTimes(1);
      const callData = mockPrisma.pendingAction.create.mock.calls[0][0].data;
      expect(callData.threadId).toBe('thread-1');
      expect(callData.toolName).toBe('test_approval');
      expect(callData.expiresAt).toBeInstanceOf(Date);
      const ttlMs = callData.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(590_000);
      expect(ttlMs).toBeLessThanOrEqual(600_000);
    });

    it('respects PENDING_ACTION_TTL_SECONDS env var', async () => {
      process.env.PENDING_ACTION_TTL_SECONDS = '120';
      const created = makePendingAction();
      mockPrisma.pendingAction.create.mockResolvedValue(created);

      await createPendingAction({
        threadId: 'thread-1',
        userId: 'user-1',
        messageId: 'msg-1',
        toolName: 'test_approval',
        toolCallId: 'tc-1',
        arguments: { message: 'hello' },
      });

      const callData = mockPrisma.pendingAction.create.mock.calls[0][0].data;
      const ttlMs = callData.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(110_000);
      expect(ttlMs).toBeLessThanOrEqual(120_000);
      delete process.env.PENDING_ACTION_TTL_SECONDS;
    });
  });

  describe('getPendingAction', () => {
    it('returns action when found with matching userId', async () => {
      const action = makePendingAction();
      mockPrisma.pendingAction.findFirst.mockResolvedValue(action);

      const result = await getPendingAction('pa-1', 'user-1');

      expect(result).toEqual(action);
      expect(mockPrisma.pendingAction.findFirst).toHaveBeenCalledWith({
        where: { id: 'pa-1', userId: 'user-1' },
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.pendingAction.findFirst.mockResolvedValue(null);

      const result = await getPendingAction('nonexistent', 'user-1');
      expect(result).toBeNull();
    });
  });

  describe('getThreadPendingAction', () => {
    it('returns pending action for thread', async () => {
      const action = makePendingAction();
      mockPrisma.pendingAction.findFirst.mockResolvedValue(action);

      const result = await getThreadPendingAction('thread-1');

      expect(result).toEqual(action);
      expect(mockPrisma.pendingAction.findFirst).toHaveBeenCalledWith({
        where: { threadId: 'thread-1', status: 'pending' },
      });
    });

    it('returns null when no pending action exists', async () => {
      mockPrisma.pendingAction.findFirst.mockResolvedValue(null);

      const result = await getThreadPendingAction('thread-1');
      expect(result).toBeNull();
    });
  });

  describe('resolvePendingAction', () => {
    it('transitions to approved', async () => {
      const action = makePendingAction();
      const updated = makePendingAction({ status: 'approved', resolvedAt: new Date() });

      mockPrisma.pendingAction.findFirst.mockResolvedValue(action);
      mockPrisma.pendingAction.update.mockResolvedValue(updated);

      const result = await resolvePendingAction('pa-1', 'user-1', 'approved');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.action.status).toBe('approved');
      }
    });

    it('transitions to rejected', async () => {
      const action = makePendingAction();
      const updated = makePendingAction({ status: 'rejected', resolvedAt: new Date() });

      mockPrisma.pendingAction.findFirst.mockResolvedValue(action);
      mockPrisma.pendingAction.update.mockResolvedValue(updated);

      const result = await resolvePendingAction('pa-1', 'user-1', 'rejected');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.action.status).toBe('rejected');
      }
    });

    it('transitions to expired', async () => {
      const action = makePendingAction({ expiresAt: new Date(Date.now() - 1000) });
      const updated = makePendingAction({ status: 'expired', resolvedAt: new Date() });

      mockPrisma.pendingAction.findFirst.mockResolvedValue(action);
      mockPrisma.pendingAction.update.mockResolvedValue(updated);

      const result = await resolvePendingAction('pa-1', 'user-1', 'expired');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.action.status).toBe('expired');
      }
    });

    it('returns not_found when action does not exist', async () => {
      mockPrisma.pendingAction.findFirst.mockResolvedValue(null);

      const result = await resolvePendingAction('nonexistent', 'user-1', 'approved');

      expect(result).toEqual({ ok: false, error: 'not_found' });
    });

    it('returns already_resolved when action is not pending', async () => {
      const action = makePendingAction({ status: 'approved' });
      mockPrisma.pendingAction.findFirst.mockResolvedValue(action);

      const result = await resolvePendingAction('pa-1', 'user-1', 'rejected');

      expect(result).toEqual({ ok: false, error: 'already_resolved' });
    });

    it('returns expired when action has expired and status is not expired', async () => {
      const action = makePendingAction({ expiresAt: new Date(Date.now() - 1000) });
      mockPrisma.pendingAction.findFirst.mockResolvedValue(action);
      mockPrisma.pendingAction.update.mockResolvedValue({
        ...action,
        status: 'expired',
        resolvedAt: new Date(),
      });

      const result = await resolvePendingAction('pa-1', 'user-1', 'approved');

      expect(result).toEqual({ ok: false, error: 'expired' });
      expect(mockPrisma.pendingAction.update).toHaveBeenCalledWith({
        where: { id: 'pa-1' },
        data: expect.objectContaining({ status: 'expired' }),
      });
    });
  });

  describe('expireOverdue', () => {
    it('expires overdue actions and creates assistant messages', async () => {
      const overdueActions = [
        makePendingAction({ id: 'pa-1', threadId: 'thread-1' }),
        makePendingAction({ id: 'pa-2', threadId: 'thread-2' }),
      ];
      mockPrisma.pendingAction.findMany.mockResolvedValue(overdueActions);
      mockPrisma.pendingAction.updateMany.mockResolvedValue({ count: 2 });
      mockCreateMessage.mockResolvedValue({});

      const count = await expireOverdue();

      expect(count).toBe(2);
      expect(mockPrisma.pendingAction.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['pa-1', 'pa-2'] } },
        data: expect.objectContaining({ status: 'expired' }),
      });
      expect(mockCreateMessage).toHaveBeenCalledTimes(2);
      expect(mockCreateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
        }),
      );
    });

    it('returns 0 when no overdue actions exist', async () => {
      mockPrisma.pendingAction.findMany.mockResolvedValue([]);

      const count = await expireOverdue();

      expect(count).toBe(0);
      expect(mockPrisma.pendingAction.updateMany).not.toHaveBeenCalled();
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });

    it('continues expiring even if message creation fails', async () => {
      const overdueActions = [
        makePendingAction({ id: 'pa-1', threadId: 'thread-1' }),
      ];
      mockPrisma.pendingAction.findMany.mockResolvedValue(overdueActions);
      mockPrisma.pendingAction.updateMany.mockResolvedValue({ count: 1 });
      mockCreateMessage.mockRejectedValue(new Error('DB error'));

      const count = await expireOverdue();

      expect(count).toBe(1);
    });
  });
});
