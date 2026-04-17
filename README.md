# AI Sandbox

A full-stack AI chat application with multi-model support, tool calling, and real-time web search. Chat with multiple AI models through a single interface -- the AI can search the web, fetch pages, check your calendar, and do calculations mid-conversation.

## Features

- **Multi-model chat** -- switch between OpenAI GPT, Google Gemini, Llama 3.2, Gemma 3 4B, and DeepSeek
- **Tool calling** -- AI can search the web, fetch URLs, check Google Calendar, get current date/time, and evaluate math during a conversation
- **Intelligent context management** -- in-memory context service with token budgeting and 10-min TTL cache
- **Tool selection UI** -- choose which tools the AI can use per thread via modal interface
- **Web search** -- powered by self-hosted SearXNG, no external API keys needed
- **Streaming responses** -- real-time token-by-token output via SSE
- **Threaded conversations** -- persistent chat history with PostgreSQL
- **Voice input** -- speak your messages using Web Speech API
- **Image support** -- attach images for vision-capable models
- **Light/dark theme**

## Prerequisites

- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- [Ollama](https://ollama.ai) (for local models)

## Getting Started

```bash
# 1. Clone the repo
git clone <repo-url>
cd ai-sandbox

# 2. Set up environment
cp .env.example .env
cp backend/.env.example backend/.env
# Edit backend/.env to add your API keys (optional -- local models work without them)

# 3. Pull local models (optional)
ollama pull llama3.2
ollama pull deepseek-r1:8b

# 4. Start all services
docker-compose up --build

# 5. Open http://localhost:3000
```

## Services

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:3000 | React chat interface |
| Backend | http://localhost:5001 | Express API server |
| PostgreSQL | localhost:5433 | Database |
| SearXNG | http://localhost:8888 | Search engine (also has its own web UI) |

## Supported Models

| Model | Type | Tool Calling | Requires |
|-------|------|--------------|----------|
| OpenAI GPT | Cloud | ✓ | `OPENAI_API_KEY` in `backend/.env` |
| Google Gemini | Cloud | ✓ | `GOOGLE_API_KEY` in `backend/.env` |
| Llama 3.2 | Local | ✓ | Ollama running on port 11434 |
| Gemma 3 4B | Local | ✗ | Ollama running on port 11434 |
| DeepSeek-r1 | Local | ✗ | Ollama running on port 11434 |

## AI Tools

The AI can use these tools during a conversation (supported by models with tool calling enabled):

| Tool | What it does |
|------|-------------|
| `get_current_date` | Returns the current date and time (prevents AI from using outdated training data) |
| `web_search` | Searches the web via SearXNG and returns top results |
| `fetch_url` | Fetches a web page and extracts the text content |
| `google_calendar` | Retrieves events from your Google Calendar (requires OAuth setup) |
| `calculator` | Evaluates math expressions via mathjs |

**Note:** Tools can be selected per-thread via the frontend tool selection UI.

## Project Structure

```
ai-sandbox/
├── app/              # React frontend
├── backend/          # Express + TypeScript API
│   ├── src/          # New TypeScript code
│   └── services/     # AI model integrations
├── searxng/          # SearXNG search engine config
├── docs/             # Design docs & Postman collection
└── docker-compose.yml
```

## Development

**Backend:**
```bash
cd backend
npm install
npm run dev       # Start with auto-reload
npm test          # Run tests
```

**Frontend:**
```bash
cd app
npm install
npm start         # Dev server with HMR
npm run lint:fix  # Auto-fix lint issues
```

**Database:**
```bash
cd backend
npx prisma migrate dev --name <name>   # Create migration
npx prisma studio                      # Database GUI
```

## Environment Variables

**`backend/.env`** (copy from `backend/.env.example`):

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Set by Docker |
| `OPENAI_API_KEY` | OpenAI API key (optional) | -- |
| `GOOGLE_API_KEY` | Google Gemini key (optional) | -- |
| `SEARXNG_URL` | SearXNG instance URL | `http://localhost:8888` |
| `LOG_LEVEL` | Logging level | `debug` |
| `BASE_URL` | Frontend URL for CORS | `http://localhost:3000` |

## Notes

- Local models (Llama, DeepSeek) require Ollama running on the host machine
- SearXNG runs locally via Docker -- no search API keys needed
- Tool calling currently works with Llama 3.2; other models use text-only mode
- Auth is a hardcoded dev user -- not for production use
