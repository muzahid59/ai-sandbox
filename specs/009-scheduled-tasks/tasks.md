# Tasks: Scheduled / Recurring Tasks (009)

**Feature**: Scheduled / Recurring Tasks
**Spec**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)
**Generated**: 2026-09-08

---

## Phase 1: Setup

> Project initialization — install dependencies, run migrations, create shared types.

- [ ] T001 Install `pg-boss` and `cron-parser` backend dependencies in `backend/package.json`
- [ ] T002 Install `cronstrue` frontend dependency in `app/package.json`
- [ ] T003 Add `TaskExecutionStatus` enum, `ScheduledTask` model, and `TaskExecution` model to `backend/prisma/schema.prisma` per data-model.md (include indexes, cascade rules, relations to User and Thread)
- [ ] T004 Run Prisma migration (`npx prisma migrate dev --name add-scheduled-tasks`) and regenerate client (`npx prisma generate`)
- [ ] T005 Create shared type definitions in `shared/types/scheduledTask.ts`: `ScheduledTask`, `TaskExecution`, `CreateScheduledTaskRequest`, `UpdateScheduledTaskRequest` interfaces per contracts/api.md; export from `shared/types/index.ts`

---

## Phase 2: Foundational

> Core backend services that all user stories depend on. Must complete before user story phases.

- [ ] T006 Create `backend/src/services/scheduledTaskService.ts` with `createTask(userId, data)`: validate cron expression via `cron-parser`, validate minimum 5-minute interval (compute next 5 occurrences, check gaps), validate timezone (IANA check), validate model via provider registry `getAvailableModels()`, enforce 20-task limit per user, auto-create thread if `threadId` not provided (reuse existing thread creation with `metadata: { type: 'scheduled_task' }`), compute `nextRunAt`, insert via Prisma
- [ ] T007 Add `getTask(taskId, userId)`, `listTasks(userId)`, `updateTask(taskId, userId, data)`, `deleteTask(taskId, userId)` methods to `backend/src/services/scheduledTaskService.ts`: ownership check on get/update/delete (return null if not owned), recompute `nextRunAt` on schedule changes, clear `nextRunAt` when disabled
- [ ] T008 Add `getExecutions(taskId, userId, limit, cursor)` and `recordExecution(taskId, result)` methods to `backend/src/services/scheduledTaskService.ts`: cursor pagination by `startedAt` descending, auto-prune execution records beyond 50 per task after insert
- [ ] T009 Create `backend/src/services/taskScheduler.ts` with pg-boss lifecycle: `initScheduler(databaseUrl)` (create and start pg-boss instance), `scheduleTask(task)` (register cron with `boss.schedule('scheduled-task:${taskId}', cron, { taskId }, { tz: timezone })`), `unscheduleTask(taskId)` (remove schedule), `rescheduleTask(task)` (unschedule + schedule), `loadAllTasks()` (startup recovery: query all enabled tasks, schedule each), `stopScheduler()` (graceful shutdown via `boss.stop({ graceful: true })`)
- [ ] T010 Add `registerWorker()` and `taskHandler(job)` to `backend/src/services/taskScheduler.ts`: worker via `boss.work('scheduled-task:*', handler)`, handler loads task from DB, checks `enabled` and `running` flags (skip if running/disabled), sets `running = true`, creates user message in thread, calls `processMessage()` from chatService with task owner's identity and model, wraps in 5-minute `Promise.race` timeout with `AbortController`, on completion records `TaskExecution` with status `success`/`failed`/`timeout`, updates `lastRunAt`/`nextRunAt`, sets `running = false`, prunes old executions

---

## Phase 3: User Story 1 — Task CRUD via API (P1)

> **Goal**: Users can create, read, update, and delete scheduled tasks via REST endpoints.
>
> **Independent test criteria**: All 6 REST endpoints respond correctly (201/200/404/400/409/429), request validation rejects invalid input, ownership scoping prevents cross-user access.

