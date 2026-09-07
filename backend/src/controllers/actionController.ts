import { Request, Response } from 'express';
import { SSEWriter } from '../sse/sseWriter';
import { getPendingAction, resolvePendingAction } from '../services/pendingActionService';
import { createMessage } from '../services/messageService';
import { getThreadById } from '../services/threadService';
import { toolRegistry } from '../services/toolRegistry';
import { contextService } from '../services/contextService';
import { createProvider } from '../providers';
import { getSystemPrompt } from '../prompts';
import { buildMemorySystemPrompt } from '../services/memoryService';
import logger from '../config/logger';

export async function handleApproveAction(req: Request, res: Response) {
  const actionId = req.params.id as string;
  const userId = req.user!.id;
  const log = (req.log || logger).child({ operation: 'approveAction', actionId });

  const action = await getPendingAction(actionId, userId);
  if (!action) {
    return res.status(404).json({ code: 'ACTION_NOT_FOUND', message: 'Action not found' });
  }

  if (action.status === 'pending' && action.expiresAt < new Date()) {
    await resolvePendingAction(action.id, userId, 'expired');
    return res.status(410).json({ code: 'ACTION_EXPIRED', message: 'Action has expired' });
  }

  if (action.status !== 'pending') {
    return res.status(409).json({ code: 'ACTION_ALREADY_RESOLVED', message: `Action is already ${action.status}` });
  }

  const result = await resolvePendingAction(action.id, userId, 'approved');
  if (!result.ok) {
    if (result.error === 'expired') return res.status(410).json({ code: 'ACTION_EXPIRED', message: 'Action has expired' });
    if (result.error === 'already_resolved') return res.status(409).json({ code: 'ACTION_ALREADY_RESOLVED', message: 'Action is already resolved' });
    return res.status(404).json({ code: 'ACTION_NOT_FOUND', message: 'Action not found' });
  }

  const writer = new SSEWriter(res);

  try {
    const toolResult = await toolRegistry.execute(action.toolName, action.arguments as Record<string, unknown>);

    writer.sendToolUseResult({
      tool_call_id: action.toolCallId,
      name: action.toolName,
      output: toolResult.output,
      is_error: toolResult.is_error,
    });

    const thread = await getThreadById(action.threadId, userId);
    if (!thread) {
      writer.sendError({ type: 'internal_error', message: 'Thread not found', retryable: false });
      writer.end();
      return;
    }

    const provider = createProvider(thread.model);
    const messages = await contextService.buildContextWindow(action.threadId);

    const memoryBlock = await buildMemorySystemPrompt(userId);
    const baseSystemPrompt = getSystemPrompt({ supportsTools: true });
    const systemPrompt = memoryBlock ? `${memoryBlock}\n${baseSystemPrompt}` : baseSystemPrompt;
    messages.unshift({ role: 'system', content: systemPrompt });

    messages.push({
      role: 'user',
      content: [{
        type: 'tool_result' as const,
        tool_use_id: action.toolCallId,
        content: toolResult.output,
        is_error: toolResult.is_error,
      }],
    });

    let providerStreamed = false;
    const aiResponse = await provider.chatCompletion({
      messages,
      tools: [],
      onDelta: (text) => { providerStreamed = true; writer.sendDelta(text); },
    });

    if (!providerStreamed && aiResponse.text) {
      writer.sendDelta(aiResponse.text);
    }

    await createMessage({
      threadId: action.threadId,
      role: 'assistant',
      content: [{ type: 'text', text: aiResponse.text }],
      status: 'complete',
    });

    log.info({ actionId, toolName: action.toolName }, 'Action approved and executed');
    writer.sendMessageStop('end_turn', 1);
    writer.end();
  } catch (error: any) {
    log.error({ err: error, actionId }, 'Action approval failed');
    writer.sendError({ type: 'internal_error', message: error.message || 'Something went wrong', retryable: true });
    writer.end();
  }
}

export async function handleRejectAction(req: Request, res: Response) {
  const actionId = req.params.id as string;
  const userId = req.user!.id;
  const log = (req.log || logger).child({ operation: 'rejectAction', actionId });

  const action = await getPendingAction(actionId, userId);
  if (!action) {
    return res.status(404).json({ code: 'ACTION_NOT_FOUND', message: 'Action not found' });
  }

  if (action.status !== 'pending') {
    return res.status(409).json({ code: 'ACTION_ALREADY_RESOLVED', message: `Action is already ${action.status}` });
  }

  const result = await resolvePendingAction(action.id, userId, 'rejected');
  if (!result.ok) {
    if (result.error === 'expired') return res.status(410).json({ code: 'ACTION_EXPIRED', message: 'Action has expired' });
    if (result.error === 'already_resolved') return res.status(409).json({ code: 'ACTION_ALREADY_RESOLVED', message: 'Action is already resolved' });
    return res.status(404).json({ code: 'ACTION_NOT_FOUND', message: 'Action not found' });
  }

  const writer = new SSEWriter(res);

  try {
    const thread = await getThreadById(action.threadId, userId);
    if (!thread) {
      writer.sendError({ type: 'internal_error', message: 'Thread not found', retryable: false });
      writer.end();
      return;
    }

    const provider = createProvider(thread.model);
    const messages = await contextService.buildContextWindow(action.threadId);

    const memoryBlock = await buildMemorySystemPrompt(userId);
    const baseSystemPrompt = getSystemPrompt({ supportsTools: true });
    const systemPrompt = memoryBlock ? `${memoryBlock}\n${baseSystemPrompt}` : baseSystemPrompt;
    messages.unshift({ role: 'system', content: systemPrompt });

    messages.push({
      role: 'user',
      content: [{
        type: 'tool_result' as const,
        tool_use_id: action.toolCallId,
        content: `The user rejected this action (${action.toolName}). Acknowledge the cancellation briefly.`,
        is_error: true,
      }],
    });

    let providerStreamed = false;
    const aiResponse = await provider.chatCompletion({
      messages,
      tools: [],
      onDelta: (text) => { providerStreamed = true; writer.sendDelta(text); },
    });

    if (!providerStreamed && aiResponse.text) {
      writer.sendDelta(aiResponse.text);
    }

    await createMessage({
      threadId: action.threadId,
      role: 'assistant',
      content: [{ type: 'text', text: aiResponse.text }],
      status: 'complete',
    });

    log.info({ actionId, toolName: action.toolName }, 'Action rejected');
    writer.sendMessageStop('end_turn', 0);
    writer.end();
  } catch (error: any) {
    log.error({ err: error, actionId }, 'Action rejection failed');
    writer.sendError({ type: 'internal_error', message: error.message || 'Something went wrong', retryable: true });
    writer.end();
  }
}

export async function handleGetAction(req: Request, res: Response) {
  const action = await getPendingAction(req.params.id as string, req.user!.id);
  if (!action) {
    return res.status(404).json({ code: 'ACTION_NOT_FOUND', message: 'Action not found' });
  }

  return res.json({
    id: action.id,
    threadId: action.threadId,
    messageId: action.messageId,
    toolName: action.toolName,
    arguments: action.arguments,
    status: action.status,
    expiresAt: action.expiresAt.toISOString(),
    resolvedAt: action.resolvedAt?.toISOString() ?? null,
    createdAt: action.createdAt.toISOString(),
  });
}
