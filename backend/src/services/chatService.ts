import { Thread } from '@prisma/client';
import { createProvider } from '../providers';
import { toolRegistry } from './toolRegistry';
import { runAgenticLoop, AgenticLoopCallbacks, AgenticLoopResult } from './toolExecutor';
import { MessageParam } from '../types/messages';
import { ContentBlockParam } from '../types/content';
import prisma from '../config/database';
import logger from '../config/logger';

const log = logger.child({ service: 'chat' });

const SYSTEM_PROMPT = `You are a helpful AI assistant with tools. Current date: ${new Date().toISOString().split('T')[0]}. User timezone: Asia/Dhaka (UTC+6).

CRITICAL RULES:
1. NEVER use your training data for current information (news, events, weather, calendar, stock prices, sports scores)
2. For ANY current/real-time query, you MUST use the appropriate tool:
   - News/current events → web_search
   - Calendar/schedule → google_calendar
   - Websites/URLs → fetch_url
   - Math calculations → calculator
3. If you don't have a tool for current info, say "I don't have access to current [X]" - NEVER make up answers
4. Base ALL answers on tool results, not your training data or speculation
5. Answer directly and concisely - no filler, no explaining your process

Your training data is outdated. For current information, you MUST use tools or refuse to answer.`;

export interface ChatResult {
  text: string;
  toolCallCount: number;
  durationMs: number;
}

export async function processMessage(
  thread: Thread,
  _userContent: ContentBlockParam[],
  callbacks: AgenticLoopCallbacks,
): Promise<ChatResult> {
  const provider = createProvider(thread.model);
  const tools = toolRegistry.getDefinitions();
  const startTime = Date.now();

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

  // Add system prompt at the beginning
  messages.unshift({ role: 'system', content: SYSTEM_PROMPT });

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
