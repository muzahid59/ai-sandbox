# Feature Specification: Scheduled / Recurring Tasks

**Feature ID**: 009
**Short Name**: scheduled-tasks
**Status**: Draft
**Created**: 2026-09-08
**Author**: Muzahidul Islam

---

## Overview

Users can create recurring automations that run on a schedule without manual triggering. Examples: "Every Monday at 9am, summarise my unread emails", "Daily at 5pm, check my calendar for tomorrow and remind me of prep work", "Every Friday, search the web for AI news and give me a digest". The assistant transitions from purely reactive (user asks, AI answers) to proactive (AI acts on a schedule and delivers results).

---

## Problem Statement

Today, every interaction with the assistant requires the user to initiate a conversation and type a request. Repetitive tasks — morning email summaries, weekly report generation, daily calendar previews — must be manually requested every time. Users who would benefit from automated briefings, digests, or reminders have no way to set them up. The assistant has no concept of time-based execution; it only responds to direct messages.

---

## Goals

1. Allow users to create scheduled tasks that execute a prompt on a recurring basis using standard cron expressions.
2. Execute scheduled tasks automatically by running the prompt through the existing agentic loop, with full access to the user's tools (email, calendar, web search, documents).
3. Deliver task results into a designated thread so the user can review outputs at their convenience.
4. Provide a task management interface where users can create, view, enable/disable, edit, and delete their scheduled tasks.
5. Show execution history for each task — when it last ran, whether it succeeded or failed, and a link to the thread containing the results.
6. Support timezone-aware scheduling so tasks run at the user's local time, not server time.

---

## Non-Goals

- Natural language cron parsing (e.g. "every weekday at 9am" → cron expression) — users select schedule via a structured UI in this phase; natural language scheduling is a future enhancement.
- Approval workflow integration for scheduled task actions — scheduled tasks execute tools without approval in this phase. Approval gating for scheduled tasks is deferred to a future iteration.
- Real-time notifications (push notifications, email alerts) when a scheduled task completes — users check the thread.
- Multi-user task sharing or team-level schedules — tasks are personal to the creating user.
- Complex workflow chaining (task A triggers task B) — each task is independent.
- Sub-minute scheduling granularity — minimum interval is 1 minute; practical minimum is 5 minutes.

---

## User Scenarios & Testing

### Scenario 1: User creates a daily email summary task

**Given** the user navigates to the task management interface
**When** the user creates a new task with prompt "Summarise my unread emails from the last 24 hours" and sets the schedule to "Every weekday at 9:00 AM" in their timezone
**Then** the task is saved with status "enabled" and the next run time is displayed

**Given** the scheduled time arrives
**When** the task executes
**Then** a new message appears in the task's designated thread containing the email summary, and the execution history shows a successful run with timestamp

---

### Scenario 2: User disables and re-enables a task

**Given** the user has an enabled scheduled task
**When** the user toggles the task to "disabled"
**Then** the task stops executing at its scheduled times and the next run time is cleared

**Given** the user re-enables the same task
**When** the task is toggled back to "enabled"
**Then** the next run time is recalculated from the cron expression and the task resumes executing on schedule

---

### Scenario 3: Scheduled task execution fails

**Given** a scheduled task runs and the agentic loop encounters an error (e.g. Google OAuth token expired, external API unreachable)
**When** the execution fails
**Then** an error message is posted in the task's thread explaining what went wrong, the execution history records the failure, and the task remains enabled for future runs (a single failure does not disable the task)

---

### Scenario 4: User views execution history

**Given** a scheduled task has run multiple times
**When** the user opens the task details
**Then** they see a list of recent executions showing: run timestamp, success/failure status, and a link to the thread message containing the result

---

### Scenario 5: User edits a task's schedule or prompt

**Given** the user has an existing scheduled task
**When** the user modifies the cron expression or prompt text and saves
**Then** the next run time recalculates based on the new schedule, and future executions use the updated prompt

---

### Scenario 6: User deletes a task

**Given** the user has a scheduled task (enabled or disabled)
**When** the user deletes the task
**Then** the task is removed from the task list, all future scheduled executions are cancelled, and the thread containing past results remains accessible

---

### Scenario 7: Server restarts with scheduled tasks in the database

**Given** multiple users have enabled scheduled tasks
**When** the server starts (or restarts)
**Then** all enabled tasks are loaded and re-scheduled, any tasks that were missed during downtime execute on the next scheduled interval (not retroactively for each missed window), and the scheduler resumes normal operation

---

### Scenario 8: User creates a task without an existing thread

**Given** the user creates a new scheduled task
**When** no thread is specified
**Then** a dedicated thread is automatically created for the task's outputs, titled with the task name, and all future results are posted there

---

## Functional Requirements

### FR1 — Task creation
Users can create a scheduled task by providing: a descriptive name, a prompt (the instruction the AI will execute), a cron expression defining the schedule, and an optional thread to post results to. If no thread is specified, a dedicated thread is created automatically.

### FR2 — Cron-based scheduling
Tasks execute on a recurring basis defined by a standard 5-field cron expression (minute, hour, day-of-month, month, day-of-week). The scheduler evaluates cron expressions in the user's configured timezone.

