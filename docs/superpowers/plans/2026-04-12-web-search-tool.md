# Web Search Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `web_search` and `fetch_url` tools to the AI Sandbox, powered by a self-hosted SearXNG instance running alongside existing Docker services.

**Architecture:** SearXNG runs as a new Docker Compose service. The backend calls SearXNG's JSON API over the Docker network (`http://searxng:8080`). `web_search` returns formatted search results; `fetch_url` fetches a page and converts HTML to plain text using `html-to-text`. Both tools follow the existing pattern established by the calculator tool (export `definition` + `handler`, register in `tools/index.ts`).

**Tech Stack:** SearXNG (Docker), axios (already installed), html-to-text (new dependency), TypeScript

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `searxng/settings.yml` | Create | SearXNG configuration — enable JSON format, configure engines |
| `docker-compose.yml` | Modify | Add `searxng` service |
| `backend/.env.example` | Modify | Add `SEARXNG_URL` variable |
| `backend/.env` | Modify | Add `SEARXNG_URL` variable |
| `backend/package.json` | Modify | Add `html-to-text` + `@types/html-to-text` dependencies |
| `backend/src/tools/webSearch.ts` | Create | `web_search` tool definition + handler |
| `backend/src/tools/fetchUrl.ts` | Create | `fetch_url` tool definition + handler |
| `backend/src/tools/index.ts` | Modify | Register both new tools |
| `backend/tests/tools/webSearch.test.ts` | Create | Unit tests for web_search handler |
| `backend/tests/tools/fetchUrl.test.ts` | Create | Unit tests for fetch_url handler |

---

### Task 1: SearXNG Docker Setup

**Files:**
- Create: `searxng/settings.yml`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create SearXNG settings file**

Create `searxng/settings.yml` to enable JSON output and configure search engines:

```yaml
# SearXNG configuration for AI Sandbox
use_default_settings: true

general:
  instance_name: "AI Sandbox Search"

search:
  safe_search: 0
  autocomplete: ""
  formats:
    - html
    - json

server:
  secret_key: "ai-sandbox-searxng-secret-key"
  bind_address: "0.0.0.0"
  port: 8080

engines:
  - name: google
    engine: google
    shortcut: g
    disabled: false
  - name: bing
    engine: bing
    shortcut: b
    disabled: false
  - name: duckduckgo
    engine: duckduckgo
    shortcut: ddg
    disabled: false
  - name: wikipedia
    engine: wikipedia
    shortcut: wp
    disabled: false
```

- [ ] **Step 2: Add SearXNG service to docker-compose.yml**

Add the `searxng` service after the `postgres` service block (before the `volumes:` section):

```yaml
  searxng:
    image: searxng/searxng:latest
    ports:
      - "8888:8080"
    volumes:
      - ./searxng:/etc/searxng
    environment:
      - SEARXNG_BASE_URL=http://localhost:8888/
    restart: always
```

Also add `searxng` to the backend's `depends_on` list:

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      searxng:
        condition: service_started
```

- [ ] **Step 3: Test SearXNG starts correctly**

Run: `docker-compose up -d searxng`

Verify: `curl -s "http://localhost:8888/search?q=test&format=json" | head -c 200`

Expected: JSON response containing `"results"` array.

- [ ] **Step 4: Commit**

```bash
git add searxng/settings.yml docker-compose.yml
git commit -m "Add SearXNG service to Docker Compose"
```

---

### Task 2: Install html-to-text Dependency

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install html-to-text and its types**

Run: `cd backend && npm install html-to-text && npm install --save-dev @types/html-to-text`

- [ ] **Step 2: Verify installation**

Run: `cd backend && node -e "const { convert } = require('html-to-text'); console.log(convert('<h1>Hello</h1><p>World</p>'))"`

Expected output:
```
HELLO

World
```

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "Add html-to-text dependency for fetch_url tool"
```

---

### Task 3: Add SEARXNG_URL Environment Variable

**Files:**
- Modify: `backend/.env.example`
- Modify: `backend/.env`

- [ ] **Step 1: Add SEARXNG_URL to .env.example**

Append to `backend/.env.example`:

```
SEARXNG_URL=http://localhost:8888
```

- [ ] **Step 2: Add SEARXNG_URL to .env**

Append to `backend/.env`:

```
SEARXNG_URL=http://localhost:8888
```

- [ ] **Step 3: Add SEARXNG_URL to docker-compose backend environment**

Add to the `backend` service `environment` section in `docker-compose.yml`:

```yaml
      - SEARXNG_URL=http://searxng:8080
```

This overrides the `.env` default so that inside Docker, the backend connects via Docker networking (`searxng:8080`), while local dev uses `localhost:8888`.

- [ ] **Step 4: Commit**

```bash
git add backend/.env.example docker-compose.yml
git commit -m "Add SEARXNG_URL environment variable"
```

Note: Do NOT commit `backend/.env`.

