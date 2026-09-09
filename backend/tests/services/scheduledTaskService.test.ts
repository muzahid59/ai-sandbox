const mockPrisma = {
  scheduledTask: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  taskExecution: {
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../src/services/threadService', () => ({
  createThread: jest.fn().mockResolvedValue({ id: 'thread-auto-1' }),
}));

jest.mock('../../src/providers', () => ({
  getAvailableModels: jest.fn().mockReturnValue([
    { key: 'gpt-4o', model: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o' },
    { key: 'gemini-1.5-pro', model: 'gemini-1.5-pro', provider: 'google', displayName: 'Gemini 1.5 Pro' },
  ]),
}));

import {
  createTask,
  getTask,
  listTasks,
  updateTask,
  deleteTask,
  getExecutions,
  recordExecution,
} from '../../src/services/scheduledTaskService';

const userId = 'user-1';

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    userId,
    name: 'Test Task',
    prompt: 'Hello AI',
    cronExpression: '0 9 * * 1-5',
    timezone: 'Europe/London',
    model: 'gpt-4o',
    threadId: 'thread-1',
    enabled: true,
    running: false,
    lastRunAt: null,
    nextRunAt: new Date('2026-09-09T09:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exec-1',
    taskId: 'task-1',
    messageId: null,
    status: 'success',
    error: null,
    durationMs: 5000,
    startedAt: new Date('2026-09-08T09:00:00Z'),
    completedAt: new Date('2026-09-08T09:00:05Z'),
    ...overrides,
  };
}