- [ ] T011 [US1] Create `backend/src/controllers/scheduledTaskController.ts` with `createTask` handler: parse and validate request body with Zod (name 1-100 chars, prompt 1-2000 chars, cronExpression, timezone, model, optional threadId), call `scheduledTaskService.createTask()`, call `taskScheduler.scheduleTask()`, return 201 with task JSON; map service errors to HTTP error codes per contracts/api.md (400 INVALID_CRON, INTERVAL_TOO_SHORT, INVALID_TIMEZONE, INVALID_MODEL, VALIDATION_ERROR; 409 DUPLICATE_NAME; 429 TASK_LIMIT_REACHED)
- [ ] T012 [US1] Add `listTasks`, `getTask`, `updateTask`, `deleteTask` handlers to `backend/src/controllers/scheduledTaskController.ts`: `listTasks` returns `{ tasks: [...] }`; `getTask` returns task with recent executions (call `getExecutions` with limit 10); `updateTask` validates changed fields with Zod, calls service + `rescheduleTask`/`unscheduleTask` as needed, returns updated task; `deleteTask` calls service + `unscheduleTask`, returns `{ success: true }`
- [ ] T013 [US1] Add `getExecutions` handler to `backend/src/controllers/scheduledTaskController.ts`: parse `limit` (default 20, max 50) and `cursor` query params, call `scheduledTaskService.getExecutions()`, return `{ executions: [...], nextCursor }` per contracts/api.md
- [ ] T014 [US1] Create `backend/src/routes/scheduledTaskRoutes.ts`: Express Router mounting all endpoints — `GET /` (listTasks), `POST /` (createTask), `GET /:id` (getTask), `PATCH /:id` (updateTask), `DELETE /:id` (deleteTask), `GET /:id/executions` (getExecutions); apply auth middleware
- [ ] T015 [US1] Integrate scheduled tasks into `backend/src/server.ts`: import and mount routes at `/api/v1/scheduled-tasks`, initialize pg-boss after DB connection (`initScheduler` with `DATABASE_URL`), call `loadAllTasks()` + `registerWorker()` after start, add `stopScheduler()` to graceful shutdown handler on SIGTERM/SIGINT

---

## Phase 4: User Story 2 — Enable/Disable & Schedule Management (P2)

> **Goal**: Users can toggle tasks on/off, and the scheduler correctly starts/stops cron jobs.
>
> **Independent test criteria**: PATCH with `{ enabled: false }` clears `nextRunAt` and unschedules from pg-boss; PATCH with `{ enabled: true }` recomputes `nextRunAt` and re-registers schedule; toggling does not lose task configuration.

- [ ] T016 [US2] Verify enable/disable toggle logic in `scheduledTaskService.updateTask()` in `backend/src/services/scheduledTaskService.ts`: when `enabled` changes to `false`, set `nextRunAt = null`; when `enabled` changes to `true`, compute and set `nextRunAt` from cron expression + timezone
- [ ] T017 [US2] Verify reschedule/unschedule integration in `scheduledTaskController.updateTask` in `backend/src/controllers/scheduledTaskController.ts`: when `enabled` set to `false`, call `unscheduleTask()`; when `enabled` set to `true` or `cronExpression`/`timezone` changes, call `rescheduleTask()`

---

## Phase 5: User Story 3 — Automated Task Execution (P3)

> **Goal**: Scheduled tasks fire automatically at the configured cron time, execute the prompt through the agentic loop, and post results in the task's thread.
>
> **Independent test criteria**: pg-boss fires job at scheduled time, handler calls `processMessage()` with correct user identity and model, result message appears in designated thread, `TaskExecution` record is created with correct status and duration.

- [ ] T018 [US3] Verify `taskHandler` in `backend/src/services/taskScheduler.ts` correctly loads task, creates user message in thread, calls `processMessage()` from `backend/src/services/chatService.ts` with task owner identity (`{ id: task.userId }`) and task model, streams response into thread
- [ ] T019 [US3] Verify overlap prevention in `taskHandler` in `backend/src/services/taskScheduler.ts`: check `running` flag before execution, skip and log if `running === true`, do not record skipped run as failure
- [ ] T020 [US3] Verify 5-minute timeout in `taskHandler` in `backend/src/services/taskScheduler.ts`: `Promise.race` with 300,000ms timer + `AbortController`, on timeout record `TaskExecution` with status `timeout`, post error message to thread, set `running = false`
- [ ] T021 [US3] Verify failure handling in `taskHandler` in `backend/src/services/taskScheduler.ts`: on `processMessage()` error, record `TaskExecution` with status `failed` and error message, post error message to thread, keep task `enabled = true` for future runs, set `running = false`

---

## Phase 6: User Story 4 — Execution History (P4)

> **Goal**: Users can view a list of recent executions for each task showing timestamp, status, duration, and a link to the result message.
>
> **Independent test criteria**: GET `/:id/executions` returns paginated execution records sorted by `startedAt` descending; GET `/:id` includes recent executions inline; execution records are pruned beyond 50 per task.

