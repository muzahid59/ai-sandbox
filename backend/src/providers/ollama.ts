import axios from 'axios';
import { Transform } from 'stream';
import { AIProvider, ProviderCapabilities } from './types';
import { ChatCompletionOptions, ChatCompletionResult, MessageParam, ToolCall, ContentBlock } from '../types';
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
    const { messages, tools } = options;
    const model = options.model || this.model;

    // Only send tools to models that support them
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

    // Convert messages to Ollama chat format
    const ollamaMessages = messages.map((msg) => {
      const formatted: { role: string; content: string } = { role: msg.role, content: '' };

      if (typeof msg.content === 'string') {
        formatted.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text);
        formatted.content = textParts.join(' ');

        // Handle tool_result → role: tool
        const toolResult = msg.content.find((b) => b.type === 'tool_result');
        if (toolResult && 'content' in toolResult) {
          formatted.role = 'tool';
          formatted.content = toolResult.content || '';
        }
      }

      return formatted;
    });

    try {
      const request: Record<string, unknown> = {
        model,
        messages: ollamaMessages,
        stream: false,
      };

      if (ollamaTools) {
        request.tools = ollamaTools;
      }

      const response = await axios.post(`${OLLAMA_BASE_URL}/chat`, request);
      const msg = response.data.message;

      // Build content blocks from response
      const contentBlocks: ContentBlock[] = [];
      const toolCalls: ToolCall[] = [];

      if (msg.content) {
        contentBlocks.push({ type: 'text', text: msg.content });
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (let i = 0; i < msg.tool_calls.length; i++) {
          const tc = msg.tool_calls[i];
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
      }

      return {
        text: msg.content || '',
        contentBlocks,
        toolCalls,
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      };
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