describe('scheduledTaskService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createTask', () => {
    it('creates a task with valid input', async () => {
      mockPrisma.scheduledTask.count.mockResolvedValue(0);
      const task = makeTask();
      mockPrisma.scheduledTask.create.mockResolvedValue(task);

      const result = await createTask(userId, {
        name: 'Test Task',
        prompt: 'Hello AI',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Europe/London',
        model: 'gpt-4o',
        threadId: 'thread-1',
      });

      expect(result).toEqual(task);
      expect(mockPrisma.scheduledTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          name: 'Test Task',
          cronExpression: '0 9 * * 1-5',
          timezone: 'Europe/London',
          model: 'gpt-4o',
          threadId: 'thread-1',
        }),
      });
    });

    it('auto-creates thread when threadId not provided', async () => {
      mockPrisma.scheduledTask.count.mockResolvedValue(0);
      mockPrisma.scheduledTask.create.mockResolvedValue(makeTask({ threadId: 'thread-auto-1' }));

      const result = await createTask(userId, {
        name: 'Test Task',
        prompt: 'Hello AI',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Europe/London',
        model: 'gpt-4o',
      });

      expect(result.threadId).toBe('thread-auto-1');
    });

    it('throws BadRequestError for invalid cron expression', async () => {
      await expect(
        createTask(userId, {
          name: 'Task',
          prompt: 'Hello',
          cronExpression: 'not-a-cron',
          timezone: 'Europe/London',
          model: 'gpt-4o',
        })
      ).rejects.toThrow('Invalid cron expression');
    });

    it('throws BadRequestError for interval less than 5 minutes', async () => {
      await expect(
        createTask(userId, {
          name: 'Task',
          prompt: 'Hello',
          cronExpression: '* * * * *',
          timezone: 'Europe/London',
          model: 'gpt-4o',
        })
      ).rejects.toThrow('at least 5 minutes');
    });

    it('throws BadRequestError for invalid timezone', async () => {
      await expect(
        createTask(userId, {
          name: 'Task',
          prompt: 'Hello',
          cronExpression: '0 9 * * *',
          timezone: 'Invalid/Timezone',
          model: 'gpt-4o',
        })
      ).rejects.toThrow('timezone');
    });

    it('throws BadRequestError for invalid model', async () => {
      await expect(
        createTask(userId, {
          name: 'Task',
          prompt: 'Hello',
          cronExpression: '0 9 * * *',
          timezone: 'Europe/London',
          model: 'nonexistent-model',
        })
      ).rejects.toThrow('model');
    });

    it('throws RateLimitError when task limit reached', async () => {
      mockPrisma.scheduledTask.count.mockResolvedValue(20);

      await expect(
        createTask(userId, {
          name: 'Task',
          prompt: 'Hello',
          cronExpression: '0 9 * * *',
          timezone: 'Europe/London',
          model: 'gpt-4o',
        })
      ).rejects.toThrow('Task limit');
    });

    it('throws ConflictError for duplicate name', async () => {
      mockPrisma.scheduledTask.count.mockResolvedValue(0);
      const prismaError = new Error('Unique constraint failed');
      (prismaError as any).code = 'P2002';
      Object.setPrototypeOf(prismaError, Object.getPrototypeOf(new (require('@prisma/client').Prisma.PrismaClientKnownRequestError)('msg', { code: 'P2002', clientVersion: '5' })));
      mockPrisma.scheduledTask.create.mockRejectedValue(prismaError);

      await expect(
        createTask(userId, {
          name: 'Duplicate',
          prompt: 'Hello',
          cronExpression: '0 9 * * *',
          timezone: 'Europe/London',
          model: 'gpt-4o',
          threadId: 'thread-1',
        })
      ).rejects.toThrow('already exists');
    });
  });

  describe('getTask', () => {
    it('returns task if owned by user', async () => {
      const task = makeTask();
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(task);

      const result = await getTask('task-1', userId);
      expect(result).toEqual(task);
      expect(mockPrisma.scheduledTask.findFirst).toHaveBeenCalledWith({
        where: { id: 'task-1', userId },
      });
    });

    it('returns null if not owned', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(null);
      const result = await getTask('task-1', 'other-user');
      expect(result).toBeNull();
    });
  });

  describe('listTasks', () => {
    it('returns all tasks for user', async () => {
      const tasks = [makeTask(), makeTask({ id: 'task-2', name: 'Task 2' })];
      mockPrisma.scheduledTask.findMany.mockResolvedValue(tasks);

      const result = await listTasks(userId);
      expect(result).toHaveLength(2);
      expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('updateTask (T018: enable/disable)', () => {
    it('sets nextRunAt to null when enabled changes to false', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(makeTask({ enabled: true }));
      mockPrisma.scheduledTask.update.mockResolvedValue(makeTask({ enabled: false, nextRunAt: null }));

      const result = await updateTask('task-1', userId, { enabled: false });

      expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          enabled: false,
          nextRunAt: null,
        }),
      });
      expect(result!.nextRunAt).toBeNull();
    });

    it('computes nextRunAt when enabled changes to true', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(makeTask({ enabled: false, nextRunAt: null }));
      mockPrisma.scheduledTask.update.mockImplementation(async ({ data }: any) => makeTask({ ...data }));

      const result = await updateTask('task-1', userId, { enabled: true });

      expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          enabled: true,
          nextRunAt: expect.any(Date),
        }),
      });
      expect(result!.nextRunAt).not.toBeNull();
    });

    it('retains other fields unchanged across toggle', async () => {
      const original = makeTask({ enabled: true });
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(original);
      mockPrisma.scheduledTask.update.mockImplementation(async ({ data }: any) => ({
        ...original,
        ...data,
      }));

      await updateTask('task-1', userId, { enabled: false });

      const updateCall = mockPrisma.scheduledTask.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('name');
      expect(updateCall.data).not.toHaveProperty('prompt');
      expect(updateCall.data).not.toHaveProperty('cronExpression');
      expect(updateCall.data).not.toHaveProperty('model');
    });

    it('recomputes nextRunAt on schedule changes', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(makeTask());
      mockPrisma.scheduledTask.update.mockImplementation(async ({ data }: any) => makeTask({ ...data }));

      await updateTask('task-1', userId, { cronExpression: '0 10 * * *' });

      expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          cronExpression: '0 10 * * *',
          nextRunAt: expect.any(Date),
        }),
      });
    });

    it('returns null for non-owned task', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(null);
      const result = await updateTask('task-1', 'other-user', { name: 'New Name' });
      expect(result).toBeNull();
    });
  });

  describe('deleteTask', () => {
    it('deletes owned task and returns true', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(makeTask());
      mockPrisma.scheduledTask.delete.mockResolvedValue(undefined);

      const result = await deleteTask('task-1', userId);
      expect(result).toBe(true);
      expect(mockPrisma.scheduledTask.delete).toHaveBeenCalledWith({ where: { id: 'task-1' } });
    });

    it('returns false for non-owned task', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(null);
      const result = await deleteTask('task-1', 'other-user');
      expect(result).toBe(false);
    });
  });

  describe('getExecutions (T025)', () => {
    it('returns executions sorted by startedAt desc', async () => {
      const task = makeTask();
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(task);
      const execs = [
        makeExecution({ startedAt: new Date('2026-09-08T10:00:00Z') }),
        makeExecution({ id: 'exec-2', startedAt: new Date('2026-09-08T09:00:00Z') }),
      ];
      mockPrisma.taskExecution.findMany.mockResolvedValue(execs);

      const result = await getExecutions('task-1', userId, 20);
      expect(result.executions).toHaveLength(2);
      expect(mockPrisma.taskExecution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { startedAt: 'desc' },
        })
      );
    });

    it('respects limit parameter', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(makeTask());
      mockPrisma.taskExecution.findMany.mockResolvedValue([makeExecution()]);

      await getExecutions('task-1', userId, 5);
      expect(mockPrisma.taskExecution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 6,
        })
      );
    });

    it('caps limit at 50', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(makeTask());
      mockPrisma.taskExecution.findMany.mockResolvedValue([]);

      await getExecutions('task-1', userId, 100);
      expect(mockPrisma.taskExecution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 51,
        })
      );
    });

    it('computes nextCursor when more results exist', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(makeTask());
      const execs = [
        makeExecution({ startedAt: new Date('2026-09-08T10:00:00Z') }),
        makeExecution({ id: 'exec-2', startedAt: new Date('2026-09-08T09:00:00Z') }),
        makeExecution({ id: 'exec-3', startedAt: new Date('2026-09-08T08:00:00Z') }),
      ];
      mockPrisma.taskExecution.findMany.mockResolvedValue(execs);

      const result = await getExecutions('task-1', userId, 2);
      expect(result.executions).toHaveLength(2);
      expect(result.nextCursor).toBe(new Date('2026-09-08T09:00:00Z').toISOString());
    });

    it('returns empty array for task with no executions', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(makeTask());
      mockPrisma.taskExecution.findMany.mockResolvedValue([]);

      const result = await getExecutions('task-1', userId);
      expect(result.executions).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it('throws NotFoundError for non-owned task', async () => {
      mockPrisma.scheduledTask.findFirst.mockResolvedValue(null);
      await expect(getExecutions('task-1', 'other-user')).rejects.toThrow('Task not found');
    });
  });

  describe('recordExecution (T024)', () => {
    it('inserts execution with all fields', async () => {
      const exec = makeExecution();
      mockPrisma.taskExecution.create.mockResolvedValue(exec);
      mockPrisma.taskExecution.count.mockResolvedValue(1);

      const result = await recordExecution('task-1', {
        status: 'success',
        durationMs: 5000,
        startedAt: new Date('2026-09-08T09:00:00Z'),
        completedAt: new Date('2026-09-08T09:00:05Z'),
      });

      expect(result).toEqual(exec);
      expect(mockPrisma.taskExecution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: 'task-1',
          status: 'success',
          durationMs: 5000,
        }),
      });
    });

    it('prunes records beyond 50 per task', async () => {
      mockPrisma.taskExecution.create.mockResolvedValue(makeExecution());
      mockPrisma.taskExecution.count.mockResolvedValue(52);
      mockPrisma.taskExecution.findMany.mockResolvedValue([
        { id: 'old-1' },
        { id: 'old-2' },
      ]);
      mockPrisma.taskExecution.deleteMany.mockResolvedValue({ count: 2 });

      await recordExecution('task-1', {
        status: 'success',
        startedAt: new Date(),
      });

      expect(mockPrisma.taskExecution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 'task-1' },
          orderBy: { startedAt: 'asc' },
          take: 2,
          select: { id: true },
        })
      );
      expect(mockPrisma.taskExecution.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-1', 'old-2'] } },
      });
    });

    it('does not prune when under limit', async () => {
      mockPrisma.taskExecution.create.mockResolvedValue(makeExecution());
      mockPrisma.taskExecution.count.mockResolvedValue(10);

      await recordExecution('task-1', {
        status: 'success',
        startedAt: new Date(),
      });

      expect(mockPrisma.taskExecution.deleteMany).not.toHaveBeenCalled();
    });
  });
});
