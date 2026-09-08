const mockBossInstance = {
  start: jest.fn(),
  stop: jest.fn(),
  schedule: jest.fn(),
  unschedule: jest.fn(),
  work: jest.fn(),
  offWork: jest.fn(),
};

const MockPgBoss = jest.fn().mockImplementation(() => mockBossInstance);

jest.mock('pg-boss', () => ({
  PgBoss: MockPgBoss,
}));

const mockPrisma = {
  scheduledTask: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  thread: {
    findUnique: jest.fn(),
  },
  message: {
    create: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

const mockProcessMessage = jest.fn();
jest.mock('../../src/services/chatService', () => ({
  processMessage: mockProcessMessage,
}));

const mockRecordExecution = jest.fn();
jest.mock('../../src/services/scheduledTaskService', () => ({
  recordExecution: mockRecordExecution,
}));

jest.mock('cron-parser', () => ({
  CronExpressionParser: {
    parse: jest.fn().mockReturnValue({
      next: () => ({ toDate: () => new Date('2026-09-09T09:00:00Z') }),
    }),
  },
}));

import {
  initScheduler,
  scheduleTask,
  unscheduleTask,
  rescheduleTask,
  loadAllTasks,
  registerWorker,
  stopScheduler,
} from '../../src/services/taskScheduler';
import { ScheduledTask } from '@prisma/client';

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    userId: 'user-1',
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

function makeThread() {
  return {
    id: 'thread-1',
    userId: 'user-1',
    model: 'gpt-4o',
    title: 'Test Thread',
    systemPrompt: null,
    tokenCount: 0,
    status: 'active',
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('taskScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBossInstance.start.mockResolvedValue(undefined);
    mockBossInstance.stop.mockResolvedValue(undefined);
    mockBossInstance.schedule.mockResolvedValue(undefined);
    mockBossInstance.unschedule.mockResolvedValue(undefined);
    mockBossInstance.work.mockResolvedValue(undefined);
    mockBossInstance.offWork.mockResolvedValue(undefined);
  });

  describe('initScheduler (T027)', () => {
    it('starts pg-boss successfully', async () => {
      await initScheduler('postgres://localhost/test');
      expect(MockPgBoss).toHaveBeenCalledWith('postgres://localhost/test');
      expect(mockBossInstance.start).toHaveBeenCalledTimes(1);
    });

    it('retries with exponential backoff on failure', async () => {
      mockBossInstance.start
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce(undefined);

      const realSetTimeout = global.setTimeout;
      jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
        fn();
        return 0 as any;
      });

      await initScheduler('postgres://localhost/test');
      expect(mockBossInstance.start).toHaveBeenCalledTimes(3);

      (global.setTimeout as any).mockRestore?.();
      global.setTimeout = realSetTimeout;
    });

    it('throws after all retry attempts fail', async () => {
      mockBossInstance.start.mockRejectedValue(new Error('Connection refused'));

      jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
        fn();
        return 0 as any;
      });

      await expect(initScheduler('postgres://localhost/test')).rejects.toThrow(
        'Failed to start pg-boss'
      );
      expect(mockBossInstance.start).toHaveBeenCalledTimes(3);

      (global.setTimeout as any).mockRestore?.();
    });
  });

  describe('scheduleTask', () => {
    it('registers cron schedule and worker with pg-boss', async () => {
      await initScheduler('postgres://localhost/test');
      const task = makeTask();
      await scheduleTask(task);

      expect(mockBossInstance.schedule).toHaveBeenCalledWith(
        'scheduled-task/task-1',
        '0 9 * * 1-5',
        { taskId: 'task-1' },
        { tz: 'Europe/London' }
      );
      expect(mockBossInstance.work).toHaveBeenCalledWith(
        'scheduled-task/task-1',
        { localConcurrency: 1 },
        expect.any(Function)
      );
    });
  });

  describe('unscheduleTask', () => {
    it('removes schedule and worker from pg-boss', async () => {
      await initScheduler('postgres://localhost/test');
      await unscheduleTask('task-1');

      expect(mockBossInstance.unschedule).toHaveBeenCalledWith('scheduled-task/task-1');
      expect(mockBossInstance.offWork).toHaveBeenCalledWith('scheduled-task/task-1');
    });
  });

  describe('rescheduleTask', () => {
    it('unschedules then schedules', async () => {
      await initScheduler('postgres://localhost/test');
      const task = makeTask();
      await rescheduleTask(task);

      expect(mockBossInstance.unschedule).toHaveBeenCalledWith('scheduled-task/task-1');
      expect(mockBossInstance.schedule).toHaveBeenCalledWith(
        'scheduled-task/task-1',
        '0 9 * * 1-5',
        { taskId: 'task-1' },
        { tz: 'Europe/London' }
      );
    });
  });

  describe('loadAllTasks (T026)', () => {
    it('queries all enabled tasks and schedules each', async () => {
      await initScheduler('postgres://localhost/test');
      const tasks = [makeTask(), makeTask({ id: 'task-2', name: 'Task 2' })];
      mockPrisma.scheduledTask.findMany.mockResolvedValue(tasks);

      await loadAllTasks();

      expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith({
        where: { enabled: true },
      });
      expect(mockBossInstance.schedule).toHaveBeenCalledTimes(2);
    });

    it('is idempotent — calling twice schedules again without error', async () => {
      await initScheduler('postgres://localhost/test');
      const tasks = [makeTask()];
      mockPrisma.scheduledTask.findMany.mockResolvedValue(tasks);

      await loadAllTasks();
      await loadAllTasks();

      expect(mockBossInstance.schedule).toHaveBeenCalledTimes(2);
    });
  });

  describe('registerWorker', () => {
    it('is a no-op — workers are registered per-task in scheduleTask', async () => {
      await initScheduler('postgres://localhost/test');
      await registerWorker();
      // registerWorker is a no-op now; workers are registered in scheduleTask
    });
  });

  describe('taskHandler', () => {
    let workerHandler: (jobs: any[]) => Promise<void>;

    beforeEach(async () => {
      await initScheduler('postgres://localhost/test');
      const task = makeTask();
      await scheduleTask(task);
      workerHandler = mockBossInstance.work.mock.calls[0][2];
    });

    it('T020: happy path — executes task successfully', async () => {
      const task = makeTask();
      const thread = makeThread();
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(task);
      mockPrisma.scheduledTask.update.mockResolvedValue(task);
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.message.create.mockResolvedValue({ id: 'msg-1' });
      mockProcessMessage.mockResolvedValue({
        text: 'AI response',
        toolCallCount: 0,
        durationMs: 1000,
      });
      mockRecordExecution.mockResolvedValue({ id: 'exec-1' });

      await workerHandler([{ data: { taskId: 'task-1' } }]);

      expect(mockPrisma.scheduledTask.findUnique).toHaveBeenCalledWith({
        where: { id: 'task-1' },
      });
      expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { running: true },
      });
      expect(mockPrisma.message.create).toHaveBeenCalled();
      expect(mockProcessMessage).toHaveBeenCalled();
      expect(mockRecordExecution).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'success' })
      );
      // Running should be reset to false
      const lastUpdate = mockPrisma.scheduledTask.update.mock.calls[
        mockPrisma.scheduledTask.update.mock.calls.length - 1
      ];
      expect(lastUpdate[0].data.running).toBe(false);
    });

    it('T021: skips execution when task is already running', async () => {
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(makeTask({ running: true }));

      await workerHandler([{ data: { taskId: 'task-1' } }]);

      expect(mockProcessMessage).not.toHaveBeenCalled();
      expect(mockRecordExecution).not.toHaveBeenCalled();
    });

    it('T021: skips execution when task is disabled', async () => {
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(makeTask({ enabled: false }));

      await workerHandler([{ data: { taskId: 'task-1' } }]);

      expect(mockProcessMessage).not.toHaveBeenCalled();
      expect(mockRecordExecution).not.toHaveBeenCalled();
    });

    it('T023: records failed status when processMessage rejects', async () => {
      const task = makeTask();
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(task);
      mockPrisma.scheduledTask.update.mockResolvedValue(task);
      mockPrisma.thread.findUnique.mockResolvedValue(makeThread());
      mockPrisma.message.create.mockResolvedValue({ id: 'msg-1' });
      mockProcessMessage.mockRejectedValue(new Error('AI provider error'));
      mockRecordExecution.mockResolvedValue({ id: 'exec-1' });

      await workerHandler([{ data: { taskId: 'task-1' } }]);

      expect(mockRecordExecution).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'failed',
          error: 'AI provider error',
        })
      );
      // Running reset to false
      const lastUpdate = mockPrisma.scheduledTask.update.mock.calls[
        mockPrisma.scheduledTask.update.mock.calls.length - 1
      ];
      expect(lastUpdate[0].data.running).toBe(false);
    });

    it('T023: posts error message to thread on failure', async () => {
      const task = makeTask();
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(task);
      mockPrisma.scheduledTask.update.mockResolvedValue(task);
      mockPrisma.thread.findUnique.mockResolvedValue(makeThread());
      mockPrisma.message.create.mockResolvedValue({ id: 'msg-1' });
      mockProcessMessage.mockRejectedValue(new Error('AI provider error'));
      mockRecordExecution.mockResolvedValue({ id: 'exec-1' });

      await workerHandler([{ data: { taskId: 'task-1' } }]);

      // Should create error message in thread (second message.create call)
      const messageCalls = mockPrisma.message.create.mock.calls;
      const errorMessage = messageCalls[messageCalls.length - 1][0];
      expect(errorMessage.data.role).toBe('assistant');
      expect(errorMessage.data.content[0].text).toContain('failed');
    });

    it('T023: task remains enabled after failure', async () => {
      const task = makeTask();
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(task);
      mockPrisma.scheduledTask.update.mockResolvedValue(task);
      mockPrisma.thread.findUnique.mockResolvedValue(makeThread());
      mockPrisma.message.create.mockResolvedValue({ id: 'msg-1' });
      mockProcessMessage.mockRejectedValue(new Error('fail'));
      mockRecordExecution.mockResolvedValue({ id: 'exec-1' });

      await workerHandler([{ data: { taskId: 'task-1' } }]);

      // No update to enabled field — task stays enabled
      const updateCalls = mockPrisma.scheduledTask.update.mock.calls;
      for (const call of updateCalls) {
        if (call[0].data.enabled !== undefined) {
          expect(call[0].data.enabled).not.toBe(false);
        }
      }
    });

    it('skips when task not found', async () => {
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(null);

      await workerHandler([{ data: { taskId: 'task-1' } }]);

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('skips when task has no thread', async () => {
      mockPrisma.scheduledTask.findUnique.mockResolvedValue(makeTask({ threadId: null }));
      mockPrisma.scheduledTask.update.mockResolvedValue(makeTask({ threadId: null }));

      await workerHandler([{ data: { taskId: 'task-1' } }]);

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });
  });

  describe('stopScheduler', () => {
    it('stops pg-boss gracefully', async () => {
      await initScheduler('postgres://localhost/test');
      await stopScheduler();

      expect(mockBossInstance.stop).toHaveBeenCalledWith({ graceful: true });
    });
  });
});
