import { PDFParse } from 'pdf-parse';
import axios from 'axios';
import dns from 'dns';
import { convert } from 'html-to-text';
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

function isPrivateIP(ip: string): boolean {
  return (
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip === '0.0.0.0' ||
    ip === '::1'
  );
}

export async function extractFromUrl(url: string): Promise<{ text: string; title: string }> {
  log.info({ url }, 'Extracting text from URL');

  const hostname = new URL(url).hostname;
  const { address } = await dns.promises.lookup(hostname);

  if (isPrivateIP(address)) {
    log.warn({ url, resolvedIP: address }, 'Blocked SSRF attempt');
    throw new SsrfBlockedError('Cannot fetch private/internal URLs');
  }

  let responseData: string;
  try {
    const response = await axios.get<string>(url, {
      timeout: 15000,
      maxRedirects: 3,
      headers: { 'User-Agent': 'AI-Sandbox-Bot/1.0' },
      responseType: 'text',
    });
    responseData = response.data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FetchFailedError(`Failed to fetch URL: ${message}`);
  }

  const text = convert(responseData, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  });

  if (!text.trim()) {
    throw new CorruptFileError('No readable text found at this URL');
  }

  const titleMatch = responseData.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : hostname;

  log.info({ url, textLength: text.length, title }, 'URL extraction complete');
  return { text, title };
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
