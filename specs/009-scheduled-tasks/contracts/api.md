# API Contracts: Scheduled / Recurring Tasks (009)

## New Endpoints

### GET /api/v1/scheduled-tasks

List all scheduled tasks for the authenticated user.

**Auth**: Bearer token (existing auth middleware)

**Query params**: none (no pagination needed — max 20 tasks per user)

**Response**: `200 OK`
```json
{
  "tasks": [
    {
      "id": "task_uuid",
      "name": "Morning email digest",
      "prompt": "Summarise my unread emails from the last 24 hours",
      "cronExpression": "0 9 * * 1-5",
      "timezone": "Europe/London",
      "model": "gpt-4o",
      "threadId": "thread_uuid",
      "enabled": true,
      "lastRunAt": "2026-09-08T09:00:12Z",
      "nextRunAt": "2026-09-09T09:00:00Z",
      "createdAt": "2026-09-01T14:30:00Z",
      "updatedAt": "2026-09-01T14:30:00Z"
    }
  ]
}
```

---

### POST /api/v1/scheduled-tasks

Create a new scheduled task.

**Auth**: Bearer token

**Request body**:
```json
{
  "name": "Morning email digest",
  "prompt": "Summarise my unread emails from the last 24 hours",
  "cronExpression": "0 9 * * 1-5",
  "timezone": "Europe/London",
  "model": "gpt-4o",
  "threadId": "thread_uuid"
}
```

| Field | Required | Constraints |
|-------|----------|-------------|
| `name` | Yes | 1–100 characters, unique per user |
| `prompt` | Yes | 1–2000 characters |
| `cronExpression` | Yes | Valid 5-field cron, minimum 5-minute interval |
| `timezone` | Yes | Valid IANA timezone |
| `model` | Yes | Must be a registered model in the provider registry |
| `threadId` | No | If omitted, a dedicated thread is created automatically |

**Response**: `201 Created`
```json
{
  "id": "task_uuid",
  "name": "Morning email digest",
  "prompt": "Summarise my unread emails from the last 24 hours",
  "cronExpression": "0 9 * * 1-5",
  "timezone": "Europe/London",
  "model": "gpt-4o",
  "threadId": "thread_uuid",
  "enabled": true,
  "lastRunAt": null,
  "nextRunAt": "2026-09-09T09:00:00Z",
  "createdAt": "2026-09-08T14:30:00Z",
  "updatedAt": "2026-09-08T14:30:00Z"
}
```

**Error responses**:

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_CRON` | Cron expression is invalid or cannot be parsed |
| 400 | `INTERVAL_TOO_SHORT` | Cron resolves to intervals shorter than 5 minutes |
| 400 | `INVALID_TIMEZONE` | Timezone is not a valid IANA timezone |
| 400 | `INVALID_MODEL` | Model is not registered in the provider registry |
| 400 | `VALIDATION_ERROR` | Missing or invalid fields |
| 409 | `DUPLICATE_NAME` | User already has a task with this name |
| 429 | `TASK_LIMIT_REACHED` | User has reached the 20-task maximum |

---

### GET /api/v1/scheduled-tasks/:id

Get a single scheduled task with recent execution history.

**Auth**: Bearer token

**Response**: `200 OK`
```json
{
  "id": "task_uuid",
  "name": "Morning email digest",
  "prompt": "Summarise my unread emails from the last 24 hours",
  "cronExpression": "0 9 * * 1-5",
  "timezone": "Europe/London",
  "model": "gpt-4o",
  "threadId": "thread_uuid",
  "enabled": true,
  "lastRunAt": "2026-09-08T09:00:12Z",
  "nextRunAt": "2026-09-09T09:00:00Z",
  "createdAt": "2026-09-01T14:30:00Z",
  "updatedAt": "2026-09-01T14:30:00Z",
  "executions": [
    {
      "id": "exec_uuid",
      "status": "success",
      "error": null,
      "durationMs": 12340,
      "startedAt": "2026-09-08T09:00:00Z",
      "completedAt": "2026-09-08T09:00:12Z",
      "messageId": "msg_uuid"
    }
  ]
}
```

**Error**:

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `TASK_NOT_FOUND` | Task not found or not owned by user |

---

### PATCH /api/v1/scheduled-tasks/:id

Update a scheduled task's configuration.

**Auth**: Bearer token

**Request body** (all fields optional):
```json
{
  "name": "Updated name",
  "prompt": "Updated prompt text",
  "cronExpression": "0 8 * * 1-5",
  "timezone": "America/New_York",
  "model": "gemini-1.5-pro",
  "enabled": false
}
```

**Response**: `200 OK` — returns the updated task (same shape as GET response, without `executions`)

**Error responses**:

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_CRON` | Cron expression is invalid |
| 400 | `INTERVAL_TOO_SHORT` | Cron resolves to intervals shorter than 5 minutes |
| 400 | `INVALID_TIMEZONE` | Invalid IANA timezone |
| 400 | `INVALID_MODEL` | Model not registered |
| 404 | `TASK_NOT_FOUND` | Not found or not owned by user |
| 409 | `DUPLICATE_NAME` | Another task by this user already has this name |

**Side effects**:
- If `cronExpression`, `timezone`, or `enabled` changes → reschedule with pg-boss
- If `enabled` set to `false` → unschedule from pg-boss, set `nextRunAt` to null
- If `enabled` set to `true` → schedule with pg-boss, compute and set `nextRunAt`

---

### DELETE /api/v1/scheduled-tasks/:id

Delete a scheduled task permanently.

**Auth**: Bearer token

**Response**: `200 OK`
```json
{
  "success": true
}
```

**Side effects**:
- Unschedule from pg-boss
- Delete all `TaskExecution` records (cascaded by DB)
- Thread containing past results is NOT deleted

**Error**:

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `TASK_NOT_FOUND` | Not found or not owned by user |

---

### GET /api/v1/scheduled-tasks/:id/executions

List execution history for a scheduled task.

**Auth**: Bearer token

**Query params**:

| Param | Default | Description |
|-------|---------|-------------|
| `limit` | 20 | Max records to return (max 50) |
| `cursor` | — | `startedAt` ISO string for cursor pagination |

**Response**: `200 OK`
```json
{
  "executions": [
    {
      "id": "exec_uuid",
      "status": "success",
      "error": null,
      "durationMs": 12340,
      "startedAt": "2026-09-08T09:00:00Z",
      "completedAt": "2026-09-08T09:00:12Z",
      "messageId": "msg_uuid"
    }
  ],
  "nextCursor": "2026-09-07T09:00:00Z"
}
```

**Error**:

| Status | Code | Condition |
|--------|------|-----------|
| 404 | `TASK_NOT_FOUND` | Task not found or not owned by user |

---

## TypeScript Interfaces

### Shared types (`shared/types/`)

```typescript
interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  model: string;
  threadId: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TaskExecution {
  id: string;
  taskId: string;
  messageId: string | null;
  status: 'success' | 'failed' | 'timeout' | 'skipped';
  error: string | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

interface CreateScheduledTaskRequest {
  name: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  model: string;
  threadId?: string;
}

interface UpdateScheduledTaskRequest {
  name?: string;
  prompt?: string;
  cronExpression?: string;
  timezone?: string;
  model?: string;
  enabled?: boolean;
}
```
