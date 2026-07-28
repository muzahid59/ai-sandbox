import { Memory, MemorySource } from '@prisma/client';
import prisma from '../config/database';
import { contextService } from './contextService';
import { NotFoundError } from '../errors';
import logger from '../config/logger';

const log = logger.child({ service: 'memory' });
const MEMORY_CAP = 200;
const MEMORY_TOKEN_BUDGET = 2000;

export class MemoryLimitError extends Error {
  constructor() {
    super('Memory limit reached');
    this.name = 'MemoryLimitError';
  }
}

export class DuplicateMemoryError extends Error {
  constructor() {
    super('A similar memory already exists');
    this.name = 'DuplicateMemoryError';
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

export function isDuplicate(candidate: string, existingContents: string[]): boolean {
  const candidateSet = tokenize(candidate);
  for (const existing of existingContents) {
    if (jaccard(candidateSet, tokenize(existing)) >= 0.75) return true;
  }
  return false;
}

export async function listMemories(
  userId: string,
  limit = 50,
  beforeId?: string,
): Promise<Memory[]> {
  let beforeUpdatedAt: Date | undefined;
  if (beforeId) {
    const ref = await prisma.memory.findFirst({ where: { id: beforeId, userId }, select: { updatedAt: true } });
    if (ref) beforeUpdatedAt = ref.updatedAt;
  }

  return prisma.memory.findMany({
    where: {
      userId,
      ...(beforeUpdatedAt && { updatedAt: { lt: beforeUpdatedAt } }),
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
}

export async function createMemory(
  userId: string,
  content: string,
  source: MemorySource,
  sourceThreadId?: string,
): Promise<Memory> {
  const count = await prisma.memory.count({ where: { userId } });
  if (count >= MEMORY_CAP) throw new MemoryLimitError();

  const existing = await prisma.memory.findMany({
    where: { userId },
    select: { content: true },
  });

  if (isDuplicate(content, existing.map((m) => m.content))) throw new DuplicateMemoryError();

  const memory = await prisma.memory.create({
    data: { userId, content, source, sourceThreadId: sourceThreadId ?? null },
  });

  log.debug({ memoryId: memory.id, source }, 'Memory created');
  return memory;
}

export async function updateMemory(
  userId: string,
  memoryId: string,
  content: string,
): Promise<Memory> {
  const existing = await prisma.memory.findFirst({ where: { id: memoryId, userId } });
  if (!existing) throw new NotFoundError('Memory not found');

  const otherMemories = await prisma.memory.findMany({
    where: { userId, id: { not: memoryId } },
    select: { content: true },
  });

  if (isDuplicate(content, otherMemories.map((m) => m.content))) throw new DuplicateMemoryError();

  return prisma.memory.update({ where: { id: memoryId }, data: { content } });
}

export async function deleteMemory(userId: string, memoryId: string): Promise<void> {
  const existing = await prisma.memory.findFirst({ where: { id: memoryId, userId } });
  if (!existing) throw new NotFoundError('Memory not found');
  await prisma.memory.delete({ where: { id: memoryId } });
  log.debug({ memoryId }, 'Memory deleted');
}

export async function buildMemorySystemPrompt(userId: string): Promise<string> {
  if (!userId) return '';

  const [memories, prefs, user] = await Promise.all([
    prisma.memory.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { content: true },
    }),
    prisma.userPreferences.findUnique({
      where: { userId },
      select: { customInstructions: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    }),
  ]);

  const customInstructions = prefs?.customInstructions ?? null;
  const displayName = user?.displayName ?? null;

  let keptMemories: string[] = [];
  let tokenBudget = MEMORY_TOKEN_BUDGET;

  if (customInstructions) {
    tokenBudget -= contextService.estimateTokens(customInstructions);
  }

  // Prepend display name as the first memory entry so the AI always knows the user's name
  const allMemoryLines: string[] = [];
  if (displayName) allMemoryLines.push(`User's name is ${displayName}`);
  for (const m of memories) allMemoryLines.push(m.content);

  for (const line of allMemoryLines) {
    const tokens = contextService.estimateTokens(`- ${line}\n`);
    if (tokenBudget - tokens < 0) break;
    keptMemories.push(line);
    tokenBudget -= tokens;
  }

  const parts: string[] = [];
  if (customInstructions) parts.push(customInstructions);
  if (keptMemories.length > 0) {
    parts.push(`[WHAT YOU KNOW ABOUT THE USER]\n${keptMemories.map((c) => `- ${c}`).join('\n')}`);
  }

  if (parts.length === 0) return '';
  return parts.join('\n\n') + '\n\n---';
}
