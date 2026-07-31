import prisma from '../config/database';
import logger from '../config/logger';
import { embedTexts } from './embeddingService';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pgvector = require('pgvector') as { toSql: (v: number[]) => string };

const log = logger.child({ service: 'retrievalService' });

export interface SearchResult {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  relevanceScore: number;
}

interface RawSearchRow {
  id: string;
  content: string;
  chunk_index: number;
  document_id: string;
  title: string;
  score: number;
}

const RRF_K = 60;

export async function searchDocuments(
  threadId: string,
  query: string,
  topK: number = 10
): Promise<SearchResult[]> {
  const startTime = Date.now();

  const [queryEmbedding] = await embedTexts([query]);
  const embeddingSql = pgvector.toSql(queryEmbedding);

  const [vectorResults, keywordResults] = await Promise.all([
    prisma.$queryRawUnsafe<RawSearchRow[]>(
      `SELECT dc.id, dc.content, dc.chunk_index, d.id as document_id, d.title,
              1 - (dc.embedding <=> $1::vector) as score
       FROM document_chunks dc
       JOIN documents d ON dc.document_id = d.id
       JOIN threads t ON d.thread_id = t.id
       WHERE d.thread_id = $2 AND d.status = 'ready' AND t.status != 'deleted'
       ORDER BY dc.embedding <=> $1::vector
       LIMIT 20`,
      embeddingSql,
      threadId
    ),
    prisma.$queryRawUnsafe<RawSearchRow[]>(
      `SELECT dc.id, dc.content, dc.chunk_index, d.id as document_id, d.title,
              ts_rank(dc.search_vector, plainto_tsquery('english', $1)) as score
       FROM document_chunks dc
       JOIN documents d ON dc.document_id = d.id
       JOIN threads t ON d.thread_id = t.id
       WHERE d.thread_id = $2 AND d.status = 'ready' AND t.status != 'deleted'
         AND dc.search_vector @@ plainto_tsquery('english', $1)
       ORDER BY score DESC
       LIMIT 20`,
      query,
      threadId
    ),
  ]);

  const merged = mergeWithRRF(vectorResults, keywordResults);
  const results = merged.slice(0, topK).map(row => ({
    documentId: row.document_id,
    documentTitle: row.title,
    chunkIndex: row.chunk_index,
    content: row.content,
    relevanceScore: row.rrfScore,
  }));

  log.info({
    event: 'document.retrieve',
    threadId,
    durationMs: Date.now() - startTime,
    chunksReturned: results.length,
    queryLength: query.length,
  });

  return results;
}

interface RankedRow extends RawSearchRow {
  rrfScore: number;
}

function mergeWithRRF(
  vectorResults: RawSearchRow[],
  keywordResults: RawSearchRow[]
): RankedRow[] {
  const scoreMap = new Map<string, { row: RawSearchRow; vectorRank?: number; keywordRank?: number }>();

  vectorResults.forEach((row, idx) => {
    scoreMap.set(row.id, { row, vectorRank: idx + 1 });
  });

  keywordResults.forEach((row, idx) => {
    const existing = scoreMap.get(row.id);
    if (existing) {
      existing.keywordRank = idx + 1;
    } else {
      scoreMap.set(row.id, { row, keywordRank: idx + 1 });
    }
  });

  const ranked: RankedRow[] = [];
  for (const { row, vectorRank, keywordRank } of scoreMap.values()) {
    let rrfScore = 0;
    if (vectorRank !== undefined) rrfScore += 1 / (RRF_K + vectorRank);
    if (keywordRank !== undefined) rrfScore += 1 / (RRF_K + keywordRank);
    ranked.push({ ...row, rrfScore });
  }

  ranked.sort((a, b) => b.rrfScore - a.rrfScore);
  return ranked;
}
