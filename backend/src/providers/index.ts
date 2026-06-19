import * as fs from 'fs';
import * as path from 'path';
import { AIProvider, ModelConfig, ProviderRegistration } from './types';
import logger from '../config/logger';

export { AIProvider, ModelConfig } from './types';

const log = logger.child({ component: 'providerRegistry' });

const MODEL_REGISTRY: Record<string, ModelConfig> = {};
const FACTORY_MAP: Record<string, (modelId: string) => AIProvider> = {};

const EXCLUDED_FILES = new Set(['index.ts', 'index.js', 'types.ts', 'types.js', 'utils.ts', 'utils.js']);

export function registerProviders(): void {
  const providersDir = __dirname;
  const files = fs.readdirSync(providersDir).filter((f) => {
    if (EXCLUDED_FILES.has(f)) return false;
    return f.endsWith('.ts') || f.endsWith('.js');
  });

  for (const file of files) {
    const modulePath = path.join(providersDir, file);
    const mod = require(modulePath);

    if (typeof mod.register !== 'function') {
      log.warn({ file }, 'Provider file has no register() export, skipping');
      continue;
    }

    const registration: ProviderRegistration = mod.register();

    if (FACTORY_MAP[registration.name]) {
      throw new Error(`Duplicate provider name: "${registration.name}"`);
    }

    FACTORY_MAP[registration.name] = registration.factory;

    for (const model of registration.models) {
      const key = model.key || model.model;
      MODEL_REGISTRY[key] = model;
    }

    log.info({ provider: registration.name, models: registration.models.map(m => m.displayName) }, 'Provider registered');
  }
}

export function createProvider(modelType: string): AIProvider {
  const config = MODEL_REGISTRY[modelType];
  if (!config) {
    throw new Error(`Unknown model type: "${modelType}". Available: ${Object.keys(MODEL_REGISTRY).join(', ')}`);
  }

  const factory = FACTORY_MAP[config.provider];
  if (!factory) {
    throw new Error(`No factory registered for provider: "${config.provider}"`);
  }

  return factory(config.model);
}

export function getModelConfig(modelType: string): ModelConfig | undefined {
  return MODEL_REGISTRY[modelType];
}

export function getAvailableModels(): ModelConfig[] {
  return Object.values(MODEL_REGISTRY);
}
