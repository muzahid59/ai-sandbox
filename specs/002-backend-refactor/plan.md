# Implementation Plan: Backend Architecture Refactor

**Branch**: `002-backend-refactor` | **Date**: 2026-06-10 | **Spec**: `specs/002-backend-refactor/spec.md`
**Input**: Feature specification from `specs/002-backend-refactor/spec.md`

## Summary

Refactor the backend to enforce clean architecture principles: slim controllers that only delegate, deduplicated provider logic via shared conversion utilities, consistent structured logging with correlation IDs, a self-registering provider pattern, an SSE writer abstraction, and externalized system prompts. All changes are purely structural — no API contract changes, no new features, no database schema changes.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), Node.js LTS
**Primary Dependencies**: Express 4.x, Prisma 5.22.0, pino, OpenAI SDK, @google/generative-ai, axios (Ollama), mathjs, zod
**Storage**: PostgreSQL 16 via Prisma ORM. Models: Thread, Message, ToolCall. Content stored as JSONB.
**Testing**: Jest + ts-jest + supertest. Tests in `backend/tests/`. Config in `backend/jest.config.ts`.
**Target Platform**: Linux/macOS server (Docker Compose for production)
**Project Type**: Web service (REST API + SSE streaming)
**Performance Goals**: <200ms p95 non-streaming endpoints, <500ms first SSE delta (per constitution)
**Constraints**: Preserve all existing API contracts (request/response shapes, SSE event types). No database schema changes.
**Scale/Scope**: ~2,500 LOC backend TypeScript. 3 providers, 5 tools, 2 controllers, 6 services.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Gate

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality | PASS | Refactor directly addresses: decompose large functions (contextService 110-line method, controller 156 lines), enforce single responsibility, eliminate dead code patterns. All new code will be TypeScript strict. |
| II. Testing Standards | PASS | Existing tests must continue passing (FR-009). New shared utilities (message conversion, SSE writer) will have unit tests. Integration tests for API contracts unchanged. |
| III. User Experience Consistency | PASS | No frontend changes. SSE event format preserved exactly (FR-009). Streaming behavior unchanged. |
| IV. Performance Requirements | PASS | Refactor is structural only — no new queries, no new network calls, no bundle size impact. Provider abstraction adds negligible overhead (function call indirection). |

**Gate Result**: PASS — no violations. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/002-backend-refactor/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── sse-events.md    # SSE event contract
└── tasks.md             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── config/
│   │   ├── logger.ts              # Pino logger setup (unchanged)
│   │   └── database.ts            # Prisma client singleton (unchanged)
│   ├── controllers/
│   │   ├── messageController.ts   # REFACTOR: slim to ~30 lines, delegate to chatService
│   │   └── threadController.ts    # REFACTOR: add logging, consistent error handling
│   ├── middleware/
│   │   ├── auth.ts                # Unchanged
│   │   ├── errorHandler.ts        # REFACTOR: add logging
│   │   └── requestLogger.ts       # REFACTOR: attach correlation ID to req
│   ├── routes/
│   │   ├── messageRoutes.ts       # Unchanged
│   │   └── threadRoutes.ts        # Unchanged
│   ├── services/
│   │   ├── chatService.ts         # REFACTOR: extract SSE writer usage, prompt loading
│   │   ├── messageService.ts      # Unchanged (already clean)
│   │   ├── threadService.ts       # REFACTOR: receive incrementThreadTokens from messageService
│   │   ├── contextService.ts      # REFACTOR: decompose buildContextWindow into helpers
│   │   ├── toolExecutor.ts        # REFACTOR: use correlation ID in logging
│   │   └── toolRegistry.ts        # Unchanged (already clean)
│   ├── providers/
│   │   ├── index.ts               # REFACTOR: auto-registration via directory scan
│   │   ├── types.ts               # REFACTOR: add register() export convention
│   │   ├── utils.ts               # NEW: shared message conversion utilities
│   │   ├── openai.ts              # REFACTOR: use shared utils, remove duplicate logic
│   │   ├── google.ts              # REFACTOR: use shared utils, remove duplicate logic
│   │   └── ollama.ts              # REFACTOR: use shared utils, remove duplicate logic
│   ├── tools/                     # Unchanged (already follows clean patterns)
│   ├── prompts/                   # NEW: externalized system prompt files
│   │   ├── index.ts               # Prompt loader
│   │   ├── default.ts             # Default tool-capable system prompt
│   │   └── simple.ts              # Non-tool-capable model prompt
│   ├── sse/                       # NEW: SSE writer abstraction
│   │   ├── sseWriter.ts           # SSE event formatting and writing
│   │   └── types.ts               # SSE event type definitions (moved from types/events.ts)
│   ├── types/
│   │   ├── messages.ts            # Unchanged
│   │   ├── content.ts             # Unchanged
│   │   ├── events.ts              # REFACTOR: re-export from sse/types.ts
│   │   └── index.ts               # Unchanged
│   ├── errors/
│   │   └── index.ts               # Unchanged (already comprehensive)
│   └── server.ts                  # REFACTOR: provider auto-registration at startup
├── prisma/
│   └── schema.prisma              # Unchanged (no schema changes)
└── tests/
    ├── providers/
    │   └── utils.test.ts           # NEW: tests for shared conversion utilities
    ├── services/
    │   └── contextService.test.ts  # UPDATE: test decomposed helpers
    └── sse/
        └── sseWriter.test.ts       # NEW: tests for SSE writer
```

**Structure Decision**: Existing web application structure retained. Three new directories added under `backend/src/`: `prompts/` for externalized system prompts, `sse/` for SSE writer abstraction, `providers/utils.ts` for shared conversion utilities. No structural changes to frontend.

## Post-Design Constitution Re-Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality | PASS | All new code is TypeScript strict. New modules (`providers/utils.ts`, `sse/sseWriter.ts`, `prompts/`) each have single responsibility. No function exceeds 50 lines in the design. Shared utils eliminate duplication. |
| II. Testing Standards | PASS | New shared utilities get unit tests (`providers/utils.test.ts`). SSE writer gets unit tests (`sse/sseWriter.test.ts`). Existing integration tests must pass unmodified (FR-009). |
| III. User Experience Consistency | PASS | No frontend changes. SSE event format preserved exactly per `contracts/sse-events.md`. No user-visible behavior changes. |
| IV. Performance Requirements | PASS | No new DB queries. Provider auto-registration adds ~10ms at startup (one-time directory scan). Shared utility functions are zero-overhead (same operations, different location). |

**Post-Design Gate Result**: PASS — no violations.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
