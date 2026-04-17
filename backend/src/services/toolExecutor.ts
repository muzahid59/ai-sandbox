import { MessageParam, ToolCall, ToolDefinition, ToolResult, ContentBlock } from '../types';
import { ToolResultBlockParam } from '../types/content';
import { AIProvider } from '../providers/types';
import { toolRegistry } from './toolRegistry';
import logger from '../config/logger';

const MAX_TOOL_OUTPUT_LENGTH = 10_000;

interface ToolCallRecord {
  call: ToolCall;
  result: ToolResult;
  durationMs: number;
}

export interface AgenticLoopCallbacks {
  onDelta: (text: string) => void;
  onToolUseStart: (call: ToolCall) => void;
  onToolUseResult: (callId: string, name: string, result: ToolResult) => void;
}

export interface AgenticLoopResult {
  finalText: string;
  toolCallRecords: ToolCallRecord[];
}

/**
 * Agentic tool loop following Anthropic's ToolRunner pattern:
 * 1. Call provider with messages + tools
 * 2. If stop_reason != tool_use → return text (done)
 * 3. Execute ALL tool calls in parallel (Promise.all)
 * 4. Append assistant content blocks + tool results to messages
 * 5. Loop back to step 1
 */
export async function runAgenticLoop(
  provider: AIProvider,
  messages: MessageParam[],
  tools: ToolDefinition[],
  callbacks: AgenticLoopCallbacks,
  maxIterations = 10,
): Promise<AgenticLoopResult> {
  const log = logger.child({ component: 'agenticLoop' });
  const allRecords: ToolCallRecord[] = [];
  let finalText = '';

  for (let i = 0; i < maxIterations; i++) {
    log.debug({ iteration: i + 1, messageCount: messages.length }, 'Loop iteration start');

    // 1. Call provider with messages + tool definitions
    const response = await provider.chatCompletion({ messages, tools });

    // 2. If no tool calls → done
    if (response.stopReason !== 'tool_use' || response.toolCalls.length === 0) {
      finalText = response.text;
      if (finalText) {
        callbacks.onDelta(finalText);
      }
      log.debug({ iteration: i + 1 }, 'Loop complete — text response');
      break;
    }

    // Stream any partial text before tool calls
    if (response.text) {
      finalText += response.text;
      callbacks.onDelta(response.text);
    }

    // 3. Append assistant message with content blocks
    messages.push({
      role: 'assistant',
      content: response.contentBlocks,
      tool_calls: response.toolCalls,
    });

    // 4. Execute ALL tool calls in parallel (Anthropic pattern)
    const toolCallPromises = response.toolCalls.map(async (toolCall): Promise<ToolCallRecord> => {
      callbacks.onToolUseStart(toolCall);
      log.info({ tool: toolCall.name, input: toolCall.arguments }, 'Tool call start');

      const start = Date.now();
      const result = await toolRegistry.execute(toolCall.name, toolCall.arguments);
      const durationMs = Date.now() - start;

      // Truncate output if too large
      if (result.output.length > MAX_TOOL_OUTPUT_LENGTH) {
        log.warn({ tool: toolCall.name, originalLength: result.output.length }, 'Tool output truncated');
        result.output = result.output.substring(0, MAX_TOOL_OUTPUT_LENGTH) + '\n\n[Output truncated]';
      }

      // Log tool output for debugging summarization
      log.debug({
        tool: toolCall.name,
        outputPreview: result.output.substring(0, 500),
        outputLength: result.output.length
      }, 'Tool output preview');

      log.info({ tool: toolCall.name, durationMs, is_error: result.is_error }, 'Tool call end');
      callbacks.onToolUseResult(toolCall.id, toolCall.name, result);

      return { call: toolCall, result, durationMs };
    });

    const records = await Promise.all(toolCallPromises);
    allRecords.push(...records);

    // 5. Append tool results as user message with tool_result blocks
    const toolResultBlocks: ToolResultBlockParam[] = records.map((r) => ({
      type: 'tool_result' as const,
      tool_use_id: r.call.id,
      content: r.result.output,
      is_error: r.result.is_error,
    }));

    messages.push({
      role: 'user',
      content: toolResultBlocks,
    });

    // Loop continues — provider sees tool results and decides next action
  }

  return { finalText, toolCallRecords: allRecords };
}
