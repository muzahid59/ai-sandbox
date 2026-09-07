import { Request, Response } from 'express';
import { getThreadById, incrementThreadTokens } from '../services/threadService';
import { createMessage, getByThread, updateMessageStatus, countByThread } from '../services/messageService';
import { processMessage } from '../services/chatService';
import { contextService } from '../services/contextService';
import { createPendingAction, getThreadPendingAction } from '../services/pendingActionService';
import { SSEWriter } from '../sse/sseWriter';
import { extractTextContent } from '../providers/utils';
import { ContentBlockParam } from '../types/content';
import { BadRequestError, NotFoundError } from '../errors';
import { extractAndSaveMemories } from '../services/memoryExtractionService';
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

  const existingPending = await getThreadPendingAction(thread.id);
  if (existingPending) {
    return res.status(409).json({
      code: 'APPROVAL_PENDING',
      message: 'Please approve or reject the pending action before sending a new message.',
    });
  }

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
      onToolUseStart: (call) => {
        if (call.name === 'document_search') {
          writer.sendDocumentSearchStart(assistantMessage.id);
        }
        writer.sendToolUseStart({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      },
      onToolUseResult: (callId, name, toolResult) => {
        if (name === 'document_search' && !toolResult.is_error) {
          try {
            const parsed = JSON.parse(toolResult.output);
            if (parsed.metadata?.sources?.length > 0) {
              writer.sendDocumentSearchResult(assistantMessage.id, parsed.metadata.sources);
            } else {
              writer.sendDocumentSearchEmpty(assistantMessage.id);
            }
          } catch {
            writer.sendDocumentSearchEmpty(assistantMessage.id);
          }
        }
        writer.sendToolUseResult({ tool_call_id: callId, name, output: toolResult.output, is_error: toolResult.is_error });
      },
    }, req.user!.id);

    if (result.suspended) {
      await updateMessageStatus(assistantMessage.id, 'complete', {
        content: result.suspended.contentBlocks as any,
        stopReason: 'action_pending',
      });

      const pendingAction = await createPendingAction({
        threadId: thread.id,
        userId: req.user!.id,
        messageId: assistantMessage.id,
        toolName: result.suspended.toolCall.name,
        toolCallId: result.suspended.toolCall.id,
        arguments: result.suspended.toolCall.arguments,
      });

      writer.sendActionPending({
        action_id: pendingAction.id,
        msg_id: assistantMessage.id,
        tool_name: pendingAction.toolName,
        arguments: pendingAction.arguments as Record<string, unknown>,
        expires_at: pendingAction.expiresAt.toISOString(),
      });

      log.info({ actionId: pendingAction.id, toolName: pendingAction.toolName, durationMs: Date.now() - start }, 'Message suspended for approval');
      writer.sendMessageStop('action_pending', 0);
      writer.end();
      return;
    }

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

    (async () => {
      try {
        await extractAndSaveMemories(req.user!.id, thread.id, thread.model, userText, result.text);
      } catch (err) {
        log.warn({ err }, 'Memory extraction failed');
      }
    })();
  } catch (error: any) {
    log.error({ err: error }, 'Message handling failed');
    await updateMessageStatus(assistantMessage.id, 'error').catch(() => {});
    writer.sendError({ type: 'internal_error', message: error.message || 'Something went wrong', retryable: true });
    writer.end();
  }
}
