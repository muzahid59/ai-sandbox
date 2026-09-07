import { PendingAction } from '@prisma/client';
import prisma from '../config/database';
import { createMessage } from './messageService';
import logger from '../config/logger';

const log = logger.child({ service: 'pendingAction' });

const DEFAULT_TTL_SECONDS = 600;

function getTtlSeconds(): number {
  const env = process.env.PENDING_ACTION_TTL_SECONDS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TTL_SECONDS;
}

export type ResolveResult =
  | { ok: true; action: PendingAction }
  | { ok: false; error: 'not_found' | 'already_resolved' | 'expired' };

export async function createPendingAction(data: {
  threadId: string;
  userId: string;
  messageId: string;
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
}): Promise<PendingAction> {
  const ttl = getTtlSeconds();
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const action = await prisma.pendingAction.create({
    data: {
      threadId: data.threadId,
      userId: data.userId,
      messageId: data.messageId,
      toolName: data.toolName,
      toolCallId: data.toolCallId,
      arguments: data.arguments as any,
      expiresAt,
    },
  });

  log.info(
    { actionId: action.id, threadId: data.threadId, toolName: data.toolName, expiresAt: expiresAt.toISOString() },
    'Pending action created',
  );

  return action;
}

export async function getPendingAction(id: string, userId: string): Promise<PendingAction | null> {
  return prisma.pendingAction.findFirst({
    where: { id, userId },
  });
}

export async function getThreadPendingAction(threadId: string): Promise<PendingAction | null> {
  return prisma.pendingAction.findFirst({
    where: { threadId, status: 'pending' },
  });
}

export async function resolvePendingAction(
  id: string,
  userId: string,
  status: 'approved' | 'rejected' | 'expired',
): Promise<ResolveResult> {
  const action = await prisma.pendingAction.findFirst({
    where: { id, userId },
  });

  if (!action) {
    return { ok: false, error: 'not_found' };
  }

  if (action.status !== 'pending') {
    return { ok: false, error: 'already_resolved' };
  }

  if (status !== 'expired' && action.expiresAt < new Date()) {
    await prisma.pendingAction.update({
      where: { id },
      data: { status: 'expired', resolvedAt: new Date() },
    });
    return { ok: false, error: 'expired' };
  }

  const updated = await prisma.pendingAction.update({
    where: { id },
    data: { status, resolvedAt: new Date() },
  });

  log.info(
    { actionId: id, threadId: action.threadId, toolName: action.toolName, newStatus: status },
    'Pending action resolved',
  );

  return { ok: true, action: updated };
}

export async function expireOverdue(): Promise<number> {
  const now = new Date();

  const overdueActions = await prisma.pendingAction.findMany({
    where: {
      status: 'pending',
      expiresAt: { lt: now },
    },
  });

  if (overdueActions.length === 0) return 0;

  await prisma.pendingAction.updateMany({
    where: {
      id: { in: overdueActions.map((a) => a.id) },
    },
    data: {
      status: 'expired',
      resolvedAt: now,
    },
  });

  for (const action of overdueActions) {
    try {
      await createMessage({
        threadId: action.threadId,
        role: 'assistant',
        content: [{ type: 'text', text: 'The pending action expired before you responded. Please let me know how you\'d like to proceed.' }],
        status: 'complete',
      });
    } catch (err) {
      log.warn({ err, actionId: action.id }, 'Failed to create expiry notification message');
    }
  }

  log.info({ expiredCount: overdueActions.length }, 'Expired overdue pending actions');
  return overdueActions.length;
}