---

### Task 4: Implement web_search Tool

**Files:**
- Create: `backend/src/tools/webSearch.ts`
- Create: `backend/tests/tools/webSearch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/webSearch.test.ts`:

```typescript
import { handler } from '../../src/tools/webSearch';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('web_search handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SEARXNG_URL = 'http://localhost:8888';
  });

  it('returns formatted search results', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        results: [
          { title: 'Result One', content: 'First snippet', url: 'https://example.com/1' },
          { title: 'Result Two', content: 'Second snippet', url: 'https://example.com/2' },
        ],
      },
    });

    const result = await handler({ query: 'test query', num_results: 2 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('1. Result One');
    expect(result.output).toContain('First snippet');
    expect(result.output).toContain('https://example.com/1');
    expect(result.output).toContain('2. Result Two');
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:8888/search',
      expect.objectContaining({
        params: { q: 'test query', format: 'json', categories: 'general' },
      }),
    );
  });

  it('returns error when query is missing', async () => {
    const result = await handler({});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Missing');
  });

  it('returns message when no results found', async () => {
    mockedAxios.get.mockResolvedValue({ data: { results: [] } });

    const result = await handler({ query: 'obscure query' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('No results found');
  });

  it('handles SearXNG connection error', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await handler({ query: 'test' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Search service unavailable');
  });

  it('clamps num_results to 1-10 range', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        results: Array.from({ length: 15 }, (_, i) => ({
          title: `Result ${i + 1}`,
          content: `Snippet ${i + 1}`,
          url: `https://example.com/${i + 1}`,
        })),
      },
    });

    const result = await handler({ query: 'test', num_results: 20 });

    expect(result.success).toBe(true);
    // Should only include 10 results (max)
    expect(result.output).toContain('10.');
    expect(result.output).not.toContain('11.');
  });

  it('defaults to 5 results', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        results: Array.from({ length: 8 }, (_, i) => ({
          title: `Result ${i + 1}`,
          content: `Snippet ${i + 1}`,
          url: `https://example.com/${i + 1}`,
        })),
      },
    });

    const result = await handler({ query: 'test' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('5.');
    expect(result.output).not.toContain('6.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/tools/webSearch.test.ts --verbose`

Expected: FAIL — `Cannot find module '../../src/tools/webSearch'`

- [ ] **Step 3: Implement web_search tool**

Create `backend/src/tools/webSearch.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/tools/webSearch.test.ts --verbose`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/tools/webSearch.ts backend/tests/tools/webSearch.test.ts
git commit -m "Add web_search tool with tests"
```

---

### Task 5: Implement fetch_url Tool

**Files:**
- Create: `backend/src/tools/fetchUrl.ts`
- Create: `backend/tests/tools/fetchUrl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/fetchUrl.test.ts`:

```typescript
import { handler } from '../../src/tools/fetchUrl';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock dns.promises.lookup
jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));
import dns from 'dns';
const mockedDnsLookup = dns.promises.lookup as jest.MockedFunction<typeof dns.promises.lookup>;

describe('fetch_url handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches and converts HTML to plain text', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 } as any);
    mockedAxios.get.mockResolvedValue({
      data: '<html><body><h1>Hello World</h1><p>Some content here.</p></body></html>',
    });

    const result = await handler({ url: 'https://example.com' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Hello World');
    expect(result.output).toContain('Some content here.');
    expect(result.output).not.toContain('<html>');
  });

  it('rejects missing url', async () => {
    const result = await handler({});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Invalid URL');
  });

  it('rejects non-http URLs', async () => {
    const result = await handler({ url: 'ftp://example.com/file' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('must start with http');
  });

  it('blocks private IP 127.x.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 } as any);

    const result = await handler({ url: 'http://localhost/secret' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('private/internal');
  });

  it('blocks private IP 10.x.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '10.0.0.1', family: 4 } as any);

    const result = await handler({ url: 'http://internal-server.com/data' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('private/internal');
  });

  it('blocks private IP 172.16.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '172.16.0.1', family: 4 } as any);

    const result = await handler({ url: 'http://some-host.com' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('private/internal');
  });

  it('blocks private IP 192.168.x.x', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '192.168.1.1', family: 4 } as any);

    const result = await handler({ url: 'http://router.local' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('private/internal');
  });

  it('truncates output to max_length', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 } as any);
    const longContent = '<p>' + 'A'.repeat(10000) + '</p>';
    mockedAxios.get.mockResolvedValue({ data: longContent });

    const result = await handler({ url: 'https://example.com', max_length: 100 });

    expect(result.success).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(100);
  });

  it('handles fetch errors gracefully', async () => {
    mockedDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 } as any);
    mockedAxios.get.mockRejectedValue(new Error('timeout'));

    const result = await handler({ url: 'https://slow-site.com' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Failed to fetch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/tools/fetchUrl.test.ts --verbose`

Expected: FAIL — `Cannot find module '../../src/tools/fetchUrl'`

- [ ] **Step 3: Implement fetch_url tool**

Create `backend/src/tools/fetchUrl.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/tools/fetchUrl.test.ts --verbose`

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/tools/fetchUrl.ts backend/tests/tools/fetchUrl.test.ts
git commit -m "Add fetch_url tool with SSRF protection and tests"
```

---

### Task 6: Register Both Tools

**Files:**
- Modify: `backend/src/tools/index.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/toolRegistration.test.ts`:

```typescript
import { toolRegistry } from '../../src/services/toolRegistry';

// Clear registry before importing tools (registry is a singleton)
// We test by checking that registerAllTools doesn't throw and tools are available
describe('Tool Registration', () => {
  it('registers all tools without errors', () => {
    // Import fresh — registerAllTools is called at module level in server.ts
    // but we can call it directly here
    const { registerAllTools } = require('../../src/tools/index');

    // This will throw if a tool is already registered (from other test runs)
    // so we only check it doesn't throw on first call
    // Since the registry is a singleton and other tests may run first,
    // we just verify the tools exist
    expect(toolRegistry.has('calculator')).toBe(true);
    expect(toolRegistry.has('web_search')).toBe(true);
    expect(toolRegistry.has('fetch_url')).toBe(true);
  });

  it('exposes correct number of tool definitions', () => {
    const definitions = toolRegistry.getDefinitions();
    expect(definitions.length).toBeGreaterThanOrEqual(3);

    const names = definitions.map((d) => d.name);
    expect(names).toContain('calculator');
    expect(names).toContain('web_search');
    expect(names).toContain('fetch_url');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/tools/toolRegistration.test.ts --verbose`

Expected: FAIL — `web_search` and `fetch_url` not found in registry.

- [ ] **Step 3: Update tools/index.ts to register new tools**

Replace the contents of `backend/src/tools/index.ts`:

```typescript
import { toolRegistry } from '../services/toolRegistry';
import * as calculator from './calculator';
import * as webSearch from './webSearch';
import * as fetchUrl from './fetchUrl';

export function registerAllTools(): void {
  toolRegistry.register(calculator.definition, calculator.handler);
  toolRegistry.register(webSearch.definition, webSearch.handler);
  toolRegistry.register(fetchUrl.definition, fetchUrl.handler);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/tools/toolRegistration.test.ts --verbose`

Expected: All 2 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `cd backend && npx jest --verbose`

Expected: All tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add backend/src/tools/index.ts backend/tests/tools/toolRegistration.test.ts
git commit -m "Register web_search and fetch_url tools"
```

---

### Task 7: End-to-End Docker Verification

**Files:** None (verification only)

- [ ] **Step 1: Rebuild and start all services**

Run: `docker-compose down && docker-compose rm -sf backend && docker-compose up --build -d`

Note: `docker-compose rm -sf backend` removes the backend container and its anonymous volume to avoid stale `node_modules` (the same issue we hit with `mathjs`).

- [ ] **Step 2: Verify SearXNG is accessible from the backend container**

Run: `docker-compose exec backend sh -c "wget -qO- 'http://searxng:8080/search?q=test&format=json' | head -c 300"`

Expected: JSON response with search results.

- [ ] **Step 3: Verify SearXNG is accessible from host**

Run: `curl -s "http://localhost:8888/search?q=hello+world&format=json" | python3 -m json.tool | head -20`

Expected: Formatted JSON with `results` array.

- [ ] **Step 4: Test web_search via the chat**

Open `http://localhost:3000` in a browser. Send a message like "What happened in tech news today?" using the Llama model. Verify:
- The AI calls `web_search` (SSE event `tool_use_start` appears in DevTools Network tab)
- Search results are returned (SSE event `tool_use_result`)
- The AI generates a response citing the search results

- [ ] **Step 5: Test fetch_url via the chat**

Send a follow-up message like "Can you get more details from the first link?" Verify:
- The AI calls `fetch_url` with one of the URLs from the search results
- Page content is returned as plain text
- The AI summarizes the content

- [ ] **Step 6: Check logs for tool execution**

Run: `docker-compose logs backend --tail 50 | grep -E "(web_search|fetch_url|Tool call)"`

Expected: Log entries showing tool call start/end with durations.

- [ ] **Step 7: Final commit — update .env.example**

```bash
git add backend/.env.example
git commit -m "Update .env.example with SEARXNG_URL"
```

Note: This was already done in Task 3, so skip if already committed.

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | SearXNG Docker setup | Manual (curl) |
| 2 | Install html-to-text | Manual (node -e) |
| 3 | SEARXNG_URL env var | N/A |
| 4 | web_search tool | 6 unit tests |
| 5 | fetch_url tool | 9 unit tests |
| 6 | Register tools | 2 integration tests |
| 7 | End-to-end Docker verification | Manual |
