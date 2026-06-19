import { Request, Response } from 'express';
import { getThreadById, incrementThreadTokens } from '../services/threadService';
import { createMessage, getByThread, updateMessageStatus, countByThread } from '../services/messageService';
import { processMessage } from '../services/chatService';
import { contextService } from '../services/contextService';
import { SSEWriter } from '../sse/sseWriter';
import { extractTextContent } from '../providers/utils';
import { ContentBlockParam } from '../types/content';
import { BadRequestError, NotFoundError } from '../errors';
import logger from '../config/logger';
import prisma from '../config/database';

export async function handleGetMessages(req: Request, res: Response) {
  const start = Date.now();
  const log = (req.log || logger).child({ operation: 'getMessages', threadId: req.params.id });
  const thread = await getThreadById(req.params.id as string, req.user!.id);
  if (!thread) throw new NotFoundError('Thread not found');

  const beforeId = req.query.before_id as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const messages = await getByThread(thread.id, beforeId, limit);
  log.info({ count: messages.length, durationMs: Date.now() - start }, 'Messages fetched');
  return res.json(messages);
}

export async function handleSendMessage(req: Request, res: Response) {
  const thread = await getThreadById(req.params.id as string, req.user!.id);
  if (!thread) throw new NotFoundError('Thread not found');

  const { content, tools: selectedTools } = req.body as { content?: ContentBlockParam[]; tools?: string[] };
  if (!content || !Array.isArray(content) || content.length === 0) {
    throw new BadRequestError('content is required and must be a non-empty array');
  }

  const start = Date.now();
  const log = (req.log || logger).child({ operation: 'sendMessage', threadId: thread.id, model: thread.model });
  const userMessage = await createMessage({ threadId: thread.id, role: 'user', content, status: 'complete' });
  const assistantMessage = await createMessage({
    threadId: thread.id, role: 'assistant', content: [], status: 'streaming', modelSnapshot: thread.model,
  });

  log.info({ userMsgId: userMessage.id, assistantMsgId: assistantMessage.id }, 'Message pair created');

  const writer = new SSEWriter(res);
  writer.sendMessageStart({ message_id: assistantMessage.id, assistant_msg_id: assistantMessage.id, user_msg_id: userMessage.id });

  try {
    const result = await processMessage(thread, content, selectedTools, {
      onDelta: (text) => writer.sendDelta(text),
      onToolUseStart: (call) => writer.sendToolUseStart({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments }),
      onToolUseResult: (callId, name, toolResult) => writer.sendToolUseResult({ tool_call_id: callId, name, output: toolResult.output, is_error: toolResult.is_error }),
    });

    await updateMessageStatus(assistantMessage.id, 'complete', { content: [{ type: 'text', text: result.text }], stopReason: 'end_turn' });

    const userText = extractTextContent(content);
    await incrementThreadTokens(thread.id, contextService.estimateTokens(userText + result.text));
    contextService.invalidate(thread.id);

    const msgCount = await countByThread(thread.id);
    if (msgCount === 2 && !thread.title) {
      const title = userText.substring(0, 60).replace(/\n/g, ' ').trim() || 'New chat';
      await prisma.thread.update({ where: { id: thread.id }, data: { title } });
    }

    log.info({ durationMs: Date.now() - start, toolCallCount: result.toolCallCount }, 'Message completed');
    writer.sendMessageStop('end_turn', result.toolCallCount);
    writer.end();
  } catch (error: any) {
    log.error({ err: error }, 'Message handling failed');
    await updateMessageStatus(assistantMessage.id, 'error').catch(() => {});
    writer.sendError({ type: 'internal_error', message: error.message || 'Something went wrong', retryable: true });
    writer.end();
  }
}