### FR3 — Timezone support
Each task stores the user's timezone (IANA format, e.g. "Europe/London"). The cron expression is interpreted in that timezone. Users select their timezone when creating a task; the UI defaults to the browser's detected timezone.

### FR4 — Task execution via agentic loop
When a task fires, the system creates a new assistant message in the task's thread, runs the task's prompt through the existing agentic loop with the user's full tool access (including any OAuth-connected integrations), and streams the result into the thread.

### FR5 — Execution context
The agentic loop runs with the task owner's identity, OAuth tokens, and memory context. The AI has access to the same tools and data as if the user had typed the prompt manually.

### FR6 — Enable / Disable toggle
Users can enable or disable a task at any time. Disabled tasks retain their configuration but do not execute. Re-enabling recalculates the next run time.

### FR7 — Task editing
Users can update a task's name, prompt, cron expression, and timezone. Changes take effect from the next scheduled run.

### FR8 — Task deletion
Users can delete a task permanently. Deletion cancels all future executions. The thread containing past results is not deleted.

### FR9 — Execution history
Each task maintains a record of its recent executions (last 50 runs). Each record includes: execution timestamp, duration, success/failure status, and a reference to the thread message containing the result.

### FR10 — Failure resilience
A failed execution does not disable the task. The error is logged in execution history and posted as a message in the task's thread. The task continues to fire on its next scheduled time.

### FR11 — Startup recovery
On server start, all enabled tasks are loaded from the database and scheduled. Tasks that were due during downtime execute once on the next interval rather than retroactively running for each missed window.

### FR12 — User scoping
Users can only view, edit, and delete their own tasks. Tasks execute with the creating user's identity and permissions.

### FR13 — Task limit
Each user can have a maximum of 20 scheduled tasks to prevent resource exhaustion. Attempts to create beyond this limit are rejected with a clear message.

### FR14 — Minimum interval enforcement
The system validates that cron expressions do not resolve to intervals shorter than 5 minutes. Tasks that would fire more frequently are rejected at creation time.

---

## Success Criteria

1. **Reliable execution**: Scheduled tasks fire within 60 seconds of their scheduled time under normal server load.
2. **Persistence across restarts**: 100% of enabled tasks resume scheduling after a server restart with no user intervention.
3. **Task management usability**: Users can create a new scheduled task in under 2 minutes, including selecting a schedule and writing a prompt.
4. **Failure transparency**: 100% of failed executions are visible to the user in execution history and in the task's thread — no silent failures.
5. **Zero cross-user leakage**: A user's scheduled tasks never execute with another user's identity, tools, or data.
6. **Graceful degradation**: If the job queue is temporarily unavailable, the system logs the issue and retries scheduling when the queue recovers — no tasks are permanently lost.

---

## Key Entities

### ScheduledTask

| Field          | Description                                                        |
|----------------|--------------------------------------------------------------------|
| id             | Unique identifier (UUID)                                           |
| userId         | Owning user                                                        |
| name           | Human-readable task name (e.g. "Morning email digest")             |
| prompt         | The instruction text the AI will execute                           |
| cronExpression | Standard 5-field cron expression                                   |
| timezone       | IANA timezone string (e.g. "Europe/London")                        |
| threadId       | Thread where results are posted                                    |
| enabled        | Whether the task is active                                         |
| lastRunAt      | Timestamp of the most recent execution (nullable)                  |
| nextRunAt      | Computed next execution time (nullable when disabled)              |
| createdAt      | Creation timestamp                                                 |
| updatedAt      | Last modification timestamp                                        |

### TaskExecution

| Field          | Description                                                        |
|----------------|--------------------------------------------------------------------|
| id             | Unique identifier (UUID)                                           |
| taskId         | The scheduled task this execution belongs to                       |
| messageId      | Reference to the thread message containing the result              |
| status         | `success` / `failed`                                               |
| error          | Error message if execution failed (nullable)                       |
| durationMs     | Execution duration in milliseconds                                 |
| startedAt      | When execution began                                               |
| completedAt    | When execution finished                                            |

---

## Dependencies

- Real authentication (005) — tasks are user-scoped and execute with user identity. The current hardcoded dev middleware provides a sufficient `req.user` for development.
- Agentic loop (`toolExecutor.ts`) — task execution reuses the existing agentic loop infrastructure.
- Thread/message system — task results are posted as messages in threads.
- OAuth token storage — scheduled tasks accessing Gmail, Calendar, etc. need the user's stored OAuth tokens.
- Approval workflow (008) — exists but is explicitly not integrated with scheduled tasks in this phase. Scheduled task tool calls execute without approval.

---

## Assumptions

- A Postgres-backed job queue (e.g. pg-boss) is the appropriate choice — no Redis or external queue infrastructure is needed since the project already uses Postgres.
- 50 execution history records per task provides sufficient visibility; older records can be pruned automatically.
- The browser's detected timezone is a reasonable default; users can override it during task creation.
- Scheduled tasks run sequentially per user (not in parallel) to avoid OAuth token contention and rate limiting on external APIs.
- Server downtime is expected to be brief (minutes, not days); the "run once on next interval" recovery strategy is appropriate for this use case.
- The maximum of 20 tasks per user is sufficient for personal productivity use cases and can be adjusted in a future phase.
