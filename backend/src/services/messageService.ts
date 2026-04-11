import prisma from '../config/database';
import { Message } from '@prisma/client';
import { ContentBlock } from '../types';

export async function createMessage(data: {
  id?: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ContentBlock[];
  status?: 'pending' | 'streaming' | 'complete' | 'error';
  modelSnapshot?: string;
}): Promise<Message> {
  return prisma.message.create({
    data: {
      ...(data.id && { id: data.id }),
      threadId: data.threadId,
      role: data.role,
      content: data.content as any,
      status: data.status ?? 'pending',
      modelSnapshot: data.modelSnapshot,
    },
  });
}

export async function getByThread(
  threadId: string,
  beforeId?: string,
  limit = 50,
): Promise<Message[]> {
  const messages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(beforeId && { cursor: { id: beforeId }, skip: 1 }),
  });
  return messages.reverse(); // Return chronological order
}

export async function updateMessageStatus(
  messageId: string,
  status: 'pending' | 'streaming' | 'complete' | 'error',
  data?: {
    content?: ContentBlock[];
    inputTokens?: number;
    outputTokens?: number;
    stopReason?: string;
  },
): Promise<Message> {
  return prisma.message.update({
    where: { id: messageId },
    data: {
      status,
      ...(data?.content && { content: data.content as any }),
      ...(data?.inputTokens !== undefined && { inputTokens: data.inputTokens }),
      ...(data?.outputTokens !== undefined && { outputTokens: data.outputTokens }),
      ...(data?.stopReason && { stopReason: data.stopReason }),
      ...(status === 'complete' && { completedAt: new Date() }),
    },
  });
}

export async function countByThread(threadId: string): Promise<number> {
  return prisma.message.count({ where: { threadId } });
}

export async function incrementThreadTokens(
  threadId: string,
  delta: number,
): Promise<void> {
  await prisma.thread.update({
    where: { id: threadId },
    data: { tokenCount: { increment: delta } },
  });
}
