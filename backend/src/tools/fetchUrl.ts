import { z } from 'zod';
import axios from 'axios';
import dns from 'dns';
import { convert } from 'html-to-text';
import { RunnableTool } from './types';
import { ToolError } from '../errors';
import logger from '../config/logger';

const log = logger.child({ tool: 'fetch_url' });

const schema = z.object({
  url: z.string().url().describe('The URL to fetch'),
  max_length: z.coerce.number().min(500).max(20000).default(5000).optional(),
});

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

export const fetchUrl: RunnableTool<z.infer<typeof schema>> = {
  definition: {
    name: 'fetch_url',
    description:
      'Fetch and extract the text content from a web page URL. Use when you need more detail from a specific search result or when the user shares a link.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        max_length: { type: 'number', description: 'Max characters to return (default 5000)' },
      },
      required: ['url'],
    },
  },
  schema,
  timeoutMs: 15000,

  async run({ url, max_length }) {
    const maxLength = max_length ?? 5000;

    // SSRF check: resolve hostname and block private IPs
    const hostname = new URL(url).hostname;
    const { address } = await dns.promises.lookup(hostname);

    if (isPrivateIP(address)) {
      log.warn({ url, resolvedIP: address }, 'Blocked SSRF attempt');
      throw new ToolError('Cannot fetch private/internal URLs');
    }

    log.info({ url, maxLength }, 'Fetching URL');

    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 3,
      headers: { 'User-Agent': 'AI-Sandbox-Bot/1.0' },
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
    return truncated;
  },
};
