# AI Sandbox

A full-stack AI chat application built as a learning project — each feature implements a real pattern used in production AI systems. Multi-model support, tool calling, authentication, persistent memory, and personalization — all wired together end to end.

## Features

### Core Chat
- **Multi-model chat** — switch between OpenAI GPT, Google Gemini, Llama 3.2, Gemma 3 4B, and DeepSeek
- **Streaming responses** — real-time token-by-token output via SSE
- **Threaded conversations** — persistent chat history with PostgreSQL
- **Tool calling** — AI can search the web, fetch URLs, check Google Calendar, and evaluate math mid-conversation
- **Tool selection UI** — choose which tools the AI can use per thread
- **Intelligent context management** — token-budgeted context window with 10-min TTL cache
- **Voice input** — speak your messages using Web Speech API
- **Image support** — attach images for vision-capable models
- **Light/dark theme**

### Authentication
- **JWT auth** — email/password signup and login
- **Token rotation** — short-lived access tokens (15 min) + long-lived refresh tokens (30 days, httpOnly cookie)
- **Google OAuth 2.0** — connect your Google account for Calendar and Gmail tools
- **Silent refresh** — access tokens refresh automatically in the background

### Memory & Personalization
- **Persistent memory** — the AI remembers facts about you across threads ("User prefers bullet-point summaries", "User works in TypeScript")
- **Auto-extraction** — after every AI response, a background call extracts and saves durable facts without blocking the stream
- **Memory injection** — all memories prepended to every system prompt within a 2,000-token budget
- **Duplicate detection** — Jaccard similarity prevents near-identical memories being saved twice
- **Memory Manager** — view, add, edit, and delete your memories from the UI
- **Custom instructions** — set a persistent instruction block prepended to every AI prompt
- **User preferences** — set a display name, default AI model, and custom instructions that persist across sessions
- **Display name in AI prompts** — the AI knows and uses your name in responses

## Prerequisites

- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- [Ollama](https://ollama.ai) (for local models)

## Getting Started

```bash
# 1. Clone the repo
git clone <repo-url>
cd ai-sandbox

# 2. Set up environment
cp backend/.env.example backend/.env
# Edit backend/.env — add API keys (optional; local models work without them)
# Required for auth: set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to any random strings

# 3. Pull local models (optional)
ollama pull llama3.2
ollama pull deepseek-r1:8b

# 4. Start all services
docker-compose up --build

# 5. Open http://localhost:3000 — register an account to get started
```

> **Note:** Migrations run automatically on container startup via `npx prisma migrate deploy`. After pulling new changes that include schema changes, `docker-compose up --build` is enough — no manual migration step needed.

## Services

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:3000 | React chat interface |
| Backend | http://localhost:5001 | Express API server |
| PostgreSQL | localhost:5433 | Database |
| SearXNG | http://localhost:8888 | Self-hosted search engine |

## Supported Models

| Model | Type | Tool Calling | Requires |
|-------|------|--------------|----------|
| OpenAI GPT | Cloud | ✓ | `OPENAI_API_KEY` in `backend/.env` |
| Google Gemini | Cloud | ✓ | `GOOGLE_API_KEY` in `backend/.env` |
| Llama 3.2 | Local | ✓ | Ollama running on port 11434 |
| Gemma 3 4B | Local | ✗ | Ollama running on port 11434 |
| DeepSeek-r1 | Local | ✗ | Ollama running on port 11434 |

## AI Tools

| Tool | What it does |
|------|-------------|
| `web_search` | Searches the web via SearXNG |
| `fetch_url` | Fetches a web page and extracts text (SSRF-protected) |
| `google_calendar` | Reads your Google Calendar events (requires OAuth) |
| `calculator` | Evaluates math expressions via mathjs |
| `get_current_date` | Returns current date/time (prevents stale training data answers) |
| `read_emails` | Reads Gmail messages (requires OAuth) |
| `search_emails` | Searches Gmail (requires OAuth) |
| `draft_email` | Creates an email draft in Gmail (requires OAuth) |
| `reply_email` | Creates a reply draft in Gmail (requires OAuth) |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/auth/register` | Create account |
| `POST /api/v1/auth/login` | Login |
| `POST /api/v1/auth/refresh` | Refresh access token |
| `POST /api/v1/auth/logout` | Logout |
| `GET/POST /api/v1/threads` | List / create threads |
| `GET/PATCH/DELETE /api/v1/threads/:id` | Thread operations |
| `GET/POST /api/v1/threads/:id/messages` | List / send messages (SSE) |
| `GET/POST /api/v1/memories` | List / create memories |
| `PATCH/DELETE /api/v1/memories/:id` | Update / delete a memory |
| `GET/PATCH /api/v1/preferences` | Get / update user preferences |

## Project Structure

```
ai-sandbox/
├── app/                  # React 18 frontend (TypeScript, strict)
│   └── src/
│       ├── components/   # ChatContainer, Sidebar, MemoryManager, SettingsPanel, …
│       ├── pages/        # LoginPage, RegisterPage
│       └── services/     # Auth service, API client
├── backend/              # Express + TypeScript API (strict)
│   ├── src/
│   │   ├── controllers/  # Request handlers
│   │   ├── services/     # Business logic (chat, memory, auth, preferences, …)
│   │   ├── routes/       # Express routers
│   │   ├── providers/    # AI provider adapters (OpenAI, Google, Ollama)
│   │   ├── tools/        # Tool definitions and handlers
│   │   └── middleware/   # Auth, error handling, request logging
│   ├── prisma/           # Schema + migrations
│   └── tests/            # Jest unit + integration tests (215 tests)
├── shared/               # Types shared between frontend and backend
├── docs/                 # Future roadmap, Postman collection
└── docker-compose.yml
```

## Development

**Backend:**
```bash
cd backend
npm install
npm run dev       # Start with auto-reload (ts-node + nodemon)
npm test          # Run all tests
npm run build     # Type-check + compile
```

**Frontend:**
```bash
cd app
npm install
npm start         # Dev server on port 3000
npm run lint:fix  # Auto-fix lint issues
npm run format    # Prettier format
```

**Database:**
```bash
cd backend
npx prisma migrate dev --name <name>   # Create and apply a migration
npx prisma studio                      # Database GUI
npx prisma generate                    # Regenerate client after schema change
```

## Environment Variables

**`backend/.env`** (copy from `backend/.env.example`):

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes (set by Docker) |
| `JWT_ACCESS_SECRET` | Secret for signing access tokens | Yes |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens | Yes |
| `OPENAI_API_KEY` | OpenAI API key | Optional |
| `GOOGLE_API_KEY` | Google Gemini API key | Optional |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Optional (for Gmail/Calendar) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Optional (for Gmail/Calendar) |
| `SEARXNG_URL` | SearXNG instance URL | `http://localhost:8888` |
| `LOG_LEVEL` | Logging level (`debug`, `info`, `warn`, `error`) | `debug` |
| `BASE_URL` | Frontend URL for CORS | `http://localhost:3000` |

## What This Project Teaches

Each feature was chosen to implement a real pattern from production AI systems:

| Feature | Pattern learned |
|---------|----------------|
| Multi-model chat | Provider abstraction, factory pattern |
| Tool calling + agentic loop | ReAct pattern, multi-step reasoning |
| SSE streaming | Server-sent events, backpressure |
| JWT auth | Token lifecycle, silent refresh, httpOnly cookies |
| Google OAuth | OAuth 2.0 PKCE, token encryption, scope management |
| Persistent memory | Background extraction vs tool-based recall, token budgeting, duplicate detection |
| Memory injection | System prompt engineering, context window management |
| Preferences + custom instructions | Per-user personalisation, layered prompt construction |
| Structured logging | Pino, request tracing, sensitive field redaction |
| Context window management | Token budgeting, recency bias, cache invalidation |
