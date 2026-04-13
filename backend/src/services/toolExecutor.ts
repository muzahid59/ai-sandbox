import { StructuredMessage, ToolCall, ToolDefinition, ToolResult } from '../types';
import { toolRegistry } from './toolRegistry';
import logger from '../config/logger';

const MAX_TOOL_OUTPUT_LENGTH = 10_000;

interface ToolCallRecord {
  call: ToolCall;
  result: ToolResult;
  durationMs: number;
}

interface AgenticLoopCallbacks {
  onDelta: (text: string) => void;
  onToolUseStart: (call: ToolCall) => void;
  onToolUseResult: (callId: string, name: string, result: ToolResult) => void;
}

interface AgenticLoopResult {
  finalText: string;
  toolCallRecords: ToolCallRecord[];
}

export async function runAgenticLoop(
  aiService: any,
  messages: StructuredMessage[],
  tools: ToolDefinition[],
  callbacks: AgenticLoopCallbacks,
  maxIterations = 10,
): Promise<AgenticLoopResult> {
  const log = logger.child({ component: 'agenticLoop' });
  const allRecords: ToolCallRecord[] = [];
  let finalText = '';

  for (let i = 0; i < maxIterations; i++) {
    log.debug({ iteration: i + 1, messageCount: messages.length }, 'Loop iteration start');

    // 1. Call AI with messages + tool definitions
    const response = await aiService.chatCompletion({ messages, tools });

    // 2. If AI responded with text only → done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      finalText = response.text;
      if (finalText) {
        callbacks.onDelta(finalText);
      }
      log.debug({ iteration: i + 1 }, 'Loop complete — text response');
      break;
    }

    // Stream any partial text the AI sent before tool calls
    if (response.text) {
      finalText += response.text;
      callbacks.onDelta(response.text);
    }

    // 3. Append assistant message with tool_use blocks
    messages.push({
      role: 'assistant',
      content: response.toolCalls.map((tc: ToolCall) => ({
        type: 'tool_use' as const,
        id: tc.id,
        name: tc.name,
        input: tc.arguments,
      })),
      tool_calls: response.toolCalls,
    });

    // 4. Execute each tool call
    for (const toolCall of response.toolCalls) {
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

      log.info({ tool: toolCall.name, durationMs, success: result.success }, 'Tool call end');
      allRecords.push({ call: toolCall, result, durationMs });
      callbacks.onToolUseResult(toolCall.id, toolCall.name, result);

      // 5. Append tool result to messages
      messages.push({
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: result.output,
          },
        ],
      });
    }

    // Loop continues → AI sees tool results and decides next action
  }

  return { finalText, toolCallRecords: allRecords };
}
