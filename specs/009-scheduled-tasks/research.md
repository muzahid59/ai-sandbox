# Research: Scheduled / Recurring Tasks (009)

## Job Queue Library

**Decision**: Use `pg-boss` (v10+) as the Postgres-backed job queue for scheduling and executing recurring tasks.

**Rationale**: pg-boss uses the existing PostgreSQL database — no Redis or external infrastructure needed. It provides built-in cron scheduling via `boss.schedule(name, cron, data, options)` with timezone support (`tz` option). It handles job persistence, completion tracking, and survives server restarts natively. The spec assumption explicitly calls for "a Postgres-backed job queue (e.g. pg-boss)."

**Alternatives considered**:
- `node-cron`: In-memory cron scheduler. Simple but loses all state on server restart. Would require custom persistence logic on top.
- `bull` / `bullmq`: Redis-backed. Requires introducing Redis infrastructure, which the project doesn't use.
- `agenda`: MongoDB-backed. Wrong database.
- `bree`: Worker-thread-based scheduler. No built-in persistence; would need custom DB integration.

---

## Cron Expression Validation

**Decision**: Use `cron-parser` to validate cron expressions and enforce the 5-minute minimum interval (FR14).

**Rationale**: `cron-parser` can compute the next N occurrences of a cron expression, making it straightforward to check that consecutive runs are at least 5 minutes apart. It supports IANA timezone parsing. pg-boss uses standard 5-field cron but doesn't expose interval validation, so a separate parser is needed.

**Validation algorithm**:
1. Parse the cron expression with `cron-parser`
2. Compute the next 5 occurrences
3. Check that the minimum gap between consecutive occurrences is ≥ 5 minutes
4. Reject at creation/edit time if the interval is too short

---

## pg-boss Integration Pattern

**Decision**: Initialize pg-boss in `server.ts` startup alongside the existing `setInterval` for pending action expiry. pg-boss manages its own schema in the `pgboss` schema namespace — no collision with the application's Prisma-managed `public` schema.

**Startup sequence**:
1. Create `PgBoss` instance with the existing `DATABASE_URL`
2. Call `await boss.start()` — creates/migrates the `pgboss` schema automatically
3. Load all enabled `ScheduledTask` records from the application DB
4. For each task, register a schedule: `boss.schedule(taskJobName, cronExpression, { taskId }, { tz: timezone })`
5. Register the worker: `boss.work('scheduled-task:*', handler)` to process fired jobs

**Job naming convention**: `scheduled-task:${taskId}` — unique per task, allows per-task scheduling control.

**Graceful shutdown**: Call `await boss.stop({ graceful: true })` on `SIGTERM`/`SIGINT`.

---

## Task Execution Flow

**Decision**: When pg-boss fires a job, the handler:
1. Load the `ScheduledTask` from the application DB (verify it's still enabled)
2. Check for overlapping execution (FR15): if `lastRunAt` + expected duration suggests the previous run is still in progress, skip
3. Create a user message in the task's thread with the task prompt
4. Call `processMessage()` from `chatService` (the same function used by `handleSendMessage`), passing the task's model and the user's identity
5. Wrap execution in a 5-minute timeout (FR16) via `Promise.race` with `AbortController`
6. On completion: create a `TaskExecution` record with status `success`, update `lastRunAt` and `nextRunAt`
7. On failure: create a `TaskExecution` record with status `failed`, post error message to thread
8. Prune execution history beyond 50 records (FR9)

**Rationale**: Reusing `processMessage()` gives scheduled tasks full access to the agentic loop, tools, and OAuth context — identical to a user-initiated message. No duplication of the AI pipeline.

---

## Overlapping Execution Detection

**Decision**: Track execution state using a `running` boolean column on `ScheduledTask` (or use pg-boss's built-in job deduplication). When a job fires, check if the task is currently running. If so, skip the execution silently.

**Implementation**: pg-boss supports `singletonKey` on scheduled jobs, which prevents duplicate active jobs with the same key. Setting `singletonKey: taskId` ensures only one instance of a task runs at a time. If a previous execution hasn't completed when the next fires, pg-boss queues it — but since we want to skip (not queue), we'll check the task's `running` flag in the handler and return early if true.

**Rationale**: The spec (FR15 + clarification) specifies skip, not queue. A DB-level flag is crash-safe — if the server crashes mid-execution, the flag is stale, but pg-boss's job will be retried on restart, and the startup recovery (FR11) handles re-scheduling.

---

## Execution Timeout Implementation

**Decision**: Wrap the `processMessage()` call in `Promise.race` with a timeout promise that resolves after 5 minutes (300,000ms). Use `AbortController` to signal cancellation to the AI provider and tool executor.

**Rationale**: The existing tool executor timeout (30s per tool) doesn't cap the total loop time. A 5-minute wall-clock timeout prevents runaway executions from blocking the user's sequential queue.

---

## Thread Auto-Creation

**Decision**: When a user creates a scheduled task without specifying a thread, automatically create a new thread via the existing `createThread` service with:
- `title`: task name (e.g. "Morning email digest")
- `model`: the task's configured model
- `userId`: the task owner
- `metadata`: `{ type: 'scheduled_task', taskId: taskId }`

**Rationale**: Reuses existing thread creation logic. The `metadata` field (already a Json column on Thread) marks the thread as task-generated, enabling future UI differentiation.

---

## Frontend Architecture

**Decision**: The scheduled tasks UI has three components:
1. **Sidebar section** — below the "Recents" thread list, showing a collapsible list of tasks with name + next run time + enabled/disabled badge
2. **Task list panel** — overlay panel (same pattern as MemoryManager/SettingsPanel) showing all tasks with create/edit/delete actions
3. **Task form modal** — creation and editing form with fields: name, prompt (textarea), cron expression (with human-readable preview), model selector, timezone selector

**State management**: Add `scheduledTasks: ScheduledTask[]` state in `App.tsx`, fetched on login. Pass down via `layoutProps` to `Sidebar` and the task panel. Follow the existing prop-drilling pattern.

**Rationale**: Consistent with the existing UI patterns (MemoryManager overlay, SettingsPanel overlay). No new state management library needed.

---

## Cron Expression UI

**Decision**: Provide a structured cron builder with preset options (daily, weekdays, weekly, monthly) plus a manual cron input for advanced users. Display a human-readable description of the schedule (e.g. "Every weekday at 9:00 AM") using `cronstrue` library.

**Rationale**: Raw cron expressions are error-prone for most users. Presets cover 80% of use cases. The manual input satisfies power users. `cronstrue` converts cron to English for validation feedback.

**New frontend dependency**: `cronstrue` (cron expression to human-readable text).

---

## Startup Recovery (FR11)

**Decision**: On server start, after `boss.start()`:
1. Query all enabled `ScheduledTask` records
2. For each, call `boss.schedule()` with the task's cron + timezone
3. pg-boss's schedule is idempotent — re-registering an existing schedule updates it
4. Tasks missed during downtime: pg-boss will fire the next scheduled occurrence. No retroactive execution.

**Rationale**: pg-boss persists schedules in its own schema. On restart, re-registering ensures the schedules match the application state (handles cases where a task was created/modified while pg-boss was down).

---

## Sequential Per-User Execution

**Decision**: Use pg-boss's `teamSize: 1` and `teamConcurrency: 1` configuration for the scheduled task worker. Additionally, use the task's `userId` as a `singletonKey` prefix to ensure jobs for the same user don't run concurrently.

**Rationale**: The spec assumption states "Scheduled tasks run sequentially per user to avoid OAuth token contention and rate limiting on external APIs." pg-boss's concurrency controls enforce this at the queue level.
