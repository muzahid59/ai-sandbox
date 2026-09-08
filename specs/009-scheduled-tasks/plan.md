# Implementation Plan: Scheduled / Recurring Tasks (009)

**Feature ID**: 009
**Status**: Ready for task generation
**Created**: 2026-09-08
**Spec**: [spec.md](spec.md)

---

## Technical Context

### Current Architecture

- **Backend**: Express.js + TypeScript (`backend/src/`), Prisma ORM v5.22.0, PostgreSQL 16
- **Frontend**: React 18 + TypeScript (`app/src/`), CSS Modules, prop-drilling state management
- **AI Integration**: Multi-provider via `backend/src/providers/` (OpenAI, Google, Ollama) with auto-registration
- **Tool System**: `ToolRegistry` singleton (`backend/src/services/toolRegistry.ts`), 13 registered tools, `runAgenticLoop` (`backend/src/services/toolExecutor.ts`) with 10-iteration max
- **SSE Streaming**: `SSEWriter` utility, event types: `message_start`, `content_block_delta`, `content_block_start`/`stop`, `action_pending`, `message_stop`, `error`
- **Auth**: JWT bearer token via `backend/src/middleware/auth.ts`, `req.user` injected with `{ id, email }`
- **Message Flow**: `handleSendMessage` → `processMessage` (chatService) → `runAgenticLoop` (toolExecutor)
- **Existing scheduled behavior**: `setInterval` in `server.ts` every 60s for pending action expiry (no job queue)

### Key Integration Points

| Integration Point | File | What Changes |
|---|---|---|
| Prisma schema | `backend/prisma/schema.prisma` | Add `ScheduledTask`, `TaskExecution` models, `TaskExecutionStatus` enum, relations |
| Server startup | `backend/src/server.ts` | Initialize pg-boss, load tasks, register worker, graceful shutdown |
| Chat service | `backend/src/services/chatService.ts` | Extract `processMessage` to be callable from scheduled task handler (already suitable) |
| Provider registry | `backend/src/providers/index.ts` | Use `createProvider()` and `getAvailableModels()` for model validation |
| New service | `backend/src/services/scheduledTaskService.ts` | CRUD + scheduling + execution + pruning logic |
| New service | `backend/src/services/taskScheduler.ts` | pg-boss initialization, schedule management, job handler |
| New controller | `backend/src/controllers/scheduledTaskController.ts` | HTTP handlers for all task endpoints |
| New routes | `backend/src/routes/scheduledTaskRoutes.ts` | REST endpoints mounted at `/api/v1/scheduled-tasks` |
| New shared types | `shared/types/scheduledTask.ts` | `ScheduledTask`, `TaskExecution`, request/response types |
| Frontend API client | `app/src/api.ts` | `fetchScheduledTasks()`, `createScheduledTask()`, `updateScheduledTask()`, `deleteScheduledTask()`, `fetchTaskExecutions()` |
| Frontend types | `app/src/types/index.ts` | Import and re-export shared scheduled task types |
| Frontend state | `app/src/App.tsx` | `scheduledTasks` state, CRUD handlers, pass to layout |
| Sidebar | `app/src/components/Sidebar/Sidebar.tsx` | Scheduled tasks section below Recents |
| New component | `app/src/components/ScheduledTasks/` | `ScheduledTasksPanel.tsx`, `TaskForm.tsx`, `TaskDetail.tsx`, `ExecutionHistory.tsx` + CSS Modules |

### Dependencies Introduced

| Package | Purpose | Size |
|---------|---------|------|
| `pg-boss` (backend) | Postgres-backed job queue with cron scheduling | ~120KB |
| `cron-parser` (backend) | Cron expression parsing and interval validation | ~15KB |
| `cronstrue` (frontend) | Cron expression to human-readable text | ~25KB |

---

## Constitution Check

### I. Code Quality (NON-NEGOTIABLE)
- ✅ All new code in TypeScript under `backend/src/`
- ✅ Single responsibility: `scheduledTaskService` (CRUD), `taskScheduler` (pg-boss lifecycle), `scheduledTaskController` (HTTP)
- ✅ Structured pino logging for all task lifecycle events (created, executed, failed, timeout, skipped, deleted)
- ✅ No dead code — pg-boss replaces no existing code
- ✅ Functions decomposed: scheduler init, job handler, execution wrapper, pruning each separate

### II. Testing Standards
- ✅ Unit tests for `scheduledTaskService` (CRUD, validation, pruning, cron validation)
- ✅ Integration tests for all 6 REST endpoints (list, create, get, update, delete, executions)
- ✅ Unit tests for `taskScheduler` (job handler logic, timeout, overlap skip, error handling)
- ✅ Frontend component tests for `ScheduledTasksPanel`, `TaskForm` (validation, submission, model selector)
- ✅ Tests deterministic — mock pg-boss and cron-parser, no real scheduling in tests

### III. User Experience Consistency
- ✅ Task form validates all fields with actionable error messages before submission
- ✅ Loading, empty, and error states for task list and execution history
- ✅ Cron expression shows human-readable preview as user types
- ✅ Enable/disable toggle provides immediate visual feedback
- ✅ CSS Modules for all new components
- ✅ Keyboard navigation and ARIA labels on all interactive elements