- [ ] T022 [US4] Verify `recordExecution()` in `backend/src/services/scheduledTaskService.ts` correctly inserts `TaskExecution` record with all fields (`taskId`, `messageId`, `status`, `error`, `durationMs`, `startedAt`, `completedAt`) and prunes records beyond 50 per task
- [ ] T023 [US4] Verify `getExecutions()` in `backend/src/services/scheduledTaskService.ts` returns cursor-paginated results sorted by `startedAt` descending, respects `limit` (max 50), computes `nextCursor` from the last record's `startedAt`

---

## Phase 7: User Story 5 — Startup Recovery (P5)

> **Goal**: On server restart, all enabled tasks are re-scheduled and resume normal operation without user intervention.
>
> **Independent test criteria**: After server restart, `loadAllTasks()` queries all enabled tasks and registers each with pg-boss; tasks missed during downtime execute on the next scheduled interval (not retroactively).

- [ ] T024 [US5] Verify `loadAllTasks()` in `backend/src/services/taskScheduler.ts` queries all enabled `ScheduledTask` records and calls `boss.schedule()` for each with correct cron + timezone; verify idempotency (re-registering does not create duplicates)
- [ ] T025 [US5] Verify server startup sequence in `backend/src/server.ts`: `initScheduler()` → `loadAllTasks()` → `registerWorker()` order is correct; add structured pino logging for startup recovery (`"Loaded N scheduled tasks"`)

---

## Phase 8: User Story 6 — Frontend Task Management UI (P6)

> **Goal**: Users can manage scheduled tasks from the frontend — view task list in sidebar, create/edit/delete tasks via a panel, and view execution history.
>
> **Independent test criteria**: Sidebar shows scheduled tasks section with task count; clicking opens panel with task list; create form validates all fields and shows cron preview; edit/delete work correctly; execution history displays in task detail view.

