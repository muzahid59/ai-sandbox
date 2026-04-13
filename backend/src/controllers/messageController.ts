import { Request, Response } from 'express';
import { getThreadById } from '../services/threadService';
import {
  createMessage,
  getByThread,
  updateMessageStatus,
  countByThread,
  incrementThreadTokens,
} from '../services/messageService';
import { contextService } from '../services/contextService';
import { ContentBlock, StructuredMessage, ToolCall, ToolResult } from '../types';
import { toolRegistry } from '../services/toolRegistry';
import { runAgenticLoop } from '../services/toolExecutor';
import logger from '../config/logger';
import prisma from '../config/database';

// Import legacy AI factory (JS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAIService } = require('../../services/ai_factory');

function isReadableStream(obj: any): boolean {
  return obj && typeof obj.on === 'function';
}

function supportsToolCalling(aiService: any): boolean {
  // Only true if the subclass overrides chatCompletion (not the base AIService stub)
  return Object.getPrototypeOf(aiService).hasOwnProperty('chatCompletion');
}

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

  const { content } = req.body as { content?: ContentBlock[] };
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

  // 3. Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial event with message IDs
  res.write(
    `data: ${JSON.stringify({
      type: 'message_created',
      user_msg_id: userMessage.id,
      assistant_msg_id: assistantMessage.id,
    })}\n\n`,
  );

  try {
    const userText = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ');

    log.debug({ userText }, 'User message received');

    const apiKey = process.env[`${thread.model.toUpperCase()}_API_KEY`] || '';
    const aiService = getAIService(apiKey, thread.model);

    let fullText = '';
    let toolCallCount = 0;
    const startTime = Date.now();

    // Check if this AI service supports tool calling
    const tools = toolRegistry.getDefinitions();
    const useToolCalling = tools.length > 0 && supportsToolCalling(aiService);

    log.info({ useToolCalling, toolCount: tools.length }, 'AI call starting');

    if (useToolCalling) {
      // ─── Agentic path: structured messages + tool calling ───

      // Build structured message history from DB
      const dbMessages = await prisma.message.findMany({
        where: { threadId: thread.id, status: 'complete' },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });

      const messages: StructuredMessage[] = dbMessages.map((m) => ({
        role: m.role as StructuredMessage['role'],
        content: typeof m.content === 'string'
          ? m.content
          : (m.content as any[])
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join(' '),
      }));

      // Add system prompt for tool calling
      messages.unshift({
        role: 'system',
        content:
          'You are a helpful AI assistant. You have tools available. Rules: 1) Use tools when relevant — do not guess or make up answers. 2) Answer the user directly and concisely — no filler, no explaining your process, no mentioning code or programming languages. 3) Base your answer on tool results, not speculation.',
      });

      // Add current user message
      messages.push({ role: 'user', content: userText });

      // Run the agentic loop
      const loopResult = await runAgenticLoop(
        aiService,
        messages,
        tools,
        {
          onDelta: (text: string) => {
            res.write(
              `data: ${JSON.stringify({
                type: 'delta',
                text,
                msg_id: assistantMessage.id,
              })}\n\n`,
            );
          },
          onToolUseStart: (call: ToolCall) => {
            res.write(
              `data: ${JSON.stringify({
                type: 'tool_use_start',
                tool_call_id: call.id,
                name: call.name,
                arguments: call.arguments,
              })}\n\n`,
            );
          },
          onToolUseResult: (callId: string, name: string, result: ToolResult) => {
            res.write(
              `data: ${JSON.stringify({
                type: 'tool_use_result',
                tool_call_id: callId,
                name,
                success: result.success,
                output: result.output,
              })}\n\n`,
            );
          },
        },
      );

      fullText = loopResult.finalText;
      toolCallCount = loopResult.toolCallRecords.length;
    } else {
      // ─── Legacy path: flat string prompt ───

      const contextPrompt = await contextService.buildContextWindow(thread.id);
      const fullPrompt = contextPrompt
        ? `${contextPrompt}\n\nuser: ${userText}`
        : userText;

      // Handle image content
      const imageBlock = content.find((b) => b.type === 'image_url');
      let imageContext = '';

      if (imageBlock && imageBlock.url) {
        try {
          imageContext = await aiService.imageCompletion({ image: imageBlock.url });
          imageContext = 'Image Context: ' + imageContext;
        } catch {
          // Model doesn't support images — skip
        }
      }

      const result = await aiService.textCompletion(fullPrompt + imageContext);

      if (isReadableStream(result)) {
        await new Promise<void>((resolve, reject) => {
          result.on('data', (chunk: any) => {
            if (chunk.text) {
              fullText += chunk.text;
              res.write(
                `data: ${JSON.stringify({
                  type: 'delta',
                  text: chunk.text,
                  msg_id: assistantMessage.id,
                })}\n\n`,
              );
            }
          });
          result.on('end', resolve);
          result.on('error', reject);
        });
      } else {
        fullText = typeof result === 'string' ? result : JSON.stringify(result);
        res.write(
          `data: ${JSON.stringify({
            type: 'delta',
            text: fullText,
            msg_id: assistantMessage.id,
          })}\n\n`,
        );
      }
    }

    const durationMs = Date.now() - startTime;
    log.info(
      { durationMs, toolCallCount, responseLength: fullText.length },
      'AI call complete',
    );
    log.debug({ responseText: fullText }, 'AI response');

    // 7. Persist assistant message
    await updateMessageStatus(assistantMessage.id, 'complete', {
      content: [{ type: 'text', text: fullText }],
      stopReason: 'end_turn',
    });

    // 8. Update thread token count (rough estimate)
    const estimatedTokens = contextService.estimateTokens(userText + fullText);
    await incrementThreadTokens(thread.id, estimatedTokens);

    // 9. Invalidate context cache
    contextService.invalidate(thread.id);

    // 10. Auto-generate title on first exchange
    const msgCount = await countByThread(thread.id);
    if (msgCount === 2 && !thread.title) {
      const title = userText.substring(0, 60).replace(/\n/g, ' ').trim() || 'New chat';
      await prisma.thread.update({
        where: { id: thread.id },
        data: { title },
      });
    }

    // 11. Send done event
    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        msg_id: assistantMessage.id,
        stop_reason: 'end_turn',
        tool_calls_count: toolCallCount,
      })}\n\n`,
    );
    res.end();
  } catch (error: any) {
    log.error({ err: error }, 'Message handling failed');
    await updateMessageStatus(assistantMessage.id, 'error').catch(() => {});

    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        code: 'internal_error',
        message: error.message || 'Something went wrong',
        retryable: true,
      })}\n\n`,
    );
    res.end();
  }
}
