import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import * as scheduledTaskService from '../services/scheduledTaskService';
import * as taskScheduler from '../services/taskScheduler';
import { BadRequestError, NotFoundError } from '../errors';
import logger from '../config/logger';

const log = logger.child({ service: 'scheduledTaskController' });

const createTaskSchema = z.object({
  name: z.string({ message: 'Name is required' }).min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  prompt: z.string({ message: 'Prompt is required' }).min(1, 'Prompt is required').max(2000, 'Prompt must be 2000 characters or less'),
  cronExpression: z.string({ message: 'Cron expression is required' }).min(1, 'Cron expression is required'),
  timezone: z.string({ message: 'Timezone is required' }).min(1, 'Timezone is required'),
  model: z.string({ message: 'Model is required' }).min(1, 'Model is required'),
  threadId: z.string().optional(),
});

const updateTaskSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').max(100, 'Name must be 100 characters or less').optional(),
  prompt: z.string().min(1, 'Prompt cannot be empty').max(2000, 'Prompt must be 2000 characters or less').optional(),
  cronExpression: z.string().min(1, 'Cron expression cannot be empty').optional(),
  timezone: z.string().min(1, 'Timezone cannot be empty').optional(),
  model: z.string().min(1, 'Model cannot be empty').optional(),
  enabled: z.boolean().optional(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue.path.length > 0 ? issue.path.join('.') : undefined;
      const message = field ? `${field}: ${issue.message}` : issue.message;
      throw new BadRequestError(message);
    }
    throw err;
  }
}

export async function handleCreateTask(req: Request, res: Response) {
  const data = parseBody(createTaskSchema, req.body);
  const task = await scheduledTaskService.createTask(req.user!.id, data);
  await taskScheduler.scheduleTask(task);
  log.info({ taskId: task.id }, 'Task created via API');
  return res.status(201).json(task);
}

export async function handleListTasks(req: Request, res: Response) {
  const tasks = await scheduledTaskService.listTasks(req.user!.id);
  return res.json({ tasks });
}

export async function handleGetTask(req: Request, res: Response) {
  const id = req.params.id as string;
  const task = await scheduledTaskService.getTask(id, req.user!.id);
  if (!task) throw new NotFoundError('Task not found');

  const { executions } = await scheduledTaskService.getExecutions(id, req.user!.id, 10);
  return res.json({ ...task, executions });
}

export async function handleUpdateTask(req: Request, res: Response) {
  const id = req.params.id as string;
  const data = parseBody(updateTaskSchema, req.body);
  const updated = await scheduledTaskService.updateTask(id, req.user!.id, data);
  if (!updated) throw new NotFoundError('Task not found');

  if (data.enabled === false) {
    await taskScheduler.unscheduleTask(id);
  } else if (data.cronExpression !== undefined || data.timezone !== undefined || data.enabled === true) {
    await taskScheduler.rescheduleTask(updated);
  }

  log.info({ taskId: id }, 'Task updated via API');
  return res.json(updated);
}

export async function handleDeleteTask(req: Request, res: Response) {
  const id = req.params.id as string;
  const deleted = await scheduledTaskService.deleteTask(id, req.user!.id);
  if (!deleted) throw new NotFoundError('Task not found');

  await taskScheduler.unscheduleTask(id);
  log.info({ taskId: id }, 'Task deleted via API');
  return res.json({ success: true });
}

export async function handleGetExecutions(req: Request, res: Response) {
  const id = req.params.id as string;
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const cursor = req.query.cursor as string | undefined;

  const task = await scheduledTaskService.getTask(id, req.user!.id);
  if (!task) throw new NotFoundError('Task not found');

  const result = await scheduledTaskService.getExecutions(id, req.user!.id, limit, cursor);
  return res.json(result);
}
