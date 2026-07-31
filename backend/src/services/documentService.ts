import prisma from '../config/database';
import { DocumentSourceType, DocumentStatus } from '@prisma/client';
import logger from '../config/logger';

const log = logger.child({ service: 'documentService' });

const PROCESSING_STATES: DocumentStatus[] = [
  'processing',
  'extracting',
  'chunking',
  'embedding',
];

export async function createDocument(
  threadId: string,
  userId: string,
  title: string,
  sourceType: DocumentSourceType,
  mimeType: string,
  fileSize: number,
  contentFingerprint: string,
  sourceUrl?: string
) {
  const document = await prisma.document.create({
    data: {
      threadId,
      userId,
      title,
      sourceType,
      sourceUrl,
      mimeType,
      fileSize,
      contentFingerprint,
      status: 'processing',
    },
  });

  log.info({ documentId: document.id, title, sourceType }, 'Document created');
  return document;
}

export async function listDocuments(threadId: string) {
  return prisma.document.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getDocument(threadId: string, documentId: string) {
  return prisma.document.findFirst({
    where: { id: documentId, threadId },
  });
}

export async function deleteDocument(threadId: string, documentId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, threadId },
  });

  if (!doc) return null;

  await prisma.document.delete({ where: { id: documentId } });
  log.info({ documentId }, 'Document deleted');
  return doc;
}

export async function cancelDocument(threadId: string, documentId: string) {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, threadId },
  });

  if (!doc) return { found: false as const };

  if (!PROCESSING_STATES.includes(doc.status)) {
    return { found: true as const, processing: false as const, document: doc };
  }

  await prisma.$transaction([
    prisma.documentChunk.deleteMany({ where: { documentId } }),
    prisma.document.update({
      where: { id: documentId },
      data: { status: 'cancelled', statusMessage: 'Document processing cancelled and all data removed.' },
    }),
  ]);

  log.info({ documentId }, 'Document cancelled');
  return { found: true as const, processing: true as const };
}

export async function updateDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  statusMessage?: string,
  chunkCount?: number
) {
  return prisma.document.update({
    where: { id: documentId },
    data: {
      status,
      ...(statusMessage !== undefined && { statusMessage }),
      ...(chunkCount !== undefined && { chunkCount }),
    },
  });
}

export async function checkDuplicateFilename(threadId: string, filename: string) {
  const existing = await prisma.document.findFirst({
    where: { threadId, title: filename },
    select: { id: true, title: true },
  });

  return existing
    ? { exists: true as const, existingDocumentId: existing.id, existingTitle: existing.title }
    : { exists: false as const };
}

export async function checkDuplicateFingerprint(threadId: string, fingerprint: string) {
  return prisma.document.findFirst({
    where: { threadId, contentFingerprint: fingerprint },
    select: { id: true, title: true },
  });
}

export async function hasReadyDocuments(threadId: string): Promise<boolean> {
  const count = await prisma.document.count({
    where: { threadId, status: 'ready' },
  });
  return count > 0;
}

export async function isCancelled(documentId: string): Promise<boolean> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { status: true },
  });
  return doc?.status === 'cancelled';
}
