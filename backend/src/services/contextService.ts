import prisma from '../config/database';
import { MessageParam } from '../types/messages';
import logger from '../config/logger';

const log = logger.child({ service: 'contextService' });

interface CacheEntry {
  messages: MessageParam[];
  timestamp: number;
}

export class ContextService {
  private cache = new Map<string, CacheEntry>();
  private ttlMs = 10 * 60 * 1000; // 10 minutes

  async buildContextWindow(threadId: string, maxTokens = 100_000): Promise<MessageParam[]> {
    // Check cache
    const cached = this.cache.get(threadId);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      log.debug({ threadId, messageCount: cached.messages.length }, 'Context cache hit');
      return cached.messages;
    }

    // Fetch from DB (newest first)
    const dbMessages = await prisma.message.findMany({
      where: { threadId, status: 'complete' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    log.debug({
      threadId,
      dbMessageCount: dbMessages.length,
      messages: dbMessages.map(m => ({
        id: m.id,
        role: m.role,
        contentType: typeof m.content,
        contentPreview: JSON.stringify(m.content).substring(0, 150)
      }))
    }, 'Messages fetched from DB');

    if (dbMessages.length === 0) return [];

    // Reverse to chronological order
    const chronological = dbMessages.reverse();

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

    // Convert to MessageParam[] format
    const rawMessages: MessageParam[] = merged.map((m) => ({
      role: m.role as MessageParam['role'],
      content: typeof m.content === 'string'
        ? m.content
        : (m.content as any[])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join(' '),
    }));

    // Enforce role alternation (user → assistant → user)
    // Remove consecutive messages with the same role
    const messages: MessageParam[] = [];
    for (let i = 0; i < rawMessages.length; i++) {
      const current = rawMessages[i];
      const previous = messages[messages.length - 1];

      if (!previous || previous.role !== current.role) {
        messages.push(current);
      } else {
        // Skip consecutive same-role messages (merge or ignore)
        const contentPreview = typeof current.content === 'string'
          ? current.content.substring(0, 50)
          : String(current.content).substring(0, 50);
        log.warn({
          threadId,
          skippedRole: current.role,
          skippedContent: contentPreview,
        }, 'Skipped consecutive message with same role');
      }
    }

    // Ensure last message is from user (required by LLM APIs)
    if (messages.length > 0 && messages[messages.length - 1].role !== 'user') {
      log.warn({
        threadId,
        lastRole: messages[messages.length - 1].role,
      }, 'Last message is not from user - this may cause LLM errors');
    }

    // Calculate token usage
    const totalTokens = messages.reduce((sum, m) => {
      const text = typeof m.content === 'string' ? m.content : String(m.content);
      return sum + this.estimateTokens(text);
    }, 0);

    log.info(
      {
        threadId,
        totalMessages: dbMessages.length,
        includedMessages: messages.length,
        estimatedTokens: totalTokens,
        tokenBudget: maxTokens - 4096,
      },
      'Context window built',
    );

    // Cache
    this.cache.set(threadId, { messages, timestamp: Date.now() });

    return messages;
  }

  invalidate(threadId: string) {
    const existed = this.cache.has(threadId);
    this.cache.delete(threadId);
    if (existed) {
      log.debug({ threadId }, 'Context cache invalidated');
    }
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
