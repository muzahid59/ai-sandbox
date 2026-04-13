import OpenAI from 'openai';
import { AIProvider, ProviderCapabilities } from './types';
import { ChatCompletionOptions, ChatCompletionResult, ToolCall, ContentBlock } from '../types';
import logger from '../config/logger';

const log = logger.child({ provider: 'openai' });

export class OpenAIProvider implements AIProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities = {
    chatCompletion: true,
    streaming: true,
    imageAnalysis: true,
  };

  private client: OpenAI;

  constructor(apiKey: string, private readonly model: string = 'gpt-4o-mini') {
    this.name = `openai/${model}`;
    this.client = new OpenAI({ apiKey });
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const { messages, tools } = options;
    const model = options.model || this.model;

    // Convert tool definitions to OpenAI format
    const openaiTools = tools && tools.length > 0
      ? tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema as unknown as Record<string, unknown>,
          },
        }))
      : undefined;

    // Convert messages to OpenAI format
    const openaiMessages = messages.map((msg) => {
      let content: string;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text);
        content = textParts.join(' ');

        // Handle tool_result → role: tool
        const toolResult = msg.content.find((b) => b.type === 'tool_result');
        if (toolResult && 'tool_use_id' in toolResult) {
          return {
            role: 'tool' as const,
            content: 'content' in toolResult ? String(toolResult.content) : '',
            tool_call_id: toolResult.tool_use_id,
          };
        }
      }

      // Map assistant messages with tool_calls
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        return {
          role: 'assistant' as const,
          content: content! || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }

      return {
        role: msg.role as 'system' | 'user' | 'assistant',
        content: content!,
      };
    });

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: openaiMessages as any,
        ...(openaiTools && { tools: openaiTools }),
      });

      const choice = response.choices[0];
      const msg = choice.message;

      const contentBlocks: ContentBlock[] = [];
      const toolCalls: ToolCall[] = [];

      if (msg.content) {
        contentBlocks.push({ type: 'text', text: msg.content });
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          const toolCall: ToolCall = {
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
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

      const stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use'
        : choice.finish_reason === 'length' ? 'max_tokens'
        : 'end_turn';

      return {
        text: msg.content || '',
        contentBlocks,
        toolCalls,
        stopReason,
      };
    } catch (error: any) {
      log.error({ err: error, model }, 'chatCompletion failed');
      throw new Error(`OpenAI chat completion failed: ${error.message}`);
    }
  }

  async imageAnalysis(imageUrl: string, prompt = 'Describe this image'): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      });
      return response.choices[0].message.content || '';
    } catch (error: any) {
      log.error({ err: error }, 'imageAnalysis failed');
      throw new Error(`OpenAI image analysis failed: ${error.message}`);
    }
  }
}
