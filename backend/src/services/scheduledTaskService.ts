import { Prisma, ScheduledTask, TaskExecution, TaskExecutionStatus } from '@prisma/client';
import { CronExpressionParser } from 'cron-parser';
import prisma from '../config/database';
import { BadRequestError, ConflictError, NotFoundError, RateLimitError } from '../errors';
import { createThread } from './threadService';
import { getAvailableModels } from '../providers';
import logger from '../config/logger';

const log = logger.child({ service: 'scheduledTask' });

const MAX_TASKS_PER_USER = 20;
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_EXECUTIONS_PER_TASK = 50;

interface CreateTaskData {
  name: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  model: string;
  threadId?: string;
}

interface UpdateTaskData {
  name?: string;
  prompt?: string;
  cronExpression?: string;
  timezone?: string;
  model?: string;
  enabled?: boolean;
}

interface RecordExecutionData {
  messageId?: string;
  status: TaskExecutionStatus;
  error?: string;
  durationMs?: number;
  startedAt: Date;
  completedAt?: Date;
}

function validateCronExpression(cronExpression: string, timezone: string): Date {
  let expr;
  try {
    expr = CronExpressionParser.parse(cronExpression, { tz: timezone });
  } catch {
    throw new BadRequestError(`Invalid cron expression "${cronExpression}". Use a standard 5-field cron format (e.g. "0 9 * * 1-5")`);
  }

  const occurrences: Date[] = [];
  for (let i = 0; i < 5; i++) {
    occurrences.push(expr.next().toDate());
  }

  for (let i = 1; i < occurrences.length; i++) {
    const gap = occurrences[i].getTime() - occurrences[i - 1].getTime();
    if (gap < MIN_INTERVAL_MS) {
      throw new BadRequestError('Cron interval must be at least 1 minute');
    }
  }

  return occurrences[0];
}

function validateTimezone(timezone: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new BadRequestError(`Invalid timezone "${timezone}". Use an IANA timezone like "Europe/London" or "America/New_York"`);
  }
}

function validateModel(model: string): void {
  const models = getAvailableModels();
  const exists = models.some(m => (m.key || m.model) === model);
  if (!exists) {
    const available = models.map(m => m.key || m.model).join(', ');
    throw new BadRequestError(`Invalid model "${model}". Available models: ${available}`);
  }
}

function computeNextRunAt(cronExpression: string, timezone: string): Date {
  const expr = CronExpressionParser.parse(cronExpression, { tz: timezone });
  return expr.next().toDate();
}

export async function createTask(userId: string, data: CreateTaskData): Promise<ScheduledTask> {
  validateTimezone(data.timezone);
  validateModel(data.model);
  const nextRunAt = validateCronExpression(data.cronExpression, data.timezone);

  const count = await prisma.scheduledTask.count({ where: { userId } });
  if (count >= MAX_TASKS_PER_USER) {
    throw new RateLimitError('Task limit reached (max 20)');
  }

  let threadId = data.threadId;
  if (!threadId) {
    const thread = await createThread(userId, { model: data.model, title: data.name });
    threadId = thread.id;
  }

  try {
    const task = await prisma.scheduledTask.create({
      data: {
        userId,
        name: data.name,
        prompt: data.prompt,
        cronExpression: data.cronExpression,
        timezone: data.timezone,
        model: data.model,
        threadId,
        nextRunAt,
      },
    });

    log.info({ taskId: task.id, userId, name: data.name }, 'Scheduled task created');
    return task;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A task with this name already exists');
    }
    throw err;
  }
}

export async function getTask(taskId: string, userId: string): Promise<ScheduledTask | null> {
  return prisma.scheduledTask.findFirst({
    where: { id: taskId, userId },
  });
}

export async function listTasks(userId: string): Promise<ScheduledTask[]> {
  return prisma.scheduledTask.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateTask(
  taskId: string,
  userId: string,
  data: UpdateTaskData,
): Promise<ScheduledTask | null> {
  const task = await getTask(taskId, userId);
  if (!task) return null;

  if (data.timezone !== undefined) {
    validateTimezone(data.timezone);
  }
  if (data.model !== undefined) {
    validateModel(data.model);
  }

  const cronExpr = data.cronExpression ?? task.cronExpression;
  const tz = data.timezone ?? task.timezone;

  if (data.cronExpression !== undefined || data.timezone !== undefined) {
    validateCronExpression(cronExpr, tz);
  }

  const updateData: Prisma.ScheduledTaskUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.prompt !== undefined) updateData.prompt = data.prompt;
  if (data.cronExpression !== undefined) updateData.cronExpression = data.cronExpression;
  if (data.timezone !== undefined) updateData.timezone = data.timezone;
  if (data.model !== undefined) updateData.model = data.model;

  if (data.enabled !== undefined) {
    updateData.enabled = data.enabled;
    if (!data.enabled) {
      updateData.nextRunAt = null;
    } else {
      updateData.nextRunAt = computeNextRunAt(cronExpr, tz);
    }
  } else if (data.cronExpression !== undefined || data.timezone !== undefined) {
    const enabled = data.enabled ?? task.enabled;
    if (enabled) {
      updateData.nextRunAt = computeNextRunAt(cronExpr, tz);
    }
  }

  try {
    const updated = await prisma.scheduledTask.update({
      where: { id: taskId },
      data: updateData,
    });

    log.info({ taskId, userId, fields: Object.keys(data) }, 'Scheduled task updated');
    return updated;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('A task with this name already exists');
    }
    throw err;
  }
}

export async function deleteTask(taskId: string, userId: string): Promise<boolean> {
  const task = await getTask(taskId, userId);
  if (!task) return false;

  await prisma.scheduledTask.delete({ where: { id: taskId } });
  log.info({ taskId, userId }, 'Scheduled task deleted');
  return true;
}

export async function getExecutions(
  taskId: string,
  userId: string,
  limit = 20,
  cursor?: string,
): Promise<{ executions: TaskExecution[]; nextCursor: string | null }> {
  const task = await getTask(taskId, userId);
  if (!task) throw new NotFoundError('Task not found');

  const effectiveLimit = Math.min(limit, 50);

  const executions = await prisma.taskExecution.findMany({
    where: {
      taskId,
      ...(cursor && { startedAt: { lt: new Date(cursor) } }),
    },
    orderBy: { startedAt: 'desc' },
    take: effectiveLimit + 1,
  });

  let nextCursor: string | null = null;
  if (executions.length > effectiveLimit) {
    executions.pop();
    const last = executions[executions.length - 1];
    nextCursor = last.startedAt.toISOString();
  }

  return { executions, nextCursor };
}

export async function recordExecution(
  taskId: string,
  result: RecordExecutionData,
): Promise<TaskExecution> {
  const execution = await prisma.taskExecution.create({
    data: {
      taskId,
      messageId: result.messageId ?? null,
      status: result.status,
      error: result.error ?? null,
      durationMs: result.durationMs ?? null,
      startedAt: result.startedAt,
      completedAt: result.completedAt ?? null,
    },
  });

  const count = await prisma.taskExecution.count({ where: { taskId } });
  if (count > MAX_EXECUTIONS_PER_TASK) {
    const oldest = await prisma.taskExecution.findMany({
      where: { taskId },
      orderBy: { startedAt: 'asc' },
      take: count - MAX_EXECUTIONS_PER_TASK,
      select: { id: true },
    });
    await prisma.taskExecution.deleteMany({
      where: { id: { in: oldest.map(e => e.id) } },
    });
  }

  log.info({ taskId, executionId: execution.id, status: result.status }, 'Task execution recorded');
  return execution;
}
