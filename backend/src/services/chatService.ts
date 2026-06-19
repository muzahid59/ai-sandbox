import { Thread } from '@prisma/client';
import { createProvider } from '../providers';
import { toolRegistry } from './toolRegistry';
import { runAgenticLoop, AgenticLoopCallbacks, AgenticLoopResult } from './toolExecutor';
import { ContentBlockParam } from '../types/content';
import { contextService } from './contextService';
import { getSystemPrompt } from '../prompts';
import logger from '../config/logger';

const log = logger.child({ service: 'chat' });

export interface ChatResult {
  text: string;
  toolCallCount: number;
  durationMs: number;
}

const NO_TOOL_MODELS = ['gemma'];

export async function processMessage(
  thread: Thread,
  _userContent: ContentBlockParam[],
  selectedToolNames: string[] | undefined,
  callbacks: AgenticLoopCallbacks,
): Promise<ChatResult> {
  const provider = createProvider(thread.model);
  const allTools = toolRegistry.getDefinitions();

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
    toolNames: tools.map(t => t.name),
  }, 'Processing message');

  const messages = await contextService.buildContextWindow(thread.id);

  const supportsTools = !NO_TOOL_MODELS.some((m) => thread.model.includes(m));
  const hasTools = tools.length > 0;
  const useToolPrompt = supportsTools && hasTools;

  const systemPrompt = getSystemPrompt({ supportsTools: useToolPrompt });
  messages.unshift({ role: 'system', content: systemPrompt });

  log.debug({
    finalMessageCount: messages.length,
    roles: messages.map(m => m.role),
    usingToolPrompt: useToolPrompt,
  }, 'Messages prepared for LLM');

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
