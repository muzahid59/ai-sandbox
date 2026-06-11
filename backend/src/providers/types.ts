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

  chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
  textCompletion?(prompt: string): Promise<NodeJS.ReadableStream>;
  imageAnalysis?(imageUrl: string, prompt?: string): Promise<string>;
}

// ─── Model Registry ───

export interface ModelConfig {
  key?: string;
  provider: string;
  model: string;
  displayName: string;
  capabilities: ProviderCapabilities;
}

// ─── Provider Registration (auto-registration pattern) ───

export interface ProviderRegistration {
  name: string;
  models: ModelConfig[];
  capabilities: ProviderCapabilities;
  factory: (modelId: string) => AIProvider;
}
