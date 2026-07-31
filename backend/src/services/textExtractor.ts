import { PDFParse } from 'pdf-parse';
import logger from '../config/logger';

const log = logger.child({ service: 'textExtractor' });

export class UnsupportedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFormatError';
  }
}

export class PasswordProtectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordProtectedError';
  }
}

export class CorruptFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptFileError';
  }
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export class FetchFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchFailedError';
  }
}

export async function extractFromPdf(buffer: Buffer): Promise<string> {
  log.debug({ size: buffer.length }, 'Extracting text from PDF');

  let result;
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    result = await parser.getText();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password|encrypt/i.test(message)) {
      throw new PasswordProtectedError('PDF is password-protected or encrypted');
    }
    throw new CorruptFileError(`Failed to parse PDF: ${message}`);
  } finally {
    await parser.destroy().catch(() => {});
  }

  if (!result.text || !result.text.trim()) {
    throw new CorruptFileError('No readable text found in this document');
  }

  log.debug({ pages: result.total, textLength: result.text.length }, 'PDF extraction complete');
  return result.text;
}

export async function extractFromText(buffer: Buffer): Promise<string> {
  log.debug({ size: buffer.length }, 'Extracting text from plain text');

  const text = buffer.toString('utf-8');

  if (!text.trim()) {
    throw new CorruptFileError('No readable text found in this document');
  }

  return text;
}

export async function extractFromUrl(_url: string): Promise<{ text: string; title: string }> {
  throw new ExtractionError('URL extraction not yet implemented — see Phase 4 (T027)');
}

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  log.info({ mimeType, size: buffer.length }, 'Extracting text from document');

  switch (mimeType) {
    case 'application/pdf':
      return extractFromPdf(buffer);
    case 'text/plain':
    case 'text/markdown':
      return extractFromText(buffer);
    default:
      throw new UnsupportedFormatError(`Unsupported file type: ${mimeType}`);
  }
}
