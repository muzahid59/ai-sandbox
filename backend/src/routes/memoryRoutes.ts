import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import * as memoryService from '../services/memoryService';
import { MemoryLimitError, DuplicateMemoryError } from '../services/memoryService';
import { NotFoundError, BadRequestError } from '../errors';
import logger from '../config/logger';

const router = Router();
const log = logger.child({ service: 'memoryRoutes' });

const contentSchema = z.string().min(1).max(500);

router.get('/memories', asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const beforeId = Array.isArray(req.query.before_id) ? undefined : req.query.before_id as string | undefined;
  const memories = await memoryService.listMemories(req.user!.id, limit, beforeId);
  const hasMore = limit !== undefined && memories.length === limit;
  return res.json({ memories, hasMore });
}));

router.post('/memories', asyncHandler(async (req, res) => {
  const parsed = contentSchema.safeParse(req.body?.content);
  if (!parsed.success) throw new BadRequestError('content must be a string between 1 and 500 characters');

  try {
    const memory = await memoryService.createMemory(req.user!.id, parsed.data, 'manual');
    log.debug({ memoryId: memory.id }, 'Memory created via API');
    return res.status(201).json(memory);
  } catch (err) {
    if (err instanceof MemoryLimitError) {
      return res.status(422).json({ error: { type: 'memory_limit_reached', message: "You've reached the 200 memory limit" } });
    }
    if (err instanceof DuplicateMemoryError) {
      return res.status(409).json({ error: { type: 'duplicate_memory', message: 'A similar memory already exists' } });
    }
    throw err;
  }
}));

router.patch('/memories/:id', asyncHandler(async (req, res) => {
  const parsed = contentSchema.safeParse(req.body?.content);
  if (!parsed.success) throw new BadRequestError('content must be a string between 1 and 500 characters');

  try {
    const memory = await memoryService.updateMemory(req.user!.id, req.params.id as string, parsed.data);
    return res.json(memory);
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: { type: 'not_found', message: 'Memory not found' } });
    if (err instanceof DuplicateMemoryError) {
      return res.status(409).json({ error: { type: 'duplicate_memory', message: 'A similar memory already exists' } });
    }
    throw err;
  }
}));

router.delete('/memories/:id', asyncHandler(async (req, res) => {
  try {
    await memoryService.deleteMemory(req.user!.id, req.params.id as string);
    return res.status(204).send();
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: { type: 'not_found', message: 'Memory not found' } });
    throw err;
  }
}));

export { router as memoryRoutes };
