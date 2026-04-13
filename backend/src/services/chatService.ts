import { Thread } from '@prisma/client';
import { createProvider } from '../providers';
import { toolRegistry } from './toolRegistry';
import { runAgenticLoop, AgenticLoopCallbacks, AgenticLoopResult } from './toolExecutor';
import { MessageParam } from '../types/messages';
import { ContentBlockParam } from '../types/content';
import prisma from '../config/database';
import logger from '../config/logger';

const log = logger.child({ service: 'chat' });

const SYSTEM_PROMPT =
  'You are a helpful AI assistant. You have tools available. Rules: 1) Use tools when relevant — do not guess or make up answers. 2) Answer the user directly and concisely — no filler, no explaining your process, no mentioning code or programming languages. 3) Base your answer on tool results, not speculation.';

export interface ChatResult {
  text: string;
  toolCallCount: number;
  durationMs: number;
}

export async function processMessage(
  thread: Thread,
  userContent: ContentBlockParam[],
  callbacks: AgenticLoopCallbacks,
): Promise<ChatResult> {
  const provider = createProvider(thread.model);
  const tools = toolRegistry.getDefinitions();
  const startTime = Date.now();

  const userText = userContent
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join(' ');

  log.info({ model: thread.model, provider: provider.name, toolCount: tools.length }, 'Processing message');

  // Build message history from DB
  const dbMessages = await prisma.message.findMany({
    where: { threadId: thread.id, status: 'complete' },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  const messages: MessageParam[] = dbMessages.map((m) => ({
    role: m.role as MessageParam['role'],
    content: typeof m.content === 'string'
      ? m.content
      : (m.content as any[])
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join(' '),
  }));

  // System prompt + current user message
  messages.unshift({ role: 'system', content: SYSTEM_PROMPT });
  messages.push({ role: 'user', content: userText });

  // All providers now implement chatCompletion — use the agentic loop
  const loopResult = await runAgenticLoop(provider, messages, tools, callbacks);

  const durationMs = Date.now() - startTime;
  log.info(
    { durationMs, toolCallCount: loopResult.toolCallRecords.length, responseLength: loopResult.finalText.length },
    'Message processing complete',
  );

  return {
    text: loopResult.finalText,
    toolCallCount: loopResult.toolCallRecords.length,
    durationMs,
  };
}
