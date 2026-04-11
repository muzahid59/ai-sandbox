# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Backend (`backend/`)
```bash
npm start          # Start Express server on port 5001 (ts-node)
npm run dev        # Start with nodemon (auto-restart on file changes)
npm run build      # Compile TypeScript to dist/
npm test           # Run Jest tests
npm run start:legacy  # Start legacy JS server (index.js)
```

### Frontend (`app/`)
```bash
npm start          # Start React dev server on port 3000 (DISABLE_ESLINT_PLUGIN=true)
npm run build      # Production build
npm test           # Run Jest tests
npm run lint       # ESLint check (src/**/*.{js,jsx})
npm run lint:fix   # ESLint auto-fix
npm run format     # Prettier format (src/**/*.{js,jsx,css,md})
```

### Docker
```bash
docker-compose up --build   # Build and start all services (frontend, backend, postgres)
docker-compose down -v      # Stop and remove containers + volumes (fresh start)
```

### Database (Prisma)
```bash
cd backend
npx prisma migrate dev --name <name>   # Create and apply migration (local dev)
npx prisma migrate deploy              # Apply pending migrations (production/Docker)
npx prisma generate                    # Regenerate Prisma client after schema changes
npx prisma studio                      # Open database GUI
```

## Architecture

Monorepo with two services + database:
- **`app/`** — React 18 frontend (port 3000)
- **`backend/`** — Express.js + TypeScript API server (port 5001)
- **PostgreSQL 16** — Database via Docker (port 5433 on host, 5432 internally)

### Backend

Hybrid JS/TS codebase. New code in `backend/src/` (TypeScript), legacy code in `backend/controllers/`, `backend/routes/`, `backend/services/` (JavaScript). `tsconfig.json` uses `allowJs: true` for coexistence.

**Entry point:** `backend/src/server.ts` — mounts legacy routes and new `/api/v1` routes.

**API Routes:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/threads` | GET | List threads (cursor pagination) |
| `/api/v1/threads` | POST | Create thread (requires `model`) |
| `/api/v1/threads/:id` | GET | Get thread with messages |
| `/api/v1/threads/:id` | PATCH | Update thread (title, status) |
| `/api/v1/threads/:id` | DELETE | Soft-delete thread |
| `/api/v1/threads/:id/messages` | GET | List messages (cursor pagination) |
| `/api/v1/threads/:id/messages` | POST | Send message (SSE streaming response) |
| `/content-completion` | POST | Legacy chat endpoint (SSE) |
| `/text-completion` | POST | Legacy text completion |

**Auth:** Hardcoded user middleware (`backend/src/middleware/auth.ts`) injects a dev user on all `/api/v1` routes. TODO: Replace with real JWT auth.

**Database:** PostgreSQL with Prisma ORM (v5.22.0). Schema in `backend/prisma/schema.prisma`. Models: `Thread`, `Message`. Content stored as JSONB content blocks.

**AI Service Factory** (`backend/services/ai_factory.js`): Creates AI service instances by type string (`'openai'`, `'google'`, `'deepseek'`, `'lama'`). Each service extends the abstract `AIService` base class in `backend/services/ai_services.js`.

**Context Service** (`backend/src/services/contextService.ts`): In-memory context window cache (Map with 10-min TTL). Builds conversation context from recent messages with token budget.

**SSE Format** (new `/api/v1` endpoints):
```
data: {"type": "message_created", "user_msg_id": "...", "assistant_msg_id": "..."}
data: {"type": "delta", "text": "chunk", "msg_id": "..."}
data: {"type": "done", "msg_id": "...", "stop_reason": "end_turn"}
data: {"type": "error", "code": "...", "message": "...", "retryable": true}
```

### Frontend

**State Architecture:** Thread state (`threads[]`, `activeThreadId`) lives in `App.js` and flows down as props.

```
App.js (threads[], activeThreadId, thread CRUD handlers)
  ├── Sidebar (threads, activeThreadId, onSelectThread, onNewChat, onDeleteThread)
  └── ChatContainer (activeThreadId, onThreadCreated, onThreadUpdated)
        ├── MessageList (messages)
        ├── MessageBubble (message)
        └── ChatInput (inputValue, model, handlers)
```

**`api.js`** — API client for thread/message REST calls and SSE streaming. Replaces `fetch_message.js` for new endpoints.

**`fetch_message.js`** — Legacy SSE client for `/content-completion`. Kept for backward compatibility but no longer used by ChatContainer.

**Styling**: CSS Modules per component (e.g., `ChatInput.module.css`). Prettier config in `app/.prettierrc` (single quotes, trailing commas, 100 print width).

## Environment Setup

Backend requires `backend/.env` (copy from `backend/.env.example`):
- `DATABASE_URL` — PostgreSQL connection string (default: `postgresql://ai_sandbox:ai_sandbox_dev@localhost:5433/ai_sandbox?schema=public`)
- `OPENAI_API_KEY` — For OpenAI GPT
- `GOOGLE_API_KEY` — For Google Gemini
- `DEEP_SEEK_API_KEY` — For DeepSeek (cloud)
- `BASE_URL` — Frontend URL for CORS (default: `http://localhost:3000`)

Llama and DeepSeek local models require Ollama running on port 11434. Docker uses `host.docker.internal` to reach the host Ollama instance.

## Testing

**Backend:** Jest + ts-jest + supertest. Tests in `backend/tests/`. Config in `backend/jest.config.ts`.

**Postman collection:** `docs/postman/chat-thread-api.postman_collection.json` — covers all thread/message API endpoints.
