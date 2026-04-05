# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Backend (`backend/`)
```bash
npm start          # Start Express server on port 5001
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
docker-compose up --build   # Build and start both services
```

## Architecture

Monorepo with two services:
- **`app/`** — React 18 frontend (port 3000)
- **`backend/`** — Express.js API server (port 5001)

### Backend

Express server (`backend/index.js`) with routes defined in `backend/routes/index.js`:
- `POST /content-completion` — Main chat endpoint, streams responses via SSE
- `POST /text-completion` — Simple text completion

**AI Service Factory** (`backend/services/ai_factory.js`): Creates AI service instances by type string (`'openai'`, `'google'`, `'deepseek'`, `'lama'`). Each service extends the abstract `AIService` base class in `backend/services/ai_services.js`. To add a new AI provider: create a service class extending `AIService`, then register it in the factory switch.

**Response Adapters** (`backend/services/adapters/`): Normalize different AI response formats. `DeepseekResponseAdapter` strips `<think>` tags from DeepSeek reasoning output.

**Streaming**: Ollama-based services (Llama, DeepSeek) use Node.js Transform streams. The content completion controller (`backend/controllers/contentCompletionController.js`) sends SSE responses to the frontend.

### Frontend

`App.js` renders `ChatContainer` as the sole top-level component.

**`ChatContainer/ChatContainer.js`** — Central component managing messages state, model selection, speech recognition (Web Speech API), and streaming message dispatch.

**`fetch_message.js`** — SSE client that POSTs to `/content-completion` and streams responses via callback. Also handles base64 image upload for vision-capable models.

**Styling**: CSS Modules per component (e.g., `ChatInput.module.css`). Prettier config in `app/.prettierrc` (single quotes, trailing commas, 100 print width).

## Environment Setup

Backend requires `backend/.env` (copy from `backend/.env.example`):
- `OPENAI_API_KEY` — For OpenAI GPT
- `GOOGLE_API_KEY` — For Google Gemini
- `DEEP_SEEK_API_KEY` — For DeepSeek (cloud)
- `BASE_URL` — Frontend URL for CORS (default: `http://localhost:3000`)

Llama and DeepSeek local models require Ollama running on port 11434. Docker uses `host.docker.internal` to reach the host Ollama instance.
