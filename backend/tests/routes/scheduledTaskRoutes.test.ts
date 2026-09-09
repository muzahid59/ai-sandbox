const mockScheduledTaskService = {
  createTask: jest.fn(),
  getTask: jest.fn(),
  listTasks: jest.fn(),
  updateTask: jest.fn(),
  deleteTask: jest.fn(),
  getExecutions: jest.fn(),
  recordExecution: jest.fn(),
};

const mockTaskScheduler = {
  scheduleTask: jest.fn().mockResolvedValue(undefined),
  unscheduleTask: jest.fn().mockResolvedValue(undefined),
  rescheduleTask: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../src/services/scheduledTaskService', () => mockScheduledTaskService);
jest.mock('../../src/services/taskScheduler', () => mockTaskScheduler);

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../../src/middleware/auth';
import { errorHandler } from '../../src/middleware/errorHandler';
import { scheduledTaskRoutes } from '../../src/routes/scheduledTaskRoutes';

const TEST_SECRET = 'test-secret-scheduled-tasks';
process.env.JWT_ACCESS_SECRET = TEST_SECRET;

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/v1', scheduledTaskRoutes);
app.use(errorHandler);

const userId = 'user-uuid-1';

function makeToken() {
  return jwt.sign({ id: userId, email: 'test@example.com' }, TEST_SECRET, { expiresIn: '1h' });
}

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

afterEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/v1/scheduled-tasks', () => {
  it('returns 201 with valid input', async () => {
    const task = makeTask();
    mockScheduledTaskService.createTask.mockResolvedValue(task);

    const res = await request(app)
      .post('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        name: 'Test Task',
        prompt: 'Hello AI',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Europe/London',
        model: 'gpt-4o',
        threadId: 'thread-1',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Task');
    expect(mockScheduledTaskService.createTask).toHaveBeenCalledWith(userId, {
      name: 'Test Task',
      prompt: 'Hello AI',
      cronExpression: '0 9 * * 1-5',
      timezone: 'Europe/London',
      model: 'gpt-4o',
      threadId: 'thread-1',
    });
    expect(mockTaskScheduler.scheduleTask).toHaveBeenCalledWith(task);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ name: 'Task' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for empty name', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        name: '',
        prompt: 'Hello',
        cronExpression: '0 9 * * *',
        timezone: 'Europe/London',
        model: 'gpt-4o',
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for name exceeding 100 chars', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        name: 'a'.repeat(101),
        prompt: 'Hello',
        cronExpression: '0 9 * * *',
        timezone: 'Europe/London',
        model: 'gpt-4o',
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for prompt exceeding 2000 chars', async () => {
    const res = await request(app)
      .post('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        name: 'Task',
        prompt: 'a'.repeat(2001),
        cronExpression: '0 9 * * *',
        timezone: 'Europe/London',
        model: 'gpt-4o',
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 when service throws BadRequestError (invalid cron)', async () => {
    const { BadRequestError } = require('../../src/errors');
    mockScheduledTaskService.createTask.mockRejectedValue(
      new BadRequestError('Invalid cron expression')
    );

    const res = await request(app)
      .post('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        name: 'Task',
        prompt: 'Hello',
        cronExpression: 'invalid-cron',
        timezone: 'Europe/London',
        model: 'gpt-4o',
      });

    expect(res.status).toBe(400);
  });

  it('returns 409 when service throws ConflictError (duplicate name)', async () => {
    const { ConflictError } = require('../../src/errors');
    mockScheduledTaskService.createTask.mockRejectedValue(
      new ConflictError('A task with this name already exists')
    );

    const res = await request(app)
      .post('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        name: 'Duplicate',
        prompt: 'Hello',
        cronExpression: '0 9 * * *',
        timezone: 'Europe/London',
        model: 'gpt-4o',
      });

    expect(res.status).toBe(409);
  });

  it('returns 429 when service throws RateLimitError (task limit)', async () => {
    const { RateLimitError } = require('../../src/errors');
    mockScheduledTaskService.createTask.mockRejectedValue(
      new RateLimitError('Task limit reached (max 20)')
    );

    const res = await request(app)
      .post('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        name: 'Task',
        prompt: 'Hello',
        cronExpression: '0 9 * * *',
        timezone: 'Europe/London',
        model: 'gpt-4o',
      });

    expect(res.status).toBe(429);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/v1/scheduled-tasks').send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/scheduled-tasks', () => {
  it('returns 200 with tasks array', async () => {
    mockScheduledTaskService.listTasks.mockResolvedValue([makeTask()]);

    const res = await request(app)
      .get('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].name).toBe('Test Task');
    expect(mockScheduledTaskService.listTasks).toHaveBeenCalledWith(userId);
  });

  it('returns empty array when no tasks', async () => {
    mockScheduledTaskService.listTasks.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/scheduled-tasks')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
  });
});

describe('GET /api/v1/scheduled-tasks/:id', () => {
  it('returns 200 with task and executions', async () => {
    const task = makeTask();
    mockScheduledTaskService.getTask.mockResolvedValue(task);
    mockScheduledTaskService.getExecutions.mockResolvedValue({
      executions: [makeExecution()],
      nextCursor: null,
    });

    const res = await request(app)
      .get('/api/v1/scheduled-tasks/task-1')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Test Task');
    expect(res.body.executions).toHaveLength(1);
  });

  it('returns 404 for non-owned task', async () => {
    mockScheduledTaskService.getTask.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/scheduled-tasks/nonexistent')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/scheduled-tasks/:id', () => {
  it('returns 200 with updated task', async () => {
    const updated = makeTask({ name: 'Updated' });
    mockScheduledTaskService.updateTask.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/api/v1/scheduled-tasks/task-1')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ name: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
  });

  it('returns 404 for non-owned task', async () => {
    mockScheduledTaskService.updateTask.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/scheduled-tasks/nonexistent')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ name: 'Updated' });

    expect(res.status).toBe(404);
  });

  it('(T019) toggle to disabled calls unscheduleTask', async () => {
    const updated = makeTask({ enabled: false, nextRunAt: null });
    mockScheduledTaskService.updateTask.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/api/v1/scheduled-tasks/task-1')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.nextRunAt).toBeNull();
    expect(mockTaskScheduler.unscheduleTask).toHaveBeenCalledWith('task-1');
  });

  it('(T019) toggle to enabled calls rescheduleTask', async () => {
    const updated = makeTask({ enabled: true });
    mockScheduledTaskService.updateTask.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/api/v1/scheduled-tasks/task-1')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(mockTaskScheduler.rescheduleTask).toHaveBeenCalledWith(updated);
  });

  it('calls rescheduleTask on cron expression change', async () => {
    const updated = makeTask({ cronExpression: '0 10 * * *' });
    mockScheduledTaskService.updateTask.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/api/v1/scheduled-tasks/task-1')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ cronExpression: '0 10 * * *' });

    expect(res.status).toBe(200);
    expect(mockTaskScheduler.rescheduleTask).toHaveBeenCalledWith(updated);
  });

  it('calls rescheduleTask on timezone change', async () => {
    const updated = makeTask({ timezone: 'America/New_York' });
    mockScheduledTaskService.updateTask.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/api/v1/scheduled-tasks/task-1')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ timezone: 'America/New_York' });

    expect(res.status).toBe(200);
    expect(mockTaskScheduler.rescheduleTask).toHaveBeenCalledWith(updated);
  });
});

describe('DELETE /api/v1/scheduled-tasks/:id', () => {
  it('returns 200 with success true', async () => {
    mockScheduledTaskService.deleteTask.mockResolvedValue(true);

    const res = await request(app)
      .delete('/api/v1/scheduled-tasks/task-1')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockTaskScheduler.unscheduleTask).toHaveBeenCalledWith('task-1');
  });

  it('returns 404 for non-owned task', async () => {
    mockScheduledTaskService.deleteTask.mockResolvedValue(false);

    const res = await request(app)
      .delete('/api/v1/scheduled-tasks/nonexistent')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/scheduled-tasks/:id/executions', () => {
  it('returns 200 with paginated executions', async () => {
    mockScheduledTaskService.getTask.mockResolvedValue(makeTask());
    mockScheduledTaskService.getExecutions.mockResolvedValue({
      executions: [makeExecution()],
      nextCursor: null,
    });

    const res = await request(app)
      .get('/api/v1/scheduled-tasks/task-1/executions')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.executions).toHaveLength(1);
    expect(res.body.nextCursor).toBeNull();
  });

  it('returns 404 for non-owned task', async () => {
    mockScheduledTaskService.getTask.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/scheduled-tasks/nonexistent/executions')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it('respects limit query parameter', async () => {
    mockScheduledTaskService.getTask.mockResolvedValue(makeTask());
    mockScheduledTaskService.getExecutions.mockResolvedValue({
      executions: [],
      nextCursor: null,
    });

    await request(app)
      .get('/api/v1/scheduled-tasks/task-1/executions?limit=5')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(mockScheduledTaskService.getExecutions).toHaveBeenCalledWith(
      'task-1',
      userId,
      5,
      undefined
    );
  });

  it('respects cursor query parameter', async () => {
    mockScheduledTaskService.getTask.mockResolvedValue(makeTask());
    mockScheduledTaskService.getExecutions.mockResolvedValue({
      executions: [],
      nextCursor: null,
    });

    await request(app)
      .get('/api/v1/scheduled-tasks/task-1/executions?cursor=2026-09-08T09:00:00Z')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(mockScheduledTaskService.getExecutions).toHaveBeenCalledWith(
      'task-1',
      userId,
      20,
      '2026-09-08T09:00:00Z'
    );
  });
});
