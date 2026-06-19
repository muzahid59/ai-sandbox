import prisma from '../config/database';
import { MessageParam } from '../types/messages';
import { extractTextContent } from '../providers/utils';
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
    const cached = this.lookupCache(threadId);
    if (cached) return cached;

    const chronological = await this.fetchMessages(threadId);
    if (chronological.length === 0) return [];

    const window = this.applyTokenBudget(chronological, maxTokens);
    const merged = this.enforceMinimumMessages(window, chronological);

    const rawMessages: MessageParam[] = merged.map((m) => ({
      role: m.role as MessageParam['role'],
      content: extractTextContent(
        typeof m.content === 'string' ? m.content : (m.content as any[]),
      ),
    }));

    const messages = this.enforceRoleAlternation(rawMessages, threadId);
    this.validateLastRole(messages, threadId);

    const totalTokens = messages.reduce((sum, m) => {
      const text = typeof m.content === 'string' ? m.content : String(m.content);
      return sum + this.estimateTokens(text);
    }, 0);

    log.info(
      {
        threadId,
        totalMessages: chronological.length,
        includedMessages: messages.length,
        estimatedTokens: totalTokens,
        tokenBudget: maxTokens - 4096,
      },
      'Context window built',
    );

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
    return Math.ceil(text.length / 4);
  }

  private lookupCache(threadId: string): MessageParam[] | null {
    const cached = this.cache.get(threadId);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      log.debug({ threadId, messageCount: cached.messages.length }, 'Context cache hit');
      return cached.messages;
    }
    return null;
  }

  private async fetchMessages(threadId: string) {
    const dbMessages = await prisma.message.findMany({
      where: { threadId, status: 'complete' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    log.debug({ threadId, dbMessageCount: dbMessages.length }, 'Messages fetched from DB');
    return dbMessages.reverse();
  }

  private applyTokenBudget(chronological: any[], maxTokens: number): any[] {
    const reserveForCompletion = 4096;
    let budget = maxTokens - reserveForCompletion;
    const window: any[] = [];

    for (const msg of [...chronological].reverse()) {
      const text = this.extractText(msg.content as any[]);
      const tokens = this.estimateTokens(text);
      if (budget - tokens < 0) break;
      window.unshift(msg);
      budget -= tokens;
    }

    return window;
  }

  private enforceMinimumMessages(window: any[], allMessages: any[]): any[] {
    const minMessages = allMessages.slice(-4);
    return this.dedupeById([...window, ...minMessages]);
  }

  private enforceRoleAlternation(rawMessages: MessageParam[], threadId: string): MessageParam[] {
    const messages: MessageParam[] = [];
    for (const current of rawMessages) {
      const previous = messages[messages.length - 1];
      if (!previous || previous.role !== current.role) {
        messages.push(current);
      } else {
        const contentPreview = typeof current.content === 'string'
          ? current.content.substring(0, 50)
          : String(current.content).substring(0, 50);
        log.warn({ threadId, skippedRole: current.role, skippedContent: contentPreview },
          'Skipped consecutive message with same role');
      }
    }
    return messages;
  }

  private validateLastRole(messages: MessageParam[], threadId: string): void {
    if (messages.length > 0 && messages[messages.length - 1].role !== 'user') {
      log.warn({ threadId, lastRole: messages[messages.length - 1].role },
        'Last message is not from user - this may cause LLM errors');
    }
  }

  private extractText(content: any[]): string {
    return extractTextContent(content);
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

export const contextService = new ContextService();
