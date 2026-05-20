import axios from 'axios';
import { Transform } from 'stream';
import { AIProvider, ProviderCapabilities } from './types';
import { ChatCompletionOptions, ChatCompletionResult, ToolCall, ContentBlock } from '../types';
import logger from '../config/logger';

const log = logger.child({ provider: 'ollama' });

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434/api';

// Models that support tool calling in Ollama
const TOOL_CAPABLE_MODELS = ['llama3.2', 'llama3.1', 'mistral', 'mixtral', 'qwen2.5'];

/**
 * Unified Ollama provider — handles llama, deepseek, mistral, and any
 * model available via the Ollama API.
 */
export class OllamaProvider implements AIProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities = {
    chatCompletion: true,
    streaming: true,
    imageAnalysis: false,
  };

  constructor(private readonly model: string) {
    this.name = `ollama/${model}`;
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const { messages, tools, onDelta } = options;
    const model = options.model || this.model;

    const supportsTools = TOOL_CAPABLE_MODELS.some((m) => model.includes(m));
    const ollamaTools = supportsTools && tools && tools.length > 0
      ? tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }))
      : undefined;

    log.debug({
      model,
      supportsTools,
      toolsProvided: tools?.length || 0,
      ollamaToolsCount: ollamaTools?.length || 0,
    }, 'Tool support check');

    const ollamaMessages = messages.map((msg) => {
      const formatted: { role: string; content: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] } = {
        role: msg.role,
        content: '',
      };

      if (typeof msg.content === 'string') {
        formatted.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text);
        formatted.content = textParts.join(' ');

        const toolResult = msg.content.find((b) => b.type === 'tool_result');
        if (toolResult && 'content' in toolResult) {
          formatted.role = 'tool';
          formatted.content = (toolResult as { content?: string }).content || '';
        }
      }

      // Preserve tool_calls on assistant messages so Ollama can track the tool-call/result turn
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        formatted.tool_calls = msg.tool_calls.map((tc) => ({
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }

      return formatted;
    });

    try {
      const request: Record<string, unknown> = {
        model,
        messages: ollamaMessages,
        stream: true,
      };

      if (ollamaTools) {
        request.tools = ollamaTools;
      }

      log.debug({ model, messageRoles: ollamaMessages.map(m => m.role), messages: ollamaMessages }, 'Sending to Ollama');

      const response = await axios.post(`${OLLAMA_BASE_URL}/chat`, request, {
        responseType: 'stream',
        timeout: process.env.OLLAMA_TIMEOUT_MS ? Number(process.env.OLLAMA_TIMEOUT_MS) : 120_000,
      });

      return new Promise((resolve, reject) => {
        let accumulatedText = '';
        let buffer = '';
        let settled = false;
        const streamToolCalls: { function: { name: string; arguments: Record<string, unknown> } }[] = [];

        const settle = (fn: () => void) => {
          if (!settled) {
            settled = true;
            fn();
          }
        };

        response.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              const textChunk: string = parsed.message?.content ?? '';

              if (textChunk && !settled) {
                accumulatedText += textChunk;
                if (!ollamaTools) {
                  onDelta?.(textChunk);
                }
              }

              if (parsed.message?.tool_calls && !settled) {
                streamToolCalls.push(...parsed.message.tool_calls);
              }

              if (parsed.done) {
                log.debug({
                  model,
                  doneContent: parsed.message?.content,
                  doneToolCalls: parsed.message?.tool_calls,
                  doneReason: parsed.done_reason,
                  accumulatedTextLength: accumulatedText.length,
                }, 'Ollama done chunk');

                settle(() => {
                  const contentBlocks: ContentBlock[] = [];
                  const toolCalls: ToolCall[] = [];

                  // Structured tool_calls accumulated from all chunks (including this done chunk)
                  let rawToolCalls: { function: { name: string; arguments: Record<string, unknown> } }[] =
                    [...streamToolCalls];

                  // Fallback: some Ollama versions/models emit tool calls as JSON text content
                  // instead of structured tool_calls. Detect and convert.
                  if (accumulatedText && rawToolCalls.length === 0) {
                    try {
                      const maybeCall = JSON.parse(accumulatedText.trim());
                      const args = maybeCall.parameters ?? maybeCall.arguments;
                      if (typeof maybeCall.name === 'string' && args !== undefined) {
                        rawToolCalls = [{ function: { name: maybeCall.name, arguments: args } }];
                        accumulatedText = ''; // was a tool call, not user-visible text
                        log.debug({ toolName: maybeCall.name }, 'Detected text-embedded tool call');
                      }
                    } catch {
                      // not JSON — treat as normal text
                    }
                  }

                  if (accumulatedText) {
                    contentBlocks.push({ type: 'text', text: accumulatedText });
                    if (ollamaTools) {
                      onDelta?.(accumulatedText);
                    }
                  }

                  for (let i = 0; i < rawToolCalls.length; i++) {
                    const tc = rawToolCalls[i];
                    const toolCall: ToolCall = {
                      id: `call_${Date.now()}_${i}`,
                      name: tc.function.name,
                      arguments: tc.function.arguments,
                    };
                    toolCalls.push(toolCall);
                    contentBlocks.push({
                      type: 'tool_use',
                      id: toolCall.id,
                      name: toolCall.name,
                      input: toolCall.arguments,
                    });
                  }

                  resolve({
                    text: accumulatedText,
                    contentBlocks,
                    toolCalls,
                    stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
                  });
                });
              }
            } catch (err) {
              log.error({ err, line }, 'Error parsing stream chunk');
            }
          }
        });

        response.data.on('end', () => {
          settle(() => reject(new Error('Ollama stream ended without done:true')));
        });

        response.data.on('error', (err: Error) => {
          log.error({ err, model }, 'Stream error');
          settle(() => reject(new Error(`Ollama chat completion failed: ${err.message}`)));
        });
      });
    } catch (error: any) {
      log.error({ err: error, model }, 'chatCompletion failed');
      throw new Error(`Ollama chat completion failed: ${error.message}`);
    }
  }

  async textCompletion(prompt: string): Promise<NodeJS.ReadableStream> {
    try {
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/generate`,
        { model: this.model, prompt, stream: true },
        { responseType: 'stream' },
      );

      const parser = new Transform({
        objectMode: true,
        transform(chunk, _encoding, callback) {
          try {
            const data = JSON.parse(chunk);
            this.push({ text: data.response || '', done: data.done || false });
          } catch (err) {
            log.error({ err }, 'Error parsing stream chunk');
          }
          callback();
        },
      });

      response.data.pipe(parser);
      return parser;
    } catch (error: any) {
      log.error({ err: error }, 'textCompletion failed');
      throw new Error(`Ollama text completion failed: ${error.message}`);
    }
  }
}
