import { getDefaultPrompt } from './default';
import { getSimplePrompt } from './simple';

export interface SystemPromptOptions {
  supportsTools: boolean;
  date?: string;
  timezone?: string;
}

export function getSystemPrompt(options: SystemPromptOptions): string {
  const date = options.date ?? new Date().toISOString().split('T')[0];
  const timezone = options.timezone ?? 'Asia/Dhaka (UTC+6)';

  if (options.supportsTools) {
    return getDefaultPrompt({ date, timezone });
  }
  return getSimplePrompt({ date, timezone });
}
