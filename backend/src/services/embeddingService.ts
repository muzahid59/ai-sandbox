import OpenAI from 'openai';
import logger from '../config/logger';

const log = logger.child({ service: 'embeddingService' });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const BATCH_TIMEOUT_MS = 30_000;

async function embedBatchWithRetry(batch: string[]): Promise<number[][]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);

      const response = await openai.embeddings.create(
        { model: EMBEDDING_MODEL, input: batch },
        { signal: controller.signal }
      );

      clearTimeout(timer);

      return response.data.map((item) => item.embedding);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      log.error({ attempt, error: message }, 'document.embed.error');

      if (attempt < MAX_RETRIES) {
        const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await embedBatchWithRetry(batch);
    results.push(...embeddings);
  }

  return results;
}
