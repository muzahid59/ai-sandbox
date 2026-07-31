import crypto from 'crypto';
import prisma from '../config/database';
import logger from '../config/logger';
import { extractText, PasswordProtectedError, CorruptFileError } from './textExtractor';
import { chunkText } from './textChunker';
import { embedTexts, EMBEDDING_MODEL } from './embeddingService';
import { updateDocumentStatus, isCancelled } from './documentService';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pgvector = require('pgvector') as { toSql: (v: number[]) => string };

const log = logger.child({ service: 'documentProcessor' });

export async function processDocument(
  documentId: string,
  content: Buffer,
  mimeType: string
): Promise<void> {
  const startTime = Date.now();

  try {
    // Stage 1: Extract text
    await updateDocumentStatus(documentId, 'extracting');
    const extractStart = Date.now();
    const rawText = await extractText(content, mimeType);
    const text = rawText.replace(/\x00/g, '');
    log.info({ event: 'document.extract', documentId, durationMs: Date.now() - extractStart, charCount: text.length });

    if (!text.trim()) {
      await updateDocumentStatus(documentId, 'failed', 'No readable text found in this document');
      log.info({ event: 'document.process.failed', documentId, reason: 'empty_text' });
      return;
    }

    // Stage 2: Chunk text
    if (await isCancelled(documentId)) return;
    await updateDocumentStatus(documentId, 'chunking');
    const chunkStart = Date.now();
    const chunks = chunkText(text);
    log.info({ event: 'document.chunk', documentId, durationMs: Date.now() - chunkStart, chunkCount: chunks.length });

    if (chunks.length === 0) {
      await updateDocumentStatus(documentId, 'failed', 'No readable text found in this document');
      log.info({ event: 'document.process.failed', documentId, reason: 'no_chunks' });
      return;
    }

    // Stage 3: Embed chunks
    if (await isCancelled(documentId)) return;
    await updateDocumentStatus(documentId, 'embedding');
    const embedStart = Date.now();
    const texts = chunks.map(c => c.content);
    const embeddings = await embedTexts(texts);
    log.info({
      event: 'document.embed',
      documentId,
      durationMs: Date.now() - embedStart,
      chunkCount: chunks.length,
      batchCount: Math.ceil(chunks.length / 100),
    });

    // Stage 4: Store chunks
    if (await isCancelled(documentId)) return;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      const chunkId = crypto.randomUUID();

      await prisma.$executeRaw`
        INSERT INTO document_chunks (id, document_id, chunk_index, content, token_count, embedding, search_vector, embedding_model, created_at)
        VALUES (
          ${chunkId},
          ${documentId},
          ${chunk.index},
          ${chunk.content},
          ${chunk.tokenCount},
          ${pgvector.toSql(embedding)}::vector,
          to_tsvector('english', ${chunk.content}),
          ${EMBEDDING_MODEL},
          NOW()
        )
      `;
    }

    await updateDocumentStatus(documentId, 'ready', undefined, chunks.length);
    log.info({ event: 'document.process.complete', documentId, durationMs: Date.now() - startTime, chunkCount: chunks.length });
  } catch (err) {
    const message = resolveErrorMessage(err);
    await updateDocumentStatus(documentId, 'failed', message);
    log.error({ event: 'document.process.failed', documentId, durationMs: Date.now() - startTime, error: message });
  }
}

function resolveErrorMessage(err: unknown): string {
  if (err instanceof PasswordProtectedError) {
    return 'This PDF is password-protected and cannot be read';
  }
  if (err instanceof CorruptFileError) {
    return (err as Error).message || 'This file appears to be corrupt';
  }
  if (err instanceof Error && err.message.includes('OPENAI')) {
    return 'Indexing service unavailable — please re-upload shortly';
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('rate') || msg.includes('api')) {
      return 'Indexing service unavailable — please re-upload shortly';
    }
    return `Processing failed: ${err.message}`;
  }
  return 'An unexpected error occurred during document processing';
}
