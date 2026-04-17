import { Thread } from '@prisma/client';
import { createProvider } from '../providers';
import { toolRegistry } from './toolRegistry';
import { runAgenticLoop, AgenticLoopCallbacks, AgenticLoopResult } from './toolExecutor';
import { ContentBlockParam } from '../types/content';
import { contextService } from './contextService';
import logger from '../config/logger';

const log = logger.child({ service: 'chat' });

const SYSTEM_PROMPT = `You are a helpful AI assistant with tools. Current date: ${new Date().toISOString().split('T')[0]}. User timezone: Asia/Dhaka (UTC+6).

CRITICAL RULES - FOLLOW EXACTLY:

1. NEVER use your training data for current information (news, events, weather, calendar, stock prices, sports scores)

2. For ANY current/real-time query, you MUST use the appropriate tool:
   - Current date/time → get_current_date
   - News/current events → web_search
   - Calendar/schedule → google_calendar
   - Websites/URLs → fetch_url
   - Math calculations → calculator

3. When a tool returns results, you MUST synthesize them into a helpful answer:
   - web_search → Read ALL results, filter relevant ones, write a natural summary (NOT a numbered list)
   - Focus on the most important/recent information
   - Ignore irrelevant results (off-topic, different languages, spam)
   - Write in complete sentences, provide context
   - NEVER say "I don't have access" after receiving tool results

4. ONLY say "I don't have access to [X]" if:
   - You tried a tool and it FAILED with an error
   - No tool exists for the request

5. Answer directly from tool results - no filler, no explaining your process

CRITICAL: If you just called a tool and received results, those results are REAL and CURRENT. Use them in your answer. DO NOT claim you don't have access after successfully calling a tool. The tool output is your source of truth.

Example:
- User: "What's on my calendar?"
- You call google_calendar → Returns: "Meeting at 2pm"
- CORRECT response: "You have a meeting at 2pm"
- WRONG response: "I don't have access to your calendar" (YOU JUST ACCESSED IT!)

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
  selectedToolNames: string[] | undefined,
  callbacks: AgenticLoopCallbacks,
): Promise<ChatResult> {
  const provider = createProvider(thread.model);
  const allTools = toolRegistry.getDefinitions();

  // Filter tools based on selection
  // - undefined: use all tools (backward compatibility)
  // - empty array: no tools (user disabled all)
  // - array with items: use selected tools only
  const tools = selectedToolNames === undefined
    ? allTools
    : selectedToolNames.length > 0
      ? allTools.filter((tool) => selectedToolNames.includes(tool.name))
      : [];

  const startTime = Date.now();

  log.info({
    model: thread.model,
    provider: provider.name,
    totalTools: allTools.length,
    selectedTools: tools.length,
    toolNames: tools.map(t => t.name)
  }, 'Processing message');

  // Build message history using contextService (with token budgeting and caching)
  const messages = await contextService.buildContextWindow(thread.id);

  log.debug({
    contextMessages: messages.map(m => ({
      role: m.role,
      contentPreview: typeof m.content === 'string' ? m.content.substring(0, 100) : JSON.stringify(m.content).substring(0, 100)
    }))
  }, 'Context loaded');

  // Use simple prompt for models that don't support tools OR when no tools are available
  const supportsTools = !NO_TOOL_MODELS.some((m) => thread.model.includes(m));
  const hasTools = tools.length > 0;
  const useToolPrompt = supportsTools && hasTools;
  const systemPrompt = useToolPrompt ? SYSTEM_PROMPT : SIMPLE_PROMPT;
  messages.unshift({ role: 'system', content: systemPrompt });

  log.debug({
    finalMessageCount: messages.length,
    roles: messages.map(m => m.role),
    usingToolPrompt: useToolPrompt
  }, 'Messages prepared for LLM');

  // All providers now implement chatCompletion — use the agentic loop
  // Only pass tools to models that support them AND when tools are available
  const effectiveTools = useToolPrompt ? tools : [];
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
