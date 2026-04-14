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

CRITICAL RULES - FOLLOW EXACTLY:

1. NEVER use your training data for current information (news, events, weather, calendar, stock prices, sports scores)

2. For ANY current/real-time query, you MUST use the appropriate tool:
   - News/current events → web_search
   - Calendar/schedule → google_calendar
   - Websites/URLs → fetch_url
   - Math calculations → calculator

3. When a tool returns results, you MUST use those results in your answer:
   - If web_search returns results → summarize the search results
   - If tool succeeds → base your answer on the tool output
   - NEVER say "I don't have access" after receiving tool results

4. ONLY say "I don't have access to [X]" if:
   - You tried a tool and it FAILED with an error
   - No tool exists for the request

5. Answer directly from tool results - no filler, no explaining your process

REMEMBER: If you call a tool and it succeeds, you MUST use its results in your response. Don't ignore successful tool outputs.`;

export interface ChatResult {
  text: string;
  toolCallCount: number;
  durationMs: number;
}

// Models that don't support tool calling (should use simple prompt)
const NO_TOOL_MODELS = ['gemma'];

const SIMPLE_PROMPT = `You are a helpful AI assistant. Current date: ${new Date().toISOString().split('T')[0]}. User timezone: Asia/Dhaka (UTC+6).

Answer questions directly and concisely based on your knowledge. If you don't know current information (today's news, live events, real-time data), say "I don't have access to current [X]" - don't make up answers.`;

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

  // Use simple prompt for models that don't support tools
  const supportsTools = !NO_TOOL_MODELS.some((m) => thread.model.includes(m));
  const systemPrompt = supportsTools ? SYSTEM_PROMPT : SIMPLE_PROMPT;
  messages.unshift({ role: 'system', content: systemPrompt });

  // All providers now implement chatCompletion — use the agentic loop
  // Only pass tools to models that support them
  const effectiveTools = supportsTools ? tools : [];
  const loopResult = await runAgenticLoop(provider, messages, effectiveTools, callbacks);

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
