import { Request, Response } from 'express';
import { getThreadById } from '../services/threadService';
import {
  createMessage,
  getByThread,
  updateMessageStatus,
  countByThread,
  incrementThreadTokens,
} from '../services/messageService';
import { processMessage } from '../services/chatService';
import { contextService } from '../services/contextService';
import { ContentBlockParam } from '../types/content';
import { ToolCall, ToolResult } from '../types/messages';
import logger from '../config/logger';
import prisma from '../config/database';

export async function handleGetMessages(req: Request, res: Response) {
  const thread = await getThreadById(req.params.id as string, req.user!.id);
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const beforeId = req.query.before_id as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const messages = await getByThread(thread.id, beforeId, limit);
  return res.json(messages);
}

export async function handleSendMessage(req: Request, res: Response) {
  const thread = await getThreadById(req.params.id as string, req.user!.id);
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const { content, tools: selectedTools } = req.body as { content?: ContentBlockParam[]; tools?: string[] };
  if (!content || !Array.isArray(content) || content.length === 0) {
    return res.status(400).json({ error: 'content is required and must be a non-empty array' });
  }

  const log = (req.log || logger).child({ threadId: thread.id, model: thread.model });

  // 1. Persist user message
  const userMessage = await createMessage({
    threadId: thread.id,
    role: 'user',
    content,
    status: 'complete',
  });

  // 2. Create assistant placeholder
  const assistantMessage = await createMessage({
    threadId: thread.id,
    role: 'assistant',
    content: [],
    status: 'streaming',
    modelSnapshot: thread.model,
  });

  log.info({ userMsgId: userMessage.id, assistantMsgId: assistantMessage.id }, 'Message pair created');

  // 3. SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(
    `data: ${JSON.stringify({
      type: 'message_start',
      message_id: assistantMessage.id,
      assistant_msg_id: assistantMessage.id,
      user_msg_id: userMessage.id,
    })}\n\n`,
  );

  try {
    // 4. Delegate to ChatService
    const result = await processMessage(thread, content, selectedTools, {
      onDelta: (text: string) => {
        res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`);
      },
      onToolUseStart: (call: ToolCall) => {
        res.write(
          `data: ${JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: call.id, name: call.name, input: call.arguments },
          })}\n\n`,
        );
      },
      onToolUseResult: (callId: string, name: string, toolResult: ToolResult) => {
        res.write(
          `data: ${JSON.stringify({
            type: 'content_block_stop',
            index: 0,
            tool_result: { tool_call_id: callId, name, output: toolResult.output, is_error: toolResult.is_error },
          })}\n\n`,
        );
      },
    });

    log.debug({ responseText: result.text }, 'AI response');

    // 5. Persist assistant message
    await updateMessageStatus(assistantMessage.id, 'complete', {
      content: [{ type: 'text', text: result.text }],
      stopReason: 'end_turn',
    });

    // 6. Update thread token count
    const userText = content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join(' ');
    const estimatedTokens = contextService.estimateTokens(userText + result.text);
    await incrementThreadTokens(thread.id, estimatedTokens);

    // 7. Invalidate context cache
    contextService.invalidate(thread.id);

    // 8. Auto-generate title on first exchange
    const msgCount = await countByThread(thread.id);
    if (msgCount === 2 && !thread.title) {
      const title = userText.substring(0, 60).replace(/\n/g, ' ').trim() || 'New chat';
      await prisma.thread.update({
        where: { id: thread.id },
        data: { title },
      });
    }

    // 9. Send done event
    res.write(
      `data: ${JSON.stringify({
        type: 'message_stop',
        stop_reason: 'end_turn',
        tool_calls_count: result.toolCallCount,
      })}\n\n`,
    );
    res.end();
  } catch (error: any) {
    log.error({ err: error }, 'Message handling failed');
    await updateMessageStatus(assistantMessage.id, 'error').catch(() => {});

    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        error: {
          type: 'internal_error',
          message: error.message || 'Something went wrong',
          retryable: true,
        },
      })}\n\n`,
    );
    res.end();
  }
}