### IV. Performance Requirements
- ✅ Task CRUD endpoints under 200ms at p95 (simple DB operations)
- ✅ pg-boss polling adds negligible overhead (polls on its own interval, not per-request)
- ✅ Task list limited to 20 per user — no pagination needed, constant query cost
- ✅ Execution history pruned to 50 records — bounded query
- ✅ `cronstrue` is the only new frontend dependency (~25KB gzipped) — within 500KB bundle budget

### Quality Gates
- ✅ Lint, Type, Test, Coverage gates enforced
- ✅ No SSRF risk — task prompts are user content, not URLs
- ✅ Authorization enforced: userId checked on all task operations; cross-user access returns 404
- ✅ No hardcoded secrets — pg-boss uses existing `DATABASE_URL`

---

## Phase 0: Research (Complete)

All unknowns resolved in [research.md](research.md):
- Job queue: pg-boss (Postgres-backed, built-in cron scheduling, timezone support)
- Cron validation: cron-parser (compute intervals, enforce 5-minute minimum)
- Execution flow: reuse `processMessage()` from chatService with task owner's identity
- Overlap prevention: `running` flag on ScheduledTask + handler early-return
- Timeout: `Promise.race` with 5-minute limit + AbortController
- Thread auto-creation: reuse existing thread creation with `metadata.type = 'scheduled_task'`
- Frontend: sidebar section + overlay panel (MemoryManager pattern) + cronstrue for preview
- Startup recovery: re-register all enabled tasks with pg-boss on startup
- Sequential execution: pg-boss concurrency controls per userId

---

## Phase 1: Design & Contracts (Complete)

- [data-model.md](data-model.md) — `ScheduledTask`, `TaskExecution` entities, `TaskExecutionStatus` enum, Prisma schema, indexes, cascade behavior
- [contracts/api.md](contracts/api.md) — 6 REST endpoints (CRUD + toggle + execution history), request/response shapes, error codes, shared TypeScript interfaces
- [quickstart.md](quickstart.md) — dev setup, manual API testing, frontend testing steps

---

## Implementation Sequence

### Backend (dependency order)

1. **Dependencies** — Install `pg-boss` and `cron-parser` in `backend/`
2. **Schema** — Add `ScheduledTask`, `TaskExecution` models + `TaskExecutionStatus` enum + relations to `schema.prisma`, run migration
3. **Shared types** — Add `ScheduledTask`, `TaskExecution`, request/response interfaces to `shared/types/scheduledTask.ts`; export from `shared/types/index.ts`
4. **Service — scheduledTaskService.ts** — CRUD operations:
   - `createTask(userId, data)` — validate cron (cron-parser), validate model (provider registry), validate timezone, enforce 20-task limit, auto-create thread if needed, compute `nextRunAt`, insert
   - `getTask(taskId, userId)` — fetch with ownership check
   - `listTasks(userId)` — fetch all tasks for user
   - `updateTask(taskId, userId, data)` — validate changed fields, update, recompute `nextRunAt`
   - `deleteTask(taskId, userId)` — delete with ownership check
   - `getExecutions(taskId, userId, limit, cursor)` — paginated execution history
   - `recordExecution(taskId, result)` — insert execution record + prune beyond 50
   - `validateCronInterval(cronExpression)` — reject intervals < 5 minutes
5. **Service — taskScheduler.ts** — pg-boss lifecycle:
   - `initScheduler(databaseUrl)` — create and start pg-boss instance
   - `scheduleTask(task)` — register cron schedule with pg-boss
   - `unscheduleTask(taskId)` — remove schedule from pg-boss
   - `rescheduleTask(task)` — unschedule + schedule (for updates)
   - `registerWorker()` — `boss.work('scheduled-task:*', taskHandler)`
   - `taskHandler(job)` — load task, check running/enabled, execute prompt via chatService, record result
   - `loadAllTasks()` — startup recovery: schedule all enabled tasks
   - `stopScheduler()` — graceful shutdown
6. **Controller — scheduledTaskController.ts** — HTTP handlers for all endpoints (request validation with Zod, response formatting)
7. **Routes — scheduledTaskRoutes.ts** — Express Router mounting all endpoints
8. **Server integration** — `server.ts`: initialize pg-boss after DB connection, load tasks, register worker, mount routes, add graceful shutdown handler
9. **Backend tests** — Unit tests for service + scheduler, integration tests for API endpoints

### Frontend (dependency order)

10. **Frontend dependency** — Install `cronstrue` in `app/`
11. **Types** — Import shared types in `app/src/types/index.ts`
12. **API client** — Add `fetchScheduledTasks()`, `createScheduledTask()`, `updateScheduledTask()`, `deleteScheduledTask()`, `fetchTaskExecutions()` to `api.ts`
13. **ScheduledTasksPanel** — `app/src/components/ScheduledTasks/ScheduledTasksPanel.tsx` + CSS Module: lists tasks, create/edit/delete actions, execution history view
14. **TaskForm** — `app/src/components/ScheduledTasks/TaskForm.tsx` + CSS Module: creation/edit form with name, prompt, cron builder (presets + manual), model selector, timezone selector, cronstrue preview
15. **Sidebar integration** — Add scheduled tasks section to Sidebar below Recents: task count badge, click to open panel
16. **App state** — Add `scheduledTasks` state to `App.tsx`, fetch on auth, CRUD handlers, `showScheduledTasks` toggle, pass to layout
17. **Frontend tests** — Component tests for `ScheduledTasksPanel`, `TaskForm`

### Finalization

18. **Postman** — Update collection with all new endpoints
19. **Manual E2E** — Create task, wait for execution, verify thread output, check execution history, toggle, edit, delete
