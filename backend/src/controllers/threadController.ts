import { Request, Response } from 'express';
import {
  createThread,
  listThreads,
  getThreadById,
  updateThread,
  softDeleteThread,
} from '../services/threadService';
import { getByThread } from '../services/messageService';

export async function handleCreateThread(req: Request, res: Response) {
  const { model, title, system_prompt } = req.body;
  if (!model) {
    return res.status(400).json({ error: 'model is required' });
  }

  const thread = await createThread(req.user!.id, {
    model,
    title,
    systemPrompt: system_prompt,
  });
  return res.status(201).json(thread);
}

export async function handleListThreads(req: Request, res: Response) {
  const cursor = req.query.cursor as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const threads = await listThreads(req.user!.id, cursor, limit);
  return res.json(threads);
}

export async function handleGetThread(req: Request, res: Response) {
  const thread = await getThreadById(req.params.id as string, req.user!.id);
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const messages = await getByThread(thread.id);
  return res.json({ thread, messages });
}

export async function handleUpdateThread(req: Request, res: Response) {
  try {
    const { title, status, system_prompt } = req.body;
    const thread = await updateThread(req.params.id as string, req.user!.id, {
      title,
      status,
      systemPrompt: system_prompt,
    });
    return res.json(thread);
  } catch (err: any) {
    if (err.message === 'Thread not found') {
      return res.status(404).json({ error: err.message });
    }
    throw err;
  }
}

export async function handleDeleteThread(req: Request, res: Response) {
  try {
    const thread = await softDeleteThread(req.params.id as string, req.user!.id);
    return res.json(thread);
  } catch (err: any) {
    if (err.message === 'Thread not found') {
      return res.status(404).json({ error: err.message });
    }
    throw err;
  }
}
