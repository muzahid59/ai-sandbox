import prisma from '../config/database';

interface CacheEntry {
  prompt: string;
  timestamp: number;
}

export class ContextService {
  private cache = new Map<string, CacheEntry>();
  private ttlMs = 10 * 60 * 1000; // 10 minutes

  async buildContextWindow(threadId: string, maxTokens = 100_000): Promise<string> {
    // Check cache
    const cached = this.cache.get(threadId);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.prompt;
    }

    // Fetch from DB (newest first)
    const messages = await prisma.message.findMany({
      where: { threadId, status: 'complete' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (messages.length === 0) return '';

    // Reverse to chronological order
    const chronological = messages.reverse();

    // Token budget: walk from newest, keep what fits
    const reserveForCompletion = 4096;
    let budget = maxTokens - reserveForCompletion;
    const window: typeof chronological = [];

    for (const msg of [...chronological].reverse()) {
      const text = this.extractText(msg.content as any[]);
      const tokens = this.estimateTokens(text);
      if (budget - tokens < 0) break;
      window.unshift(msg);
      budget -= tokens;
    }

    // Safety floor: always include at least the last 4 messages
    const minMessages = chronological.slice(-4);
    const merged = this.dedupeById([...window, ...minMessages]);

    // Format as prompt string
    const prompt = merged
      .map((m) => `${m.role}: ${this.extractText(m.content as any[])}`)
      .join('\n\n');

    // Cache
    this.cache.set(threadId, { prompt, timestamp: Date.now() });

    return prompt;
  }

  invalidate(threadId: string) {
    this.cache.delete(threadId);
  }

  estimateTokens(text: string): number {
    // ~4 chars per token (rough estimate)
    // TODO: Use tiktoken for accurate counting
    return Math.ceil(text.length / 4);
  }

  private extractText(content: any[]): string {
    if (!Array.isArray(content)) return String(content);
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ');
  }

  private dedupeById(messages: any[]): any[] {
    const seen = new Set<string>();
    return messages.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }
}

// Singleton instance
// TODO: Replace with Redis-backed cache for horizontal scaling
export const contextService = new ContextService();
