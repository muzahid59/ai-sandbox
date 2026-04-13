import axios from 'axios';
import { ToolDefinition, ToolResult } from '../types';
import logger from '../config/logger';

const log = logger.child({ tool: 'web_search' });

export const definition: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web for current information. Use this when the user asks about recent events, news, real-time data, or anything that may have changed after your training cutoff.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return (1-10, default 5)',
      },
    },
    required: ['query'],
  },
  timeoutMs: 10000,
};

export async function handler(input: Record<string, unknown>): Promise<ToolResult> {
  const query = input.query as string;
  if (!query || typeof query !== 'string') {
    return { success: false, output: 'Missing or invalid "query" parameter' };
  }

  const numResults = Math.min(10, Math.max(1, Number(input.num_results) || 5));
  const searxngUrl = process.env.SEARXNG_URL || 'http://searxng:8080';

  try {
    log.info({ query, numResults }, 'Searching web');

    const response = await axios.get(`${searxngUrl}/search`, {
      params: { q: query, format: 'json', categories: 'general' },
      timeout: 8000,
    });

    const results = response.data?.results || [];

    if (results.length === 0) {
      return { success: true, output: `No results found for: ${query}` };
    }

    const topResults = results.slice(0, numResults);
    const formatted = topResults
      .map(
        (r: { title: string; content: string; url: string }, i: number) =>
          `${i + 1}. ${r.title}\n   ${r.content || 'No snippet available'}\n   URL: ${r.url}`,
      )
      .join('\n\n');

    log.info({ resultCount: topResults.length }, 'Search complete');
    return { success: true, output: formatted };
  } catch (error: any) {
    log.error({ err: error, query }, 'Search failed');
    return { success: false, output: 'Search service unavailable: ' + error.message };
  }
}
