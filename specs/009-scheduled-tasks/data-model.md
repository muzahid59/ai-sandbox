# Data Model: Scheduled / Recurring Tasks (009)

## Entity Relationship Diagram

```
User 1──* ScheduledTask 1──* TaskExecution
                      1──1 Thread
```

Each `ScheduledTask` belongs to a `User` and has a designated `Thread` for output. Each `TaskExecution` belongs to a `ScheduledTask` and references the `Message` that was created in the thread.

---

## New Entities

### ScheduledTask

Represents a recurring automation that executes a prompt on a cron schedule.

| Field            | Type              | Constraints                       | Description                                                    |
|------------------|-------------------|-----------------------------------|----------------------------------------------------------------|
| `id`             | UUID              | PK, auto-generated                | Unique task identifier                                         |
| `userId`         | String            | FK → User.id, NOT NULL, Cascade   | Owning user                                                    |
| `name`           | String            | NOT NULL, max 100                 | Human-readable task name (e.g. "Morning email digest")         |
| `prompt`         | String            | NOT NULL, max 2000                | The instruction text the AI will execute                       |
| `cronExpression` | String            | NOT NULL, max 100                 | Standard 5-field cron expression                               |
| `timezone`       | String            | NOT NULL, max 50                  | IANA timezone string (e.g. "Europe/London")                    |
| `model`          | String            | NOT NULL, max 50                  | AI model identifier (e.g. "gpt-4o", "gemini-1.5-pro")         |
| `threadId`       | String            | FK → Thread.id, NOT NULL, SetNull | Thread where results are posted                                |
| `enabled`        | Boolean           | NOT NULL, default true            | Whether the task is active                                     |
| `running`        | Boolean           | NOT NULL, default false           | Whether the task is currently executing (overlap detection)    |
| `lastRunAt`      | DateTime?         | nullable                          | Timestamp of the most recent execution                         |
| `nextRunAt`      | DateTime?         | nullable                          | Computed next execution time (null when disabled)              |
| `createdAt`      | DateTime          | auto, NOT NULL                    | Creation timestamp                                             |
| `updatedAt`      | DateTime          | auto, NOT NULL                    | Last modification timestamp                                    |

**Indexes:**
- `@@index([userId])` — list tasks for a user
- `@@index([enabled, nextRunAt])` — startup recovery: find enabled tasks to schedule
- `@@unique([userId, name])` — prevent duplicate task names per user

**Cascade behavior:**
- User deleted → ScheduledTask deleted (DB-level cascade)
- Thread deleted → `threadId` set to null (SetNull) — task becomes orphaned but retains config

---

### TaskExecution

Records the outcome of a single scheduled task execution.

| Field          | Type              | Constraints                       | Description                                                    |
|----------------|-------------------|-----------------------------------|----------------------------------------------------------------|
| `id`           | UUID              | PK, auto-generated                | Unique execution identifier                                    |
| `taskId`       | String            | FK → ScheduledTask.id, NOT NULL, Cascade | The scheduled task this execution belongs to            |
| `messageId`    | String?           | nullable                          | Reference to the thread message containing the result          |
| `status`       | TaskExecutionStatus | NOT NULL                        | `success`, `failed`, `timeout`, `skipped`                      |
| `error`        | String?           | nullable, max 1000                | Error message if execution failed                              |
| `durationMs`   | Int?              | nullable                          | Execution duration in milliseconds                             |
| `startedAt`    | DateTime          | NOT NULL                          | When execution began                                           |
| `completedAt`  | DateTime?         | nullable                          | When execution finished                                        |

**Indexes:**
- `@@index([taskId, startedAt(sort: Desc)])` — list executions for a task, most recent first

**Cascade behavior:**
- ScheduledTask deleted → TaskExecution records deleted (DB-level cascade)

**Status enum values:** `success`, `failed`, `timeout`, `skipped`

**Pruning**: After each new execution record is created, delete records beyond the 50-record limit per task (ordered by `startedAt` ascending — oldest pruned first).

---

## New Enums

```prisma
enum TaskExecutionStatus {
  success
  failed
  timeout
  skipped
}
```

---

## Prisma Schema Addition

```prisma
enum TaskExecutionStatus {
  success
  failed
  timeout
  skipped
}

model ScheduledTask {
  id             String              @id @default(uuid())
  userId         String              @map("user_id")
  name           String              @db.VarChar(100)
  prompt         String              @db.VarChar(2000)
  cronExpression String              @map("cron_expression") @db.VarChar(100)
  timezone       String              @db.VarChar(50)
  model          String              @db.VarChar(50)
  threadId       String?             @map("thread_id")
  enabled        Boolean             @default(true)
  running        Boolean             @default(false)
  lastRunAt      DateTime?           @map("last_run_at")
  nextRunAt      DateTime?           @map("next_run_at")
  createdAt      DateTime            @default(now()) @map("created_at")
  updatedAt      DateTime            @updatedAt @map("updated_at")
  user           User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  thread         Thread?             @relation(fields: [threadId], references: [id], onDelete: SetNull)
  executions     TaskExecution[]

  @@unique([userId, name])
  @@index([userId])
  @@index([enabled, nextRunAt])
  @@map("scheduled_tasks")
}

model TaskExecution {
  id          String              @id @default(uuid())
  taskId      String              @map("task_id")
  messageId   String?             @map("message_id")
  status      TaskExecutionStatus
  error       String?             @db.VarChar(1000)
  durationMs  Int?                @map("duration_ms")
  startedAt   DateTime            @map("started_at")
  completedAt DateTime?           @map("completed_at")
  task        ScheduledTask       @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId, startedAt(sort: Desc)])
  @@map("task_executions")
}
```

Add relations to existing models:

```prisma
// In User model, add:
scheduledTasks  ScheduledTask[]

// In Thread model, add:
scheduledTask   ScheduledTask?
```

---

## Migration Notes

1. Create the `TaskExecutionStatus` enum.
2. Create the `scheduled_tasks` table with all indexes and the unique constraint.
3. Create the `task_executions` table with its index.
4. Add FK relations to `users` and `threads` tables.
5. No data backfill required — new tables start empty.

Run:
```bash
cd backend
npx prisma migrate dev --name add-scheduled-tasks
npx prisma generate
```
