# Quickstart: Scheduled / Recurring Tasks (009)

## Prerequisites

- Docker Compose running (PostgreSQL + SearXNG)
- Backend `.env` configured (see `backend/.env.example`)
- At least one AI provider API key set

## Setup

```bash
# 1. Install new backend dependencies
cd backend
npm install pg-boss cron-parser

# 2. Install new frontend dependency
cd ../app
npm install cronstrue

# 3. Run database migration
cd ../backend
npx prisma migrate dev --name add-scheduled-tasks
npx prisma generate

# 4. Start services
cd ..
docker-compose up -d postgres searxng
cd backend && npm run dev &
cd ../app && npm start &
```

## Manual Testing

### Create a task via API

```bash
# Login first to get a token
TOKEN=$(curl -s http://localhost:5001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@test.com","password":"password"}' | jq -r '.accessToken')

# Create a scheduled task (runs every 5 minutes for testing)
curl -X POST http://localhost:5001/api/v1/scheduled-tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Test task",
    "prompt": "What is the current date and time?",
    "cronExpression": "*/5 * * * *",
    "timezone": "Europe/London",
    "model": "gpt-4o"
  }'
```

### List tasks

```bash
curl http://localhost:5001/api/v1/scheduled-tasks \
  -H "Authorization: Bearer $TOKEN"
```

### Toggle enable/disable

```bash
curl -X PATCH http://localhost:5001/api/v1/scheduled-tasks/<TASK_ID> \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"enabled": false}'
```

### View execution history

```bash
curl http://localhost:5001/api/v1/scheduled-tasks/<TASK_ID>/executions \
  -H "Authorization: Bearer $TOKEN"
```

### Delete a task

```bash
curl -X DELETE http://localhost:5001/api/v1/scheduled-tasks/<TASK_ID> \
  -H "Authorization: Bearer $TOKEN"
```

## Verify Execution

1. Create a task with `"cronExpression": "*/5 * * * *"` (every 5 minutes)
2. Watch the backend logs for `scheduled task execution started` and `scheduled task execution completed` messages
3. Check the auto-created thread for the AI's response
4. View execution history via the API or the frontend task detail panel

## Frontend Testing

1. Navigate to `http://localhost:3000`
2. Log in
3. Look for the "Scheduled Tasks" section in the sidebar (below Recents)
4. Click "+" to create a new task
5. Fill in: name, prompt, schedule (use preset "Every 5 minutes" for testing), model
6. Verify the task appears in the sidebar with next run time
7. Toggle enabled/disabled and verify the status updates
8. Wait for execution and check the linked thread for results
9. Open task details to view execution history

## Environment Variables

No new environment variables required. pg-boss uses the existing `DATABASE_URL`.

Optional:
- `SCHEDULED_TASK_TIMEOUT_MS` — override the 5-minute execution timeout (default: 300000)
- `SCHEDULED_TASK_MAX_PER_USER` — override the per-user task limit (default: 20)
