import { z } from 'zod';
import axios from 'axios';
import { RunnableTool } from './types';
import { ToolError } from '../errors';
import logger from '../config/logger';

const log = logger.child({ tool: 'web_search' });

const schema = z.object({
  query: z.string().describe('The search query'),
  num_results: z.coerce.number().min(1).max(10).default(5).optional(),
});

export const webSearch: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'web_search',
    description:
      'Search the web for current information. REQUIRED for: news, current events, today\'s headlines, weather, sports scores, stock prices, recent developments, or any time-sensitive query. Do NOT answer these queries from memory - you MUST use this tool.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query. For news, use specific queries like "latest news April 2026" or "today\'s headlines" instead of vague terms like "today".' },
        num_results: { type: 'number', description: 'Number of results to return (1-10, default 5)' },
      },
      required: ['query'],
    },
  },
  schema,
  timeoutMs: 10000,

  async run({ query, num_results }) {
    const numResults = Math.min(10, Math.max(1, num_results ?? 5));
    const searxngUrl = process.env.SEARXNG_URL || 'http://searxng:8080';

    try {
      log.info({ query, numResults }, 'Searching web');

      const response = await axios.get(`${searxngUrl}/search`, {
        params: { q: query, format: 'json', categories: 'general' },
        timeout: 8000,
      });

      const results = response.data?.results || [];

      if (results.length === 0) {
        return `No results found for: ${query}`;
      }

      const topResults = results.slice(0, numResults);
      const formatted = topResults
        .map(
          (r: { title: string; content: string; url: string }, i: number) =>
            `${i + 1}. ${r.title}\n   ${r.content || 'No snippet available'}\n   URL: ${r.url}`,
        )
        .join('\n\n');

      log.info({ resultCount: topResults.length }, 'Search complete');
      return formatted;
    } catch (error: any) {
      log.error({ err: error, query }, 'Search failed');
      throw new ToolError(`Search service unavailable: ${error.message}`);
    }
  },
};
