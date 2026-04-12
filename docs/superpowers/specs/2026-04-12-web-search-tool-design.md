# Web Search Tool Design

## Overview

Add two tools to the AI Sandbox: `web_search` (search the web via a self-hosted SearXNG instance) and `fetch_url` (extract plain text from a specific URL). Both integrate into the existing tool-calling infrastructure (toolRegistry, agentic loop, SSE events).

## Architecture

SearXNG runs as a Docker Compose service alongside the existing backend, frontend, and postgres containers. The backend calls SearXNG's JSON API over the Docker network. No API keys or external dependencies.

```
User: "What happened in tech today?"
  → AI calls web_search({ query: "tech news today" })
  → Backend calls SearXNG: GET http://searxng:8080/search?q=tech+news+today&format=json
  → SearXNG aggregates results from Google, Bing, DuckDuckGo, etc.
  → Backend formats top 5 results as text (title + snippet + URL)
  → AI reads snippets, optionally calls fetch_url for more detail
  → AI generates answer with sources
```

## Tool 1: web_search

**Definition:**

```typescript
{
  name: 'web_search',
  description: 'Search the web for current information. Use this when the user asks about recent events, news, real-time data, or anything that may have changed after your training cutoff.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
      num_results: { type: 'number', description: 'Number of results to return (1-10)', default: 5 }
    },
    required: ['query']
  },
  timeoutMs: 10000
}
```

**Handler:**

1. Validate `query` is a non-empty string
2. Clamp `num_results` to 1-10 range (default 5)
3. Call SearXNG: `GET http://${SEARXNG_URL}/search?q=${query}&format=json&categories=general`
4. Extract top N results: `title`, `content` (snippet), `url`
5. Format as numbered text:
   ```
   1. <title>
      <snippet>
      URL: <url>

   2. <title>
      ...
   ```
6. Return `{ success: true, output: formattedText }`

**Error handling:**
- SearXNG unreachable: return `{ success: false, output: "Search service unavailable" }`
- No results: return `{ success: true, output: "No results found for: <query>" }`

**Environment variable:** `SEARXNG_URL` defaults to `http://searxng:8080` (Docker networking) or `http://localhost:8888` for local dev.

## Tool 2: fetch_url

**Definition:**

```typescript
{
  name: 'fetch_url',
  description: 'Fetch and extract the text content from a web page URL. Use when you need more detail from a specific search result or when the user shares a link.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      max_length: { type: 'number', description: 'Max characters to return (default 5000)', default: 5000 }
    },
    required: ['url']
  },
  timeoutMs: 15000
}
```

**Handler:**

1. Validate `url` is a string starting with `http://` or `https://`
2. SSRF check: block private IP ranges (127.x, 10.x, 172.16.x, 192.168.x) via URL hostname resolution
3. Fetch page with axios (GET, 10s timeout, follow redirects up to 3)
4. Convert HTML to plain text using `html-to-text` library
5. Truncate to `max_length` characters
6. Return `{ success: true, output: plainText }`

**Error handling:**
- Invalid URL: return `{ success: false, output: "Invalid URL: must start with http:// or https://" }`
- SSRF blocked: return `{ success: false, output: "Cannot fetch private/internal URLs" }`
- Fetch failed (timeout, 404, etc.): return `{ success: false, output: "Failed to fetch: <reason>" }`

## Docker Compose Changes

Add to `docker-compose.yml`:

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

**SearXNG settings file** (`searxng/settings.yml`):

- Enable JSON output format
- Enable general search category
- Configure search engines (Google, Bing, DuckDuckGo, Wikipedia)
- Set result limits

The backend connects via Docker network at `http://searxng:8080`. Port 8888 is exposed to host for debugging (you can open SearXNG UI in browser to test queries manually).

## Dependencies

- `html-to-text` — HTML to plain text conversion for fetch_url (lightweight, no headless browser)

## File Changes

| File | Change |
|------|--------|
| `backend/src/tools/webSearch.ts` | New — web_search tool definition + handler |
| `backend/src/tools/fetchUrl.ts` | New — fetch_url tool definition + handler |
| `backend/src/tools/index.ts` | Register both new tools |
| `docker-compose.yml` | Add searxng service |
| `searxng/settings.yml` | New — SearXNG configuration |
| `backend/.env` | Add `SEARXNG_URL` variable |
| `backend/package.json` | Add `html-to-text` dependency |

## Interaction Examples

**Simple search:**
```
User: "Who won the Champions League?"
AI → web_search({ query: "Champions League winner 2026" })
Backend → SearXNG → 5 results with snippets
AI: "According to search results, [team] won the 2026 Champions League..."
```

**Search + deep dive:**
```
User: "Explain the new EU AI regulation"
AI → web_search({ query: "EU AI Act 2026 regulation" })
Backend → SearXNG → 5 results
AI → fetch_url({ url: "https://example.com/eu-ai-act-details" })
Backend → fetches page, extracts text
AI: "The EU AI Act, based on [detailed content from the article]..."
```

## Out of Scope

- Caching search results (add later if needed)
- Search history or analytics
- Image/video search categories
- User-configurable search engines via UI
