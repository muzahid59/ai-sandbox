import axios from 'axios';
import { Transform } from 'stream';
import { AIProvider, ProviderCapabilities, ProviderRegistration } from './types';
import { ChatCompletionOptions, ChatCompletionResult, ToolCall, ContentBlock } from '../types';
import { extractTextContent, mapToolResult, buildToolCallContentBlock } from './utils';
import logger from '../config/logger';

const log = logger.child({ provider: 'ollama' });

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://host.docker.internal:11434/api';

const TOOL_CAPABLE_MODELS = ['llama3.2', 'llama3.1', 'mistral', 'mixtral', 'qwen2.5'];

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

    log.debug({ model, supportsTools, toolsProvided: tools?.length || 0, ollamaToolsCount: ollamaTools?.length || 0 }, 'Tool support check');

    const ollamaMessages = messages.map((msg) => {
      const formatted: { role: string; content: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] } = {
        role: msg.role,
        content: extractTextContent(msg.content),
      };

      if (Array.isArray(msg.content)) {
        const toolResult = mapToolResult(msg.content);
        if (toolResult) {
          formatted.role = 'tool';
          formatted.content = toolResult.content;
        }
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        formatted.tool_calls = msg.tool_calls.map((tc) => ({
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }

      return formatted;
    });

    try {
      const request: Record<string, unknown> = { model, messages: ollamaMessages, stream: true };
      if (ollamaTools) request.tools = ollamaTools;

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
          if (!settled) { settled = true; fn(); }
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
                if (!ollamaTools) onDelta?.(textChunk);
              }

              if (parsed.message?.tool_calls && !settled) {
                streamToolCalls.push(...parsed.message.tool_calls);
              }

              if (parsed.done) {
                log.debug({ model, doneReason: parsed.done_reason, accumulatedTextLength: accumulatedText.length }, 'Ollama done chunk');

                settle(() => {
                  const contentBlocks: ContentBlock[] = [];
                  const toolCalls: ToolCall[] = [];
                  let rawToolCalls = [...streamToolCalls];

                  if (accumulatedText && rawToolCalls.length === 0) {
                    try {
                      const maybeCall = JSON.parse(accumulatedText.trim());
                      const args = maybeCall.parameters ?? maybeCall.arguments;
                      if (typeof maybeCall.name === 'string' && args !== undefined) {
                        rawToolCalls = [{ function: { name: maybeCall.name, arguments: args } }];
                        accumulatedText = '';
                        log.debug({ toolName: maybeCall.name }, 'Detected text-embedded tool call');
                      }
                    } catch { /* not JSON — treat as normal text */ }
                  }

                  if (accumulatedText) {
                    contentBlocks.push({ type: 'text', text: accumulatedText });
                    if (ollamaTools) onDelta?.(accumulatedText);
                  }

                  for (let i = 0; i < rawToolCalls.length; i++) {
                    const tc = rawToolCalls[i];
                    const toolCall: ToolCall = {
                      id: `call_${Date.now()}_${i}`,
                      name: tc.function.name,
                      arguments: tc.function.arguments,
                    };
                    toolCalls.push(toolCall);
                    contentBlocks.push(buildToolCallContentBlock(toolCall));
                  }

                  resolve({ text: accumulatedText, contentBlocks, toolCalls, stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn' });
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

const CAPABILITIES: ProviderCapabilities = {
  chatCompletion: true,
  streaming: true,
  imageAnalysis: false,
};

export function register(): ProviderRegistration {
  return {
    name: 'ollama',
    models: [
      { key: 'lama', provider: 'ollama', model: 'llama3.2', displayName: 'Llama 3.2', capabilities: CAPABILITIES },
      { key: 'deepseek', provider: 'ollama', model: 'deepseek-r1:8b', displayName: 'DeepSeek R1 8B', capabilities: CAPABILITIES },
      { key: 'gemma', provider: 'ollama', model: 'gemma3:4b', displayName: 'Gemma 3 4B', capabilities: CAPABILITIES },
    ],
    capabilities: CAPABILITIES,
    factory: (modelId: string) => new OllamaProvider(modelId),
  };
}
