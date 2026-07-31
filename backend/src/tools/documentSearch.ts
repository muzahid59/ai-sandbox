import { z } from 'zod';
import { RunnableTool } from './types';
import { ToolError } from '../errors';
import { ToolExecutionContext } from '../types/context';
import { searchDocuments } from '../services/retrievalService';
import logger from '../config/logger';

const log = logger.child({ tool: 'document_search' });

const schema = z.object({
  query: z.string().describe('The search query — rephrase the user\'s question as a search query'),
});

export const documentSearch: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'document_search',
    description:
      'Search documents uploaded to this conversation thread for relevant passages. Use this tool when the user asks about or references their uploaded documents.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query — rephrase the user\'s question as a search query',
        },
      },
      required: ['query'],
    },
  },
  schema,
  timeoutMs: 15000,

  async run({ query }, context?: ToolExecutionContext) {
    if (!context?.threadId) {
      throw new ToolError('Document search requires a thread context');
    }

    log.info({ query, threadId: context.threadId }, 'Searching documents');

    const results = await searchDocuments(context.threadId, query);

    if (results.length === 0) {
      return 'No relevant passages found in the uploaded documents.';
    }

    const formatted = results
      .map(
        r => `[Source: ${r.documentTitle}, chunk ${r.chunkIndex}]\n${r.content}`
      )
      .join('\n\n---\n\n');

    const sourcesUsed = [...new Set(results.map(r => r.documentId))];

    log.info({ resultCount: results.length, sourcesUsed: sourcesUsed.length }, 'Document search complete');

    return JSON.stringify({
      success: true,
      output: `Found ${results.length} relevant passages:\n\n${formatted}`,
      metadata: {
        sourcesUsed,
        chunksSearched: results.length,
        sources: results.map(r => ({
          documentId: r.documentId,
          documentTitle: r.documentTitle,
          chunkIndex: r.chunkIndex,
          relevanceScore: r.relevanceScore,
          snippet: r.content.slice(0, 200),
        })),
      },
    });
  },
};
