import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, ProviderCapabilities } from './types';
import { ChatCompletionOptions, ChatCompletionResult, ToolCall, ContentBlock } from '../types';
import logger from '../config/logger';

const log = logger.child({ provider: 'google' });

export class GoogleProvider implements AIProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities = {
    chatCompletion: true,
    streaming: false,
    imageAnalysis: true,
  };

  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string, private readonly model: string = 'gemini-2.0-flash') {
    this.name = `google/${model}`;
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const { messages, tools } = options;
    const modelName = options.model || this.model;

    // Convert tool definitions to Gemini format
    const geminiTools = tools && tools.length > 0
      ? [{
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          })),
        }]
      : undefined;

    const genModel = this.genAI.getGenerativeModel({
      model: modelName,
      ...(geminiTools && { tools: geminiTools as any }),
    });

    // Convert messages to Gemini format
    // Gemini uses 'user' and 'model' roles, system prompt is separate
    const systemInstruction = messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');

    const geminiHistory = messages
      .filter((m) => m.role !== 'system')
      .map((msg) => {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        let text: string;

        if (typeof msg.content === 'string') {
          text = msg.content;
        } else {
          text = msg.content
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join(' ');

          // Handle tool results
          const toolResult = msg.content.find((b) => b.type === 'tool_result');
          if (toolResult && 'content' in toolResult) {
            return {
              role: 'function' as const,
              parts: [{
                functionResponse: {
                  name: 'tool',
                  response: { result: toolResult.content },
                },
              }],
            };
          }
        }

        return { role, parts: [{ text }] };
      });

    try {
      const chat = genModel.startChat({
        history: geminiHistory.slice(0, -1) as any,
        ...(systemInstruction && { systemInstruction }),
      });

      const lastMessage = geminiHistory[geminiHistory.length - 1];
      const lastText = lastMessage?.parts?.[0] && 'text' in lastMessage.parts[0]
        ? lastMessage.parts[0].text
        : '';

      const result = await chat.sendMessage(lastText);
      const response = result.response;

      const contentBlocks: ContentBlock[] = [];
      const toolCalls: ToolCall[] = [];

      // Check for function calls
      const functionCalls = response.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        for (let i = 0; i < functionCalls.length; i++) {
          const fc = functionCalls[i];
          const toolCall: ToolCall = {
            id: `call_${Date.now()}_${i}`,
            name: fc.name,
            arguments: (fc.args || {}) as Record<string, unknown>,
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

      const text = response.text() || '';
      if (text) {
        contentBlocks.unshift({ type: 'text', text });
      }

      return {
        text,
        contentBlocks,
        toolCalls,
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      };
    } catch (error: any) {
      log.error({ err: error, model: modelName }, 'chatCompletion failed');
      throw new Error(`Google AI chat completion failed: ${error.message}`);
    }
  }

  async imageAnalysis(imageUrl: string, prompt = 'Describe this image'): Promise<string> {
    try {
      const genModel = this.genAI.getGenerativeModel({ model: this.model });
      const result = await genModel.generateContent([
        prompt,
        { inlineData: { data: imageUrl, mimeType: 'image/png' } },
      ]);
      return result.response.text();
    } catch (error: any) {
      log.error({ err: error }, 'imageAnalysis failed');
      throw new Error(`Google AI image analysis failed: ${error.message}`);
    }
  }
}
