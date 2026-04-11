import prisma from '../config/database';
import { Thread } from '@prisma/client';

export async function createThread(
  userId: string,
  data: { model: string; title?: string; systemPrompt?: string },
): Promise<Thread> {
  return prisma.thread.create({
    data: {
      userId,
      model: data.model,
      title: data.title,
      systemPrompt: data.systemPrompt,
    },
  });
}

export async function listThreads(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<Thread[]> {
  return prisma.thread.findMany({
    where: { userId, status: { not: 'deleted' } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
}

export async function getThreadById(
  threadId: string,
  userId: string,
): Promise<Thread | null> {
  return prisma.thread.findFirst({
    where: { id: threadId, userId },
  });
}

export async function updateThread(
  threadId: string,
  userId: string,
  data: { title?: string; status?: string; systemPrompt?: string },
): Promise<Thread> {
  const thread = await getThreadById(threadId, userId);
  if (!thread) throw new Error('Thread not found');

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.systemPrompt !== undefined) updateData.systemPrompt = data.systemPrompt;

  return prisma.thread.update({
    where: { id: threadId },
    data: updateData,
  });
}

export async function softDeleteThread(
  threadId: string,
  userId: string,
): Promise<Thread> {
  return updateThread(threadId, userId, { status: 'deleted' });
}
