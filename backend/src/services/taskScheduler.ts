import { PgBoss } from 'pg-boss';
import type { Job } from 'pg-boss/dist/types';
import { ScheduledTask } from '@prisma/client';
import { CronExpressionParser } from 'cron-parser';
import prisma from '../config/database';
import { processMessage } from './chatService';
import { recordExecution } from './scheduledTaskService';
import { AgenticLoopCallbacks } from './toolExecutor';
import { ContentBlockParam } from '../types/content';
import logger from '../config/logger';

const log = logger.child({ service: 'taskScheduler' });

const EXECUTION_TIMEOUT_MS = Number(process.env.SCHEDULED_TASK_TIMEOUT_MS) || 300_000;
const RETRY_DELAYS = [5_000, 15_000, 45_000];

let boss: PgBoss | null = null;

function getJobName(taskId: string): string {
  return `scheduled-task/${taskId}`;
}

function computeNextRunAt(cronExpression: string, timezone: string): Date {
  const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
  return interval.next().toDate();
}

function createNoopCallbacks(): AgenticLoopCallbacks {
  return {
    onDelta: () => {},
    onToolUseStart: () => {},
    onToolUseResult: () => {},
  };
}

export async function initScheduler(databaseUrl: string): Promise<void> {
  boss = new PgBoss(databaseUrl);

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      await boss.start();
      log.info('Scheduler started');
      return;
    } catch (err) {
      log.warn({ err, attempt: attempt + 1, maxAttempts: RETRY_DELAYS.length }, 'Scheduler start attempt failed');
      if (attempt < RETRY_DELAYS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
      }
    }
  }

  log.error('Scheduler failed to start after all retry attempts');
  boss = null;
  throw new Error('Failed to start pg-boss after 3 attempts');
}

export async function scheduleTask(task: ScheduledTask): Promise<void> {
  if (!boss) {
    log.warn({ taskId: task.id }, 'Scheduler unavailable, cannot schedule task');
    return;
  }
  const jobName = getJobName(task.id);
  try {
    const existing = await boss.getQueue(jobName);
    if (!existing) {
      await boss.createQueue(jobName);
    }
    await boss.schedule(jobName, task.cronExpression, { taskId: task.id }, { tz: task.timezone });
    await boss.work(jobName, { localConcurrency: 1 }, async (jobs: Job<{ taskId: string }>[]) => {
      for (const job of jobs) {
        await taskHandler(job);
      }
    });
    log.info({ taskId: task.id, cron: task.cronExpression, timezone: task.timezone }, 'Task scheduled');
  } catch (err) {
    log.error({ err, taskId: task.id }, 'Failed to schedule task');
  }
}

export async function unscheduleTask(taskId: string): Promise<void> {
  if (!boss) {
    log.warn({ taskId }, 'Scheduler unavailable, cannot unschedule task');
    return;
  }
  const jobName = getJobName(taskId);
  try {
    await boss.unschedule(jobName);
    await boss.offWork(jobName);
    await boss.deleteQueue(jobName).catch(() => {});
    log.info({ taskId }, 'Task unscheduled');
  } catch (err) {
    log.error({ err, taskId }, 'Failed to unschedule task');
  }
}

export async function rescheduleTask(task: ScheduledTask): Promise<void> {
  await unscheduleTask(task.id);
  await scheduleTask(task);
}

export async function loadAllTasks(): Promise<void> {
  const tasks = await prisma.scheduledTask.findMany({ where: { enabled: true } });
  log.info({ taskCount: tasks.length }, 'Loading all enabled tasks');
  for (const task of tasks) {
    await scheduleTask(task);
  }
}

export async function registerWorker(): Promise<void> {
  log.info('Workers registered per-task during loadAllTasks/scheduleTask');
}

async function taskHandler(job: Job<{ taskId: string }>): Promise<void> {
  const { taskId } = job.data;
  const startedAt = new Date();

  const task = await prisma.scheduledTask.findUnique({ where: { id: taskId } });
  if (!task) {
    log.warn({ taskId }, 'Task not found, skipping execution');
    return;
  }

  if (!task.enabled) {
    log.info({ taskId }, 'Task disabled, skipping execution');
    return;
  }

  if (task.running) {
    log.info({ taskId }, 'Task already running, skipping execution');
    return;
  }

  await prisma.scheduledTask.update({ where: { id: taskId }, data: { running: true } });
  log.info({ taskId, taskName: task.name }, 'Scheduled task execution started');

  try {
    if (!task.threadId) {
      log.error({ taskId }, 'Task has no thread, skipping execution');
      await prisma.scheduledTask.update({ where: { id: taskId }, data: { running: false } });
      return;
    }

    const thread = await prisma.thread.findUnique({ where: { id: task.threadId } });
    if (!thread) {
      log.error({ taskId, threadId: task.threadId }, 'Thread not found, skipping execution');
      await prisma.scheduledTask.update({ where: { id: taskId }, data: { running: false } });
      return;
    }

    const userContent: ContentBlockParam[] = [{ type: 'text', text: task.prompt }];

    await prisma.message.create({
      data: {
        threadId: thread.id,
        role: 'user',
        content: userContent as any,
        status: 'complete',
      },
    });

    const threadWithModel = { ...thread, model: task.model };
    const callbacks = createNoopCallbacks();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('EXECUTION_TIMEOUT')), EXECUTION_TIMEOUT_MS);
    });

    const result = await Promise.race([
      processMessage(threadWithModel, userContent, undefined, callbacks, task.userId),
      timeoutPromise,
    ]);

    const assistantMsg = await prisma.message.create({
      data: {
        threadId: thread.id,
        role: 'assistant',
        content: [{ type: 'text', text: result.text }] as any,
        status: 'complete',
      },
    });

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const nextRunAt = computeNextRunAt(task.cronExpression, task.timezone);

    await prisma.scheduledTask.update({
      where: { id: taskId },
      data: { running: false, lastRunAt: completedAt, nextRunAt },
    });

    await recordExecution(taskId, {
      messageId: assistantMsg.id,
      status: 'success',
      durationMs,
      startedAt,
      completedAt,
    });

    log.info({ taskId, durationMs, toolCallCount: result.toolCallCount }, 'Scheduled task execution completed');
  } catch (err) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const isTimeout = err instanceof Error && err.message === 'EXECUTION_TIMEOUT';
    const status = isTimeout ? 'timeout' as const : 'failed' as const;
    const errorMessage = err instanceof Error ? err.message : String(err);

    await prisma.scheduledTask.update({
      where: { id: taskId },
      data: {
        running: false,
        lastRunAt: completedAt,
        nextRunAt: task.enabled ? computeNextRunAt(task.cronExpression, task.timezone) : null,
      },
    });

    await recordExecution(taskId, {
      status,
      error: errorMessage,
      durationMs,
      startedAt,
      completedAt,
    });

    if (task.threadId) {
      try {
        await prisma.message.create({
          data: {
            threadId: task.threadId,
            role: 'assistant',
            content: [{ type: 'text', text: `[Scheduled task ${status}] ${errorMessage}` }] as any,
            status: 'complete',
          },
        });
      } catch (msgErr) {
        log.error({ err: msgErr, taskId }, 'Failed to post error message to thread');
      }
    }

    log.error({ err, taskId, status, durationMs }, `Scheduled task execution ${status}`);
  }
}

export async function stopScheduler(): Promise<void> {
  if (!boss) return;
  try {
    await boss.stop({ graceful: true });
    log.info('Scheduler stopped gracefully');
  } catch (err) {
    log.error({ err }, 'Error stopping scheduler');
  }
  boss = null;
}
