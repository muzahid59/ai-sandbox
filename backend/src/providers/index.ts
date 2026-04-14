import { AIProvider, ModelConfig } from './types';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { GoogleProvider } from './google';

export { AIProvider, ModelConfig } from './types';

// ─── Model → Provider mapping ───

const MODEL_REGISTRY: Record<string, ModelConfig> = {
  lama: {
    provider: 'ollama',
    model: 'llama3.2',
    displayName: 'Llama 3.2',
    capabilities: { chatCompletion: true, streaming: true, imageAnalysis: false },
  },
  deepseek: {
    provider: 'ollama',
    model: 'deepseek-r1:8b',
    displayName: 'DeepSeek R1 8B',
    capabilities: { chatCompletion: true, streaming: true, imageAnalysis: false },
  },
  gemma: {
    provider: 'ollama',
    model: 'gemma3:4b',
    displayName: 'Gemma 3 4B',
    capabilities: { chatCompletion: true, streaming: true, imageAnalysis: false },
  },
  openai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    capabilities: { chatCompletion: true, streaming: true, imageAnalysis: true },
  },
  google: {
    provider: 'google',
    model: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    capabilities: { chatCompletion: true, streaming: false, imageAnalysis: true },
  },
};

// ─── Factory ───

export function createProvider(modelType: string): AIProvider {
  const config = MODEL_REGISTRY[modelType];
  if (!config) {
    throw new Error(`Unknown model type: "${modelType}". Available: ${Object.keys(MODEL_REGISTRY).join(', ')}`);
  }

  switch (config.provider) {
    case 'ollama':
      return new OllamaProvider(config.model);
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
      return new OpenAIProvider(apiKey, config.model);
    }
    case 'google': {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error('GOOGLE_API_KEY not configured');
      return new GoogleProvider(apiKey, config.model);
    }
    default:
      throw new Error(`Unknown provider: "${config.provider}"`);
  }
}

export function getModelConfig(modelType: string): ModelConfig | undefined {
  return MODEL_REGISTRY[modelType];
}

export function getAvailableModels(): ModelConfig[] {
  return Object.values(MODEL_REGISTRY);
}
