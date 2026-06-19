import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, ProviderCapabilities, ProviderRegistration } from './types';
import { ChatCompletionOptions, ChatCompletionResult, ToolCall, ContentBlock } from '../types';
import { extractTextContent, mapToolResult, buildToolCallContentBlock } from './utils';
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

    const systemInstruction = messages
      .filter((m) => m.role === 'system')
      .map((m) => extractTextContent(m.content))
      .join('\n');

    const geminiHistory = messages
      .filter((m) => m.role !== 'system')
      .map((msg) => {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const text = extractTextContent(msg.content);

        if (Array.isArray(msg.content)) {
          const toolResult = mapToolResult(msg.content);
          if (toolResult) {
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
          contentBlocks.push(buildToolCallContentBlock(toolCall));
        }
      }

      const text = response.text() || '';
      if (text) {
        contentBlocks.unshift({ type: 'text', text });
      }

      return { text, contentBlocks, toolCalls, stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn' };
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

const CAPABILITIES: ProviderCapabilities = {
  chatCompletion: true,
  streaming: false,
  imageAnalysis: true,
};

export function register(): ProviderRegistration {
  return {
    name: 'google',
    models: [
      { key: 'google', provider: 'google', model: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', capabilities: CAPABILITIES },
    ],
    capabilities: CAPABILITIES,
    factory: (modelId: string) => {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error('GOOGLE_API_KEY not configured');
      return new GoogleProvider(apiKey, modelId);
    },
  };
}
