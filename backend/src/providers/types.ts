import { ChatCompletionOptions, ChatCompletionResult } from '../types/messages';

// ─── Provider Capabilities ───

export interface ProviderCapabilities {
  chatCompletion: boolean;
  streaming: boolean;
  imageAnalysis: boolean;
}

// ─── AI Provider Interface (Anthropic resource pattern) ───

export interface AIProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  /**
   * Chat completion with optional tool calling.
   * All providers must implement this — providers without native chat
   * adapt textCompletion into this interface.
   */
  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;

  /**
   * Text completion (streaming). Returns a Node.js readable stream
   * of { text: string, done: boolean } chunks.
   * Optional — only for providers that support streaming.
   */
  textCompletion?(prompt: string): Promise<NodeJS.ReadableStream>;

  /**
   * Image analysis. Returns text description of the image.
   * Optional — only for providers that support vision.
   */
  imageAnalysis?(imageUrl: string, prompt?: string): Promise<string>;
}

// ─── Model Registry ───

export interface ModelConfig {
  provider: string;
  model: string;
  displayName: string;
  capabilities: ProviderCapabilities;
}
