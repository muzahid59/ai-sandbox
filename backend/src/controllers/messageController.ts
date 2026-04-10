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
import { ContentBlock } from '../types';
import prisma from '../config/database';

// Import legacy AI factory (JS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAIService } = require('../../services/ai_factory');

function isReadableStream(obj: any): boolean {
  return obj && typeof obj.on === 'function';
}

export async function handleGetMessages(req: Request, res: Response) {
  const thread = await getThreadById(req.params.id, req.user!.id);
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const beforeId = req.query.before_id as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const messages = await getByThread(thread.id, beforeId, limit);
  return res.json(messages);
}

export async function handleSendMessage(req: Request, res: Response) {
  const thread = await getThreadById(req.params.id, req.user!.id);
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const { content } = req.body as { content?: ContentBlock[] };
  if (!content || !Array.isArray(content) || content.length === 0) {
    return res.status(400).json({ error: 'content is required and must be a non-empty array' });
  }

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
    // 4. Build context window
    const contextPrompt = await contextService.buildContextWindow(thread.id);
    const userText = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ');

    const fullPrompt = contextPrompt
      ? `${contextPrompt}\n\nuser: ${userText}`
      : userText;

    // 5. Handle image content (pass to imageCompletion if present)
    const imageBlock = content.find((b) => b.type === 'image_url');
    let imageContext = '';

    const apiKey = process.env[`${thread.model.toUpperCase()}_API_KEY`] || '';
    const aiService = getAIService(apiKey, thread.model);

    if (imageBlock && imageBlock.url) {
      try {
        imageContext = await aiService.imageCompletion({ image: imageBlock.url });
        imageContext = 'Image Context: ' + imageContext;
      } catch {
        // Model doesn't support images — skip
      }
    }

    // 6. Call AI service
    const result = await aiService.textCompletion(fullPrompt + imageContext);
    let fullText = '';

    if (isReadableStream(result)) {
      // Streaming services (Llama, DeepSeek)
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
      // Non-streaming services (OpenAI, Google) — result is a string
      fullText = typeof result === 'string' ? result : JSON.stringify(result);
      res.write(
        `data: ${JSON.stringify({
          type: 'delta',
          text: fullText,
          msg_id: assistantMessage.id,
        })}\n\n`,
      );
    }

    // 7. Persist assistant message
    await updateMessageStatus(assistantMessage.id, 'complete', {
      content: [{ type: 'text', text: fullText }],
      stopReason: 'end_turn',
    });

    // 8. Update thread token count (rough estimate)
    const estimatedTokens = contextService.estimateTokens(fullPrompt + fullText);
    await incrementThreadTokens(thread.id, estimatedTokens);

    // 9. Invalidate context cache
    contextService.invalidate(thread.id);

    // 10. Auto-generate title on first exchange
    const msgCount = await countByThread(thread.id);
    if (msgCount === 2 && !thread.title) {
      const title = userText.substring(0, 60).replace(/\n/g, ' ').trim() || 'New chat';
      // TODO: Use AI to generate a better title (async via BullMQ)
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
      })}\n\n`,
    );
    res.end();
  } catch (error: any) {
    // Update assistant message to error status
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
