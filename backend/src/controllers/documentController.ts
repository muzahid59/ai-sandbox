import crypto from 'crypto';
import { Request, Response } from 'express';
import { NotFoundError, BadRequestError, ConflictError, PermissionDeniedError, ValidationError } from '../errors';
import * as documentService from '../services/documentService';
import { processDocument } from '../services/documentProcessor';
import { extractFromUrl, SsrfBlockedError, FetchFailedError } from '../services/textExtractor';
import logger from '../config/logger';

export async function handleUploadDocument(req: Request, res: Response) {
  const start = Date.now();
  const threadId = req.params.threadId as string;
  const log = (req.log || logger).child({ operation: 'uploadDocument', threadId });
  const userId = req.user!.id;

  if (!req.file) {
    throw new BadRequestError('No file provided');
  }

  const { originalname, mimetype, size, buffer } = req.file;
  const contentFingerprint = crypto.createHash('sha256').update(buffer).digest('hex');

  const fingerprintMatch = await documentService.checkDuplicateFingerprint(threadId, contentFingerprint);
  const duplicateNotice = fingerprintMatch
    ? {
        matchedDocumentId: fingerprintMatch.id,
        matchedDocumentTitle: fingerprintMatch.title,
        message: `This content matches an existing document: ${fingerprintMatch.title}`,
      }
    : null;

  const document = await documentService.createDocument(
    threadId, userId, originalname, 'file', mimetype, size, contentFingerprint
  );

  log.info({
    event: 'document.upload',
    documentId: document.id,
    fileSize: size,
    durationMs: Date.now() - start,
  });

  processDocument(document.id, buffer, mimetype).catch(err => {
    log.error({ err, documentId: document.id }, 'Background document processing failed');
  });

  return res.status(201).json({ ...document, duplicateNotice });
}

export async function handleIngestUrl(req: Request, res: Response) {
  const threadId = req.params.threadId as string;
  const log = (req.log || logger).child({ operation: 'ingestUrl', threadId });
  const userId = req.user!.id;
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== 'string') {
    throw new BadRequestError('url is required');
  }

  try {
    new URL(url);
  } catch {
    throw new BadRequestError('Invalid URL format');
  }

  let text: string;
  let title: string;
  try {
    ({ text, title } = await extractFromUrl(url));
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw new PermissionDeniedError(err.message);
    if (err instanceof FetchFailedError) throw new ValidationError(err.message);
    throw err;
  }

  const contentBuffer = Buffer.from(text, 'utf-8');
  const contentFingerprint = crypto.createHash('sha256').update(contentBuffer).digest('hex');

  const fingerprintMatch = await documentService.checkDuplicateFingerprint(threadId, contentFingerprint);
  const duplicateNotice = fingerprintMatch
    ? {
        matchedDocumentId: fingerprintMatch.id,
        matchedDocumentTitle: fingerprintMatch.title,
        message: `This content matches an existing document: ${fingerprintMatch.title}`,
      }
    : null;

  const document = await documentService.createDocument(
    threadId, userId, title || url, 'url', 'text/html', contentBuffer.length, contentFingerprint, url
  );

  log.info({ documentId: document.id, url }, 'URL document created');

  processDocument(document.id, contentBuffer, 'text/plain').catch(err => {
    log.error({ err, documentId: document.id }, 'Background URL processing failed');
  });

  return res.status(201).json({ ...document, duplicateNotice });
}

export async function handleListDocuments(req: Request, res: Response) {
  const threadId = req.params.threadId as string;
  const documents = await documentService.listDocuments(threadId);
  return res.json({ documents });
}

export async function handleGetDocument(req: Request, res: Response) {
  const threadId = req.params.threadId as string;
  const documentId = req.params.documentId as string;
  const document = await documentService.getDocument(threadId, documentId);
  if (!document) throw new NotFoundError('Document not found');
  return res.json(document);
}

export async function handleDeleteDocument(req: Request, res: Response) {
  const threadId = req.params.threadId as string;
  const documentId = req.params.documentId as string;
  const result = await documentService.deleteDocument(threadId, documentId);
  if (!result) throw new NotFoundError('Document not found');
  return res.status(204).send();
}

export async function handleCancelDocument(req: Request, res: Response) {
  const threadId = req.params.threadId as string;
  const documentId = req.params.documentId as string;
  const result = await documentService.cancelDocument(threadId, documentId);

  if (!result.found) throw new NotFoundError('Document not found');
  if (!result.processing) {
    throw new ConflictError('Document is not in a processing state');
  }

  return res.json({
    id: documentId,
    status: 'cancelled',
    message: 'Document processing cancelled and all data removed.',
  });
}

export async function handleCheckDuplicate(req: Request, res: Response) {
  const threadId = req.params.threadId as string;
  const filename = req.query.filename as string;
  if (!filename) throw new BadRequestError('filename query parameter is required');

  const result = await documentService.checkDuplicateFilename(threadId, filename);
  return res.json({ filenameMatch: result });
}
