import axios from 'axios';
import dns from 'dns';
import { convert } from 'html-to-text';
import { ToolDefinition, ToolResult } from '../types';
import logger from '../config/logger';

const log = logger.child({ tool: 'fetch_url' });

export const definition: ToolDefinition = {
  name: 'fetch_url',
  description:
    'Fetch and extract the text content from a web page URL. Use when you need more detail from a specific search result or when the user shares a link.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch',
      },
      max_length: {
        type: 'number',
        description: 'Max characters to return (default 5000)',
      },
    },
    required: ['url'],
  },
  timeoutMs: 15000,
};

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

export async function handler(input: Record<string, unknown>): Promise<ToolResult> {
  const url = input.url as string;
  if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return { success: false, output: 'Invalid URL: must start with http:// or https://' };
  }

  const maxLength = Math.min(20000, Math.max(500, Number(input.max_length) || 5000));

  try {
    // SSRF check: resolve hostname and block private IPs
    const hostname = new URL(url).hostname;
    const { address } = await dns.promises.lookup(hostname);

    if (isPrivateIP(address)) {
      log.warn({ url, resolvedIP: address }, 'Blocked SSRF attempt');
      return { success: false, output: 'Cannot fetch private/internal URLs' };
    }

    log.info({ url, maxLength }, 'Fetching URL');

    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 3,
      headers: {
        'User-Agent': 'AI-Sandbox-Bot/1.0',
      },
      responseType: 'text',
    });

    const plainText = convert(response.data, {
      wordwrap: 120,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
      ],
    });

    const truncated = plainText.substring(0, maxLength);

    log.info({ url, originalLength: plainText.length, truncatedLength: truncated.length }, 'Fetch complete');
    return { success: true, output: truncated };
  } catch (error: any) {
    log.error({ err: error, url }, 'Fetch failed');
    return { success: false, output: `Failed to fetch: ${error.message}` };
  }
}
