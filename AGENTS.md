# AGENTS.md

Compact gotchas for this repo. For commands, architecture, and API docs, see `CLAUDE.md` — that file is the canonical reference.

## Setup gotchas

- **Two `.env` files**: root `.env` (Postgres creds) + `backend/.env` (API keys, per `backend/.env.example`). Both needed.
- **Dual lockfiles** (`package-lock.json` + `yarn.lock`) in both `backend/` and `app/`. Stick with **npm** (CLAUDE.md convention).
- **Ollama** required for local models. Docker uses `host.docker.internal` to reach it. Script: `scripts/pull-models.sh`.

## Backend surprises

- **Provider auto-discovery**: `registerProviders()` (`providers/index.ts`) scans `providers/` for files exporting `register()`. Drop a file — no manual wiring.
- **Tool contract**: tools export `RunnableTool<TInput>` (`tools/types.ts`) with `{ definition, schema, run }`. Register in `tools/index.ts`.
- **Agentic loop**: 10-iteration max, tools execute **in parallel** (`Promise.all`), outputs **truncated at 10K chars** (`toolExecutor.ts:94`).
- **SSRF protection**: `fetchUrl` tool blocks private IP ranges.
- **Google Calendar**: needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
- **SSE format** (Anthropic-style): `message_start` → `content_block_delta` (text) / `content_block_start` (tool_use) / `content_block_stop` (tool_result) → `message_stop`. See `sse/types.ts`.
- **ESLint**: flat config `eslint.config.mjs`. The `.eslintrc.json` is legacy.
- **Prisma**: schema has 3 models (`Thread`, `Message`, `ToolCall`). After changes: `prisma generate` then `migrate dev`.
- **Tests** excluded from `tsc` compilation.
- **Backend test**: `NODE_OPTIONS='--max-old-space-size=4096' npx jest --forceExit --detectOpenHandles`.

## Frontend surprises

- **CRA ESLint disabled** at start (`DISABLE_ESLINT_PLUGIN=true`).
- **Prettier config** at `app/.prettierrc` only (none in `backend/`).
- **Shared types** via `@shared/*` path alias → `../shared/` — used by both packages.

## Missing infra

- **No CI workflows** exist.
