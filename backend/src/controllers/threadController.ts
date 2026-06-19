import { Request, Response } from 'express';
import { createThread, listThreads, getThreadById, updateThread, softDeleteThread } from '../services/threadService';
import { getByThread } from '../services/messageService';
import { BadRequestError, NotFoundError } from '../errors';
import logger from '../config/logger';

export async function handleCreateThread(req: Request, res: Response) {
  const start = Date.now();
  const log = (req.log || logger).child({ operation: 'createThread' });
  const { model, title, system_prompt } = req.body;
  if (!model) throw new BadRequestError('model is required');

  const thread = await createThread(req.user!.id, { model, title, systemPrompt: system_prompt });
  log.info({ threadId: thread.id, model, durationMs: Date.now() - start }, 'Thread created');
  return res.status(201).json(thread);
}

export async function handleListThreads(req: Request, res: Response) {
  const start = Date.now();
  const log = (req.log || logger).child({ operation: 'listThreads' });
  const cursor = req.query.cursor as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const threads = await listThreads(req.user!.id, cursor, limit);
  log.info({ count: threads.length, durationMs: Date.now() - start }, 'Threads listed');
  return res.json(threads);
}

export async function handleGetThread(req: Request, res: Response) {
  const start = Date.now();
  const log = (req.log || logger).child({ operation: 'getThread', threadId: req.params.id });
  const thread = await getThreadById(req.params.id as string, req.user!.id);
  if (!thread) throw new NotFoundError('Thread not found');

  const messages = await getByThread(thread.id);
  log.info({ messageCount: messages.length, durationMs: Date.now() - start }, 'Thread fetched');
  return res.json({ thread, messages });
}

export async function handleUpdateThread(req: Request, res: Response) {
  const start = Date.now();
  const log = (req.log || logger).child({ operation: 'updateThread', threadId: req.params.id });
  const { title, status, system_prompt } = req.body;
  const thread = await updateThread(req.params.id as string, req.user!.id, {
    title, status, systemPrompt: system_prompt,
  });
  log.info({ durationMs: Date.now() - start }, 'Thread updated');
  return res.json(thread);
}

export async function handleDeleteThread(req: Request, res: Response) {
  const start = Date.now();
  const log = (req.log || logger).child({ operation: 'deleteThread', threadId: req.params.id });
  const thread = await softDeleteThread(req.params.id as string, req.user!.id);
  log.info({ durationMs: Date.now() - start }, 'Thread deleted');
  return res.json(thread);
}
