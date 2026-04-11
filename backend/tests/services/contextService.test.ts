const mockPrisma = {
  message: {
    findMany: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { ContextService } from '../../src/services/contextService';

describe('ContextService', () => {
  let ctx: ContextService;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = new ContextService();
  });

  describe('buildContextWindow', () => {
    it('returns messages formatted as prompt string', async () => {
      mockPrisma.message.findMany.mockResolvedValue([
        { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'Hi!' }], createdAt: new Date('2026-01-02') },
        { id: 'm1', role: 'user', content: [{ type: 'text', text: 'Hello' }], createdAt: new Date('2026-01-01') },
      ]);

      const result = await ctx.buildContextWindow('tid-1');

      // Reversed to chronological, formatted as role: content
      expect(result).toContain('user: Hello');
      expect(result).toContain('assistant: Hi!');
      expect(result.indexOf('user: Hello')).toBeLessThan(result.indexOf('assistant: Hi!'));
    });

    it('returns empty string for empty thread', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);

      const result = await ctx.buildContextWindow('tid-1');
      expect(result).toBe('');
    });

    it('serves from cache on second call within TTL', async () => {
      mockPrisma.message.findMany.mockResolvedValue([
        { id: 'm1', role: 'user', content: [{ type: 'text', text: 'Hello' }], createdAt: new Date() },
      ]);

      await ctx.buildContextWindow('tid-1');
      await ctx.buildContextWindow('tid-1');

      // DB queried only once — second call served from cache
      expect(mockPrisma.message.findMany).toHaveBeenCalledTimes(1);
    });

    it('cache is invalidated by invalidate()', async () => {
      mockPrisma.message.findMany.mockResolvedValue([
        { id: 'm1', role: 'user', content: [{ type: 'text', text: 'Hello' }], createdAt: new Date() },
      ]);

      await ctx.buildContextWindow('tid-1');
      ctx.invalidate('tid-1');
      await ctx.buildContextWindow('tid-1');

      expect(mockPrisma.message.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      expect(ctx.estimateTokens('Hello world! This is a test.')).toBe(7);
    });
  });
});