- [ ] T026 [P] [US6] Import shared scheduled task types in `app/src/types/index.ts` from `@shared/types/scheduledTask`
- [ ] T027 [P] [US6] Add API client functions to `app/src/api.ts`: `fetchScheduledTasks()` (GET), `createScheduledTask(data)` (POST), `updateScheduledTask(id, data)` (PATCH), `deleteScheduledTask(id)` (DELETE), `fetchTaskExecutions(id, limit?, cursor?)` (GET) — all with Bearer token auth header
- [ ] T028 [US6] Create `app/src/components/ScheduledTasks/ScheduledTasksPanel.tsx` + `ScheduledTasksPanel.module.css`: overlay panel (follow MemoryManager/SettingsPanel pattern) listing all tasks with name, next run time, enabled badge; create/edit/delete actions; empty state; loading state; error state
- [ ] T029 [US6] Create `app/src/components/ScheduledTasks/TaskForm.tsx` + `TaskForm.module.css`: creation/edit form with fields — name (text input, max 100), prompt (textarea, max 2000), cron expression (preset selector: daily/weekdays/weekly/monthly + manual input), model selector (dropdown from available models), timezone selector (default to browser timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`); show human-readable cron preview via `cronstrue`; field validation with error messages; submit handler
- [ ] T030 [US6] Create `app/src/components/ScheduledTasks/TaskDetail.tsx` + `TaskDetail.module.css`: detail view showing task config, enable/disable toggle, edit button, delete button with confirmation; inline execution history list (status badge, timestamp, duration, link to thread message)
- [ ] T031 [US6] Create `app/src/components/ScheduledTasks/ExecutionHistory.tsx` + `ExecutionHistory.module.css`: execution history list component with status badges (success/failed/timeout/skipped), timestamps, duration, message link; "Load more" button for cursor pagination
- [ ] T032 [US6] Add scheduled tasks section to `app/src/components/Sidebar/Sidebar.tsx` below Recents: collapsible section header "Scheduled Tasks" with task count badge, list of task names with next run time and enabled/disabled indicator, "+" button to create new task
- [ ] T033 [US6] Add `scheduledTasks` state to `app/src/App.tsx`: state array + CRUD handler functions (`handleCreateTask`, `handleUpdateTask`, `handleDeleteTask`), fetch on mount, `showScheduledTasksPanel` toggle, `selectedTaskId` for detail view; pass state and handlers to Sidebar and ScheduledTasksPanel via props

---

## Phase 9: Polish & Cross-Cutting Concerns

> Finalization, documentation, and quality checks.

- [ ] T034 Add structured pino logging to `backend/src/services/scheduledTaskService.ts` and `backend/src/services/taskScheduler.ts` for all task lifecycle events: created, updated, deleted, execution_started, execution_completed, execution_failed, execution_timeout, execution_skipped, task_loaded, scheduler_started, scheduler_stopped
- [ ] T035 Add keyboard navigation and ARIA labels to all interactive elements in `app/src/components/ScheduledTasks/` components (task list items, form fields, toggle, buttons)
- [ ] T036 Update Postman collection at `docs/postman/chat-thread-api.postman_collection.json` with all 6 new scheduled task endpoints (list, create, get, update, delete, executions)
- [ ] T037 Manual E2E verification per quickstart.md: create task via API, wait for execution, verify thread output, check execution history, toggle enable/disable, edit schedule, delete task; verify frontend: sidebar section, create form, task detail, execution history

---

## Dependency Graph

```
Phase 1 (Setup)
  T001 ─┐
  T002 ─┤ (no dependencies between these, all parallelizable)
  T003 ─┤
  T005 ─┘
  T004 ─── depends on T003 (schema must exist before migration)

Phase 2 (Foundational)
  T006 ─── depends on T001, T004, T005
  T007 ─── depends on T006
  T008 ─── depends on T006
  T009 ─── depends on T001, T004
  T010 ─── depends on T006, T008, T009

Phase 3 (US1: Task CRUD API)
  T011 ─── depends on T006, T009
  T012 ─── depends on T007, T008, T009, T011
  T013 ─── depends on T008, T011
  T014 ─── depends on T011, T012, T013
  T015 ─── depends on T009, T014

Phase 4 (US2: Enable/Disable)
  T016 ─── depends on T007
  T017 ─── depends on T012, T016

Phase 5 (US3: Automated Execution)
  T018 ─── depends on T010
  T019 ─── depends on T010
  T020 ─── depends on T010
  T021 ─── depends on T010

Phase 6 (US4: Execution History)
  T022 ─── depends on T008
  T023 ─── depends on T008

Phase 7 (US5: Startup Recovery)
  T024 ─── depends on T009
  T025 ─── depends on T015, T024

Phase 8 (US6: Frontend)
  T026 ─── depends on T005
  T027 ─── depends on T005
  T028 ─── depends on T026, T027
  T029 ─── depends on T002, T026, T027
  T030 ─── depends on T027, T028
  T031 ─── depends on T027
  T032 ─── depends on T028
  T033 ─── depends on T028, T029, T030, T031, T032

Phase 9 (Polish)
  T034 ─── depends on T006, T009
  T035 ─── depends on T028, T029, T030, T031
  T036 ─── depends on T014
  T037 ─── depends on all tasks
```

---

## Parallel Execution Opportunities

**Phase 1** — T001, T002, T003, T005 can all run in parallel. T004 follows T003.

**Phase 2** — T006 and T009 can run in parallel (independent services). T007 and T008 can run in parallel after T006. T010 follows both T008 and T009.

**Phase 3** — T012 and T013 can run in parallel after T011. T014 follows both.

**Phase 5** — T018, T019, T020, T021 can all run in parallel (independent verification tasks).

**Phase 6** — T022 and T023 can run in parallel.

**Phase 8** — T026 and T027 can run in parallel. T028 and T029 can run in parallel after T026+T027. T030 and T031 can run in parallel.

**Phase 9** — T034, T035, T036 can run in parallel.

---

## Implementation Strategy

**MVP scope**: Phase 1 (Setup) + Phase 2 (Foundational) + Phase 3 (US1: CRUD API) + Phase 5 (US3: Automated Execution). This gives a fully functional backend with task creation, scheduling, and execution — testable via API/Postman before any frontend work.

**Incremental delivery**:
1. Backend CRUD + scheduling (Phases 1–3, 5) — API-testable
2. Enable/disable + execution history (Phases 4, 6) — completes backend
3. Startup recovery (Phase 7) — production readiness
4. Frontend UI (Phase 8) — user-facing interface
5. Polish (Phase 9) — logging, accessibility, documentation

---

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 37 |
| Phase 1 (Setup) | 5 tasks |
| Phase 2 (Foundational) | 5 tasks |
| Phase 3 (US1: CRUD API) | 5 tasks |
| Phase 4 (US2: Enable/Disable) | 2 tasks |
| Phase 5 (US3: Execution) | 4 tasks |
| Phase 6 (US4: History) | 2 tasks |
| Phase 7 (US5: Recovery) | 2 tasks |
| Phase 8 (US6: Frontend) | 8 tasks |
| Phase 9 (Polish) | 4 tasks |
| Parallel opportunities | 8 groups |
| MVP tasks | 19 (Phases 1–3, 5) |
