# Chat Thread Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add thread-based chat persistence to the backend — threads, messages, streaming with history, context window management — while keeping existing API routes intact.

**Architecture:** New `/api/v1/threads` REST API alongside existing routes. PostgreSQL via Prisma for thread/message persistence. In-memory context cache (no Redis). Hardcoded user for auth. Existing AI services reused unchanged. POST /threads/:id/messages returns SSE directly (combined endpoint).

**Tech Stack:** Express + TypeScript, PostgreSQL 16, Prisma ORM, Jest + ts-jest + supertest

---

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | Express + TypeScript | Keep Express, add TS. `allowJs: true` for existing JS |
| Database | PostgreSQL + Prisma | As per TDD. Docker service for local dev |
| Redis | Skip (in-memory cache) | Single-node dev; Map with TTL suffices |
| Auth | Hardcoded user middleware | No login flow; lightweight for dev |
| AI providers | Keep existing (OpenAI, Google, DeepSeek, Llama) | No new providers |
| Async workers | Skip (inline title gen) | No BullMQ; use first user message as title |
| Streaming | Combined POST+SSE endpoint | Simpler than separate POST + GET /stream |
| Validation | Manual checks | No Zod for now |

---

## File Structure

### New Files
```
backend/
├── tsconfig.json
├── jest.config.ts
├── prisma/
│   └── schema.prisma
├── src/
│   ├── server.ts                          # New entry point
│   ├── config/
│   │   └── database.ts                    # Prisma client singleton
│   ├── types/
│   │   └── index.ts                       # Shared types + Express augmentation
│   ├── middleware/
│   │   └── auth.ts                        # Hardcoded user injection
│   ├── services/
│   │   ├── threadService.ts               # Thread CRUD
│   │   ├── messageService.ts              # Message CRUD + pagination
│   │   └── contextService.ts              # In-memory cache + context window
│   ├── controllers/
│   │   ├── threadController.ts            # Thread request handlers
│   │   └── messageController.ts           # Message + SSE streaming handlers
│   └── routes/
│       ├── index.ts                       # /api/v1 router mount
│       ├── threadRoutes.ts                # Thread REST routes
│       └── messageRoutes.ts               # Message REST routes
└── tests/
    ├── middleware/
    │   └── auth.test.ts
    ├── services/
    │   ├── threadService.test.ts
    │   ├── messageService.test.ts
    │   └── contextService.test.ts
    └── controllers/
        ├── threadController.test.ts
        └── messageController.test.ts
```

### Modified Files
- `backend/package.json` — dependencies + scripts
- `docker-compose.yml` — add PostgreSQL service
- `backend/.env` — add `DATABASE_URL`

### Unchanged
- All existing JS files (`controllers/`, `routes/`, `services/`) — imported via `allowJs`

---

## Task 1: TypeScript + Build Infrastructure

**Files:**
- Create: `backend/tsconfig.json`
- Create: `backend/src/server.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Install TypeScript dependencies**

```bash
cd backend
npm install typescript ts-node @types/node @types/express @types/cors --save-dev
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "strict": false,
    "esModuleInterop": true,
    "allowJs": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create src/server.ts — new entry point**

This imports legacy routes from `../routes` (existing JS) and will mount new API routes alongside them.

```typescript
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

// Legacy routes (existing JS — kept working via allowJs)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const legacyRoutes = require('../routes');

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Legacy routes at root (backward compatible)
app.use(legacyRoutes);

app.get('/', (_req, res) => {
  res.send('Hi there! This is the AI sandbox server');
});

// New /api/v1 routes will be added in later tasks

export { app };

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
  });
}
```

- [ ] **Step 4: Update package.json scripts**

Add these scripts (keep existing `"start"` as `"start:legacy"`):

```json
{
  "scripts": {
    "start": "ts-node src/server.ts",
    "start:legacy": "node index.js",
    "build": "tsc",
    "test": "jest --forceExit --detectOpenHandles"
  }
}
```

- [ ] **Step 5: Verify the server starts**

```bash
cd backend && npm start
```

Expected: `Server running at http://localhost:5001/`
Verify legacy endpoint still works: `curl -X POST http://localhost:5001/content-completion -H "Content-Type: application/json" -d '{"text":"hi","model":"lama"}'`

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json src/server.ts package.json package-lock.json
git commit -m "feat: add TypeScript infrastructure with new entry point"
```

---

## Task 2: Testing Infrastructure

**Files:**
- Create: `backend/jest.config.ts`
- Create: `backend/tests/smoke.test.ts`

- [ ] **Step 1: Install test dependencies**

```bash
cd backend
npm install jest ts-jest @types/jest supertest @types/supertest --save-dev
```

- [ ] **Step 2: Create jest.config.ts**

```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  clearMocks: true,
};

export default config;
```

- [ ] **Step 3: Write smoke test**

```typescript
// tests/smoke.test.ts
import request from 'supertest';
import { app } from '../src/server';

describe('Server', () => {
  it('responds to GET /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('AI sandbox server');
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npm test
```

Expected: 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add jest.config.ts tests/smoke.test.ts package.json package-lock.json
git commit -m "feat: add Jest testing infrastructure with smoke test"
```

---

## Task 3: PostgreSQL + Prisma Schema

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/config/database.ts`
- Modify: `docker-compose.yml`
- Modify: `backend/.env`

- [ ] **Step 1: Install Prisma**

```bash
cd backend
npm install prisma --save-dev
npm install @prisma/client
```

- [ ] **Step 2: Add PostgreSQL to docker-compose.yml**

Add this service to the root `docker-compose.yml`:

```yaml
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: ai_sandbox
      POSTGRES_PASSWORD: ai_sandbox_dev
      POSTGRES_DB: ai_sandbox
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Also update the `backend` service to add `depends_on: [postgres]`.

- [ ] **Step 3: Add DATABASE_URL to backend/.env**

```
DATABASE_URL="postgresql://ai_sandbox:ai_sandbox_dev@localhost:5432/ai_sandbox?schema=public"
```

- [ ] **Step 4: Create prisma/schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ThreadStatus {
  active
  archived
  deleted
}

enum MessageRole {
  user
  assistant
  system
  tool
}

enum MessageStatus {
  pending
  streaming
  complete
  error
}

model Thread {
  id           String       @id @default(uuid())
  userId       String       @map("user_id")
  title        String?
  model        String
  systemPrompt String?      @map("system_prompt")
  tokenCount   Int          @default(0) @map("token_count")
  status       ThreadStatus @default(active)
  metadata     Json?
  createdAt    DateTime     @default(now()) @map("created_at")
  updatedAt    DateTime     @updatedAt @map("updated_at")
  messages     Message[]

  @@index([userId])
  @@index([createdAt(sort: Desc)])
  @@map("threads")
}

model Message {
  id            String        @id @default(uuid())
  threadId      String        @map("thread_id")
  role          MessageRole
  content       Json
  status        MessageStatus @default(pending)
  inputTokens   Int?          @map("input_tokens")
  outputTokens  Int?          @map("output_tokens")
  modelSnapshot String?       @map("model_snapshot")
  stopReason    String?       @map("stop_reason")
  createdAt     DateTime      @default(now()) @map("created_at")
  completedAt   DateTime?     @map("completed_at")
  thread        Thread        @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt(sort: Desc)])
  @@map("messages")
}
```

- [ ] **Step 5: Start PostgreSQL and run migration**

```bash
docker-compose up -d postgres
cd backend
npx prisma migrate dev --name init
```

Expected: Migration created, Prisma Client generated.

- [ ] **Step 6: Create src/config/database.ts**

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;
```

- [ ] **Step 7: Verify Prisma connects**

```bash
cd backend && npx prisma studio
```

Expected: Prisma Studio opens showing `threads` and `messages` tables.

- [ ] **Step 8: Commit**

```bash
git add prisma/ src/config/database.ts docker-compose.yml package.json package-lock.json
git commit -m "feat: add PostgreSQL + Prisma schema for threads and messages"
```

---

## Task 4: Types + Auth Middleware

**Files:**
- Create: `backend/src/types/index.ts`
- Create: `backend/src/middleware/auth.ts`
- Create: `backend/tests/middleware/auth.test.ts`

- [ ] **Step 1: Create shared types**

```typescript
// src/types/index.ts

export interface ContentBlock {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result';
  text?: string;
  url?: string;
  mime?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

// Augment Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
```

- [ ] **Step 2: Write auth middleware test**

```typescript
// tests/middleware/auth.test.ts
import request from 'supertest';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth';

const app = express();
app.use(authMiddleware);
app.get('/test', (req, res) => {
  res.json({ user: req.user });
});

describe('authMiddleware', () => {
  it('injects a hardcoded user into req.user', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'dev@localhost',
    });
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

```bash
cd backend && npm test -- tests/middleware/auth.test.ts
```

Expected: FAIL — `Cannot find module '../../src/middleware/auth'`

- [ ] **Step 4: Implement auth middleware**

```typescript
// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import '../types';

// TODO: Replace with real JWT auth (access + refresh tokens, per TDD section 07)
const HARDCODED_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'dev@localhost',
};

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.user = HARDCODED_USER;
  next();
}
```

- [ ] **Step 5: Run test — verify it passes**

```bash
cd backend && npm test -- tests/middleware/auth.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/middleware/auth.ts tests/middleware/auth.test.ts
git commit -m "feat: add shared types and hardcoded auth middleware"
```

---

## Task 5: Thread Service + API

**Files:**
- Create: `backend/src/services/threadService.ts`
- Create: `backend/tests/services/threadService.test.ts`
- Create: `backend/src/controllers/threadController.ts`
- Create: `backend/src/routes/threadRoutes.ts`
- Create: `backend/tests/controllers/threadController.test.ts`
- Modify: `backend/src/server.ts`

### Part A: Thread Service

- [ ] **Step 1: Write thread service tests**

```typescript
// tests/services/threadService.test.ts
const mockPrisma = {
  thread: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import {
  createThread,
  listThreads,
  getThreadById,
  updateThread,
  softDeleteThread,
} from '../../src/services/threadService';

describe('threadService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createThread', () => {
    it('creates a thread with userId and model', async () => {
      const thread = { id: 'tid-1', userId: 'uid-1', model: 'lama', title: null };
      mockPrisma.thread.create.mockResolvedValue(thread);

      const result = await createThread('uid-1', { model: 'lama' });

      expect(mockPrisma.thread.create).toHaveBeenCalledWith({
        data: {
          userId: 'uid-1',
          model: 'lama',
          title: undefined,
          systemPrompt: undefined,
        },
      });
      expect(result).toEqual(thread);
    });
  });

  describe('listThreads', () => {
    it('lists non-deleted threads for a user, newest first', async () => {
      const threads = [{ id: 'tid-2' }, { id: 'tid-1' }];
      mockPrisma.thread.findMany.mockResolvedValue(threads);

      const result = await listThreads('uid-1');

      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'uid-1', status: { not: 'deleted' } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      );
      expect(result).toEqual(threads);
    });

    it('supports cursor-based pagination', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);

      await listThreads('uid-1', 'cursor-id', 10);

      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'cursor-id' },
          skip: 1,
          take: 10,
        }),
      );
    });
  });

  describe('getThreadById', () => {
    it('returns thread if owned by user', async () => {
      const thread = { id: 'tid-1', userId: 'uid-1' };
      mockPrisma.thread.findFirst.mockResolvedValue(thread);

      const result = await getThreadById('tid-1', 'uid-1');

      expect(mockPrisma.thread.findFirst).toHaveBeenCalledWith({
        where: { id: 'tid-1', userId: 'uid-1' },
      });
      expect(result).toEqual(thread);
    });

    it('returns null if not owned', async () => {
      mockPrisma.thread.findFirst.mockResolvedValue(null);
      const result = await getThreadById('tid-1', 'other-user');
      expect(result).toBeNull();
    });
  });

  describe('updateThread', () => {
    it('updates title if thread exists and is owned', async () => {
      mockPrisma.thread.findFirst.mockResolvedValue({ id: 'tid-1', userId: 'uid-1' });
      mockPrisma.thread.update.mockResolvedValue({ id: 'tid-1', title: 'New Title' });

      const result = await updateThread('tid-1', 'uid-1', { title: 'New Title' });

      expect(mockPrisma.thread.update).toHaveBeenCalledWith({
        where: { id: 'tid-1' },
        data: { title: 'New Title' },
      });
      expect(result.title).toBe('New Title');
    });

    it('throws if thread not found', async () => {
      mockPrisma.thread.findFirst.mockResolvedValue(null);
      await expect(updateThread('tid-1', 'uid-1', { title: 'x' })).rejects.toThrow(
        'Thread not found',
      );
    });
  });

  describe('softDeleteThread', () => {
    it('sets status to deleted', async () => {
      mockPrisma.thread.findFirst.mockResolvedValue({ id: 'tid-1', userId: 'uid-1' });
      mockPrisma.thread.update.mockResolvedValue({ id: 'tid-1', status: 'deleted' });

      await softDeleteThread('tid-1', 'uid-1');

      expect(mockPrisma.thread.update).toHaveBeenCalledWith({
        where: { id: 'tid-1' },
        data: { status: 'deleted' },
      });
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npm test -- tests/services/threadService.test.ts
```

Expected: FAIL — cannot find module `threadService`

- [ ] **Step 3: Implement thread service**

```typescript
// src/services/threadService.ts
import prisma from '../config/database';
import { Thread } from '@prisma/client';

export async function createThread(
  userId: string,
  data: { model: string; title?: string; systemPrompt?: string },
): Promise<Thread> {
  return prisma.thread.create({
    data: {
      userId,
      model: data.model,
      title: data.title,
      systemPrompt: data.systemPrompt,
    },
  });
}

export async function listThreads(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<Thread[]> {
  return prisma.thread.findMany({
    where: { userId, status: { not: 'deleted' } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
}

export async function getThreadById(
  threadId: string,
  userId: string,
): Promise<Thread | null> {
  return prisma.thread.findFirst({
    where: { id: threadId, userId },
  });
}

export async function updateThread(
  threadId: string,
  userId: string,
  data: { title?: string; status?: string; systemPrompt?: string },
): Promise<Thread> {
  const thread = await getThreadById(threadId, userId);
  if (!thread) throw new Error('Thread not found');

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.systemPrompt !== undefined) updateData.systemPrompt = data.systemPrompt;

  return prisma.thread.update({
    where: { id: threadId },
    data: updateData,
  });
}

export async function softDeleteThread(
  threadId: string,
  userId: string,
): Promise<Thread> {
  return updateThread(threadId, userId, { status: 'deleted' });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npm test -- tests/services/threadService.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/threadService.ts tests/services/threadService.test.ts
git commit -m "feat: add thread service with CRUD operations"
```

### Part B: Thread Controller + Routes

- [ ] **Step 6: Write thread controller tests**

```typescript
// tests/controllers/threadController.test.ts
const mockThreadService = {
  createThread: jest.fn(),
  listThreads: jest.fn(),
  getThreadById: jest.fn(),
  updateThread: jest.fn(),
  softDeleteThread: jest.fn(),
};

jest.mock('../../src/services/threadService', () => mockThreadService);

const mockMessageService = {
  getByThread: jest.fn(),
};

jest.mock('../../src/services/messageService', () => mockMessageService);

import request from 'supertest';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth';
import { threadRoutes } from '../../src/routes/threadRoutes';

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/v1', threadRoutes);

const USER_ID = '00000000-0000-0000-0000-000000000001';

describe('Thread API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/v1/threads', () => {
    it('creates a thread and returns 201', async () => {
      const thread = { id: 'tid-1', userId: USER_ID, model: 'lama', title: null };
      mockThreadService.createThread.mockResolvedValue(thread);

      const res = await request(app)
        .post('/api/v1/threads')
        .send({ model: 'lama' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(thread);
      expect(mockThreadService.createThread).toHaveBeenCalledWith(USER_ID, {
        model: 'lama',
        title: undefined,
        systemPrompt: undefined,
      });
    });

    it('returns 400 if model is missing', async () => {
      const res = await request(app).post('/api/v1/threads').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/threads', () => {
    it('lists threads for the authenticated user', async () => {
      const threads = [{ id: 'tid-1', title: 'Chat 1' }];
      mockThreadService.listThreads.mockResolvedValue(threads);

      const res = await request(app).get('/api/v1/threads');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(threads);
    });

    it('passes cursor and limit params', async () => {
      mockThreadService.listThreads.mockResolvedValue([]);

      await request(app).get('/api/v1/threads?cursor=tid-1&limit=5');

      expect(mockThreadService.listThreads).toHaveBeenCalledWith(USER_ID, 'tid-1', 5);
    });
  });

  describe('GET /api/v1/threads/:id', () => {
    it('returns thread with last 50 messages', async () => {
      const thread = { id: 'tid-1', userId: USER_ID };
      mockThreadService.getThreadById.mockResolvedValue(thread);
      mockMessageService.getByThread.mockResolvedValue([]);

      const res = await request(app).get('/api/v1/threads/tid-1');

      expect(res.status).toBe(200);
      expect(res.body.thread).toEqual(thread);
      expect(res.body.messages).toEqual([]);
    });

    it('returns 404 if thread not found', async () => {
      mockThreadService.getThreadById.mockResolvedValue(null);

      const res = await request(app).get('/api/v1/threads/bad-id');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/threads/:id', () => {
    it('updates thread metadata', async () => {
      const updated = { id: 'tid-1', title: 'Renamed' };
      mockThreadService.updateThread.mockResolvedValue(updated);

      const res = await request(app)
        .patch('/api/v1/threads/tid-1')
        .send({ title: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Renamed');
    });
  });

  describe('DELETE /api/v1/threads/:id', () => {
    it('soft-deletes and returns 200', async () => {
      const deleted = { id: 'tid-1', status: 'deleted' };
      mockThreadService.softDeleteThread.mockResolvedValue(deleted);

      const res = await request(app).delete('/api/v1/threads/tid-1');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('deleted');
    });
  });
});
```

- [ ] **Step 7: Create thread routes**

```typescript
// src/routes/threadRoutes.ts
import { Router } from 'express';
import {
  handleCreateThread,
  handleListThreads,
  handleGetThread,
  handleUpdateThread,
  handleDeleteThread,
} from '../controllers/threadController';

const router = Router();

router.post('/threads', handleCreateThread);
router.get('/threads', handleListThreads);
router.get('/threads/:id', handleGetThread);
router.patch('/threads/:id', handleUpdateThread);
router.delete('/threads/:id', handleDeleteThread);

export { router as threadRoutes };
```

- [ ] **Step 8: Implement thread controller**

```typescript
// src/controllers/threadController.ts
import { Request, Response } from 'express';
import {
  createThread,
  listThreads,
  getThreadById,
  updateThread,
  softDeleteThread,
} from '../services/threadService';
import { getByThread } from '../services/messageService';

export async function handleCreateThread(req: Request, res: Response) {
  const { model, title, system_prompt } = req.body;
  if (!model) {
    return res.status(400).json({ error: 'model is required' });
  }

  const thread = await createThread(req.user!.id, {
    model,
    title,
    systemPrompt: system_prompt,
  });
  return res.status(201).json(thread);
}

export async function handleListThreads(req: Request, res: Response) {
  const cursor = req.query.cursor as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const threads = await listThreads(req.user!.id, cursor, limit);
  return res.json(threads);
}

export async function handleGetThread(req: Request, res: Response) {
  const thread = await getThreadById(req.params.id, req.user!.id);
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const messages = await getByThread(thread.id);
  return res.json({ thread, messages });
}

export async function handleUpdateThread(req: Request, res: Response) {
  try {
    const { title, status, system_prompt } = req.body;
    const thread = await updateThread(req.params.id, req.user!.id, {
      title,
      status,
      systemPrompt: system_prompt,
    });
    return res.json(thread);
  } catch (err: any) {
    if (err.message === 'Thread not found') {
      return res.status(404).json({ error: err.message });
    }
    throw err;
  }
}

export async function handleDeleteThread(req: Request, res: Response) {
  try {
    const thread = await softDeleteThread(req.params.id, req.user!.id);
    return res.json(thread);
  } catch (err: any) {
    if (err.message === 'Thread not found') {
      return res.status(404).json({ error: err.message });
    }
    throw err;
  }
}
```

- [ ] **Step 9: Mount routes in server.ts**

Add to `src/server.ts`, after legacy routes:

```typescript
import { authMiddleware } from './middleware/auth';
import { threadRoutes } from './routes/threadRoutes';

// New API v1 routes (with auth)
app.use('/api/v1', authMiddleware);
app.use('/api/v1', threadRoutes);
```

- [ ] **Step 10: Run controller tests**

```bash
cd backend && npm test -- tests/controllers/threadController.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/controllers/threadController.ts src/routes/threadRoutes.ts tests/controllers/threadController.test.ts src/server.ts
git commit -m "feat: add thread REST API (CRUD + routes)"
```

---

## Task 6: Message Service

**Files:**
- Create: `backend/src/services/messageService.ts`
- Create: `backend/tests/services/messageService.test.ts`

- [ ] **Step 1: Write message service tests**

```typescript
// tests/services/messageService.test.ts
const mockPrisma = {
  message: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  thread: {
    update: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import {
  createMessage,
  getByThread,
  updateMessageStatus,
  countByThread,
  incrementThreadTokens,
} from '../../src/services/messageService';

describe('messageService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createMessage', () => {
    it('creates a message with content blocks', async () => {
      const msg = {
        id: 'mid-1',
        threadId: 'tid-1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        status: 'complete',
      };
      mockPrisma.message.create.mockResolvedValue(msg);

      const result = await createMessage({
        threadId: 'tid-1',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        status: 'complete',
      });

      expect(result).toEqual(msg);
      expect(mockPrisma.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          threadId: 'tid-1',
          role: 'user',
          status: 'complete',
        }),
      });
    });
  });

  describe('getByThread', () => {
    it('returns messages in chronological order', async () => {
      const msgs = [{ id: 'mid-2', createdAt: '2' }, { id: 'mid-1', createdAt: '1' }];
      mockPrisma.message.findMany.mockResolvedValue(msgs);

      const result = await getByThread('tid-1');

      // findMany returns DESC, getByThread reverses to chronological
      expect(result).toEqual([{ id: 'mid-1', createdAt: '1' }, { id: 'mid-2', createdAt: '2' }]);
    });

    it('supports cursor pagination', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);

      await getByThread('tid-1', 'mid-5', 10);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'mid-5' },
          skip: 1,
          take: 10,
        }),
      );
    });
  });

  describe('updateMessageStatus', () => {
    it('sets status and completedAt on complete', async () => {
      mockPrisma.message.update.mockResolvedValue({ id: 'mid-1', status: 'complete' });

      await updateMessageStatus('mid-1', 'complete', {
        content: [{ type: 'text', text: 'Response' }],
        stopReason: 'end_turn',
      });

      const call = mockPrisma.message.update.mock.calls[0][0];
      expect(call.data.status).toBe('complete');
      expect(call.data.completedAt).toBeDefined();
      expect(call.data.stopReason).toBe('end_turn');
    });
  });

  describe('incrementThreadTokens', () => {
    it('increments token_count atomically', async () => {
      mockPrisma.thread.update.mockResolvedValue({});

      await incrementThreadTokens('tid-1', 500);

      expect(mockPrisma.thread.update).toHaveBeenCalledWith({
        where: { id: 'tid-1' },
        data: { tokenCount: { increment: 500 } },
      });
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npm test -- tests/services/messageService.test.ts
```

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement message service**

```typescript
// src/services/messageService.ts
import prisma from '../config/database';
import { Message, MessageStatus } from '@prisma/client';
import { ContentBlock } from '../types';

export async function createMessage(data: {
  id?: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ContentBlock[];
  status?: 'pending' | 'streaming' | 'complete' | 'error';
  modelSnapshot?: string;
}): Promise<Message> {
  return prisma.message.create({
    data: {
      ...(data.id && { id: data.id }),
      threadId: data.threadId,
      role: data.role,
      content: data.content as any,
      status: data.status ?? 'pending',
      modelSnapshot: data.modelSnapshot,
    },
  });
}

export async function getByThread(
  threadId: string,
  beforeId?: string,
  limit = 50,
): Promise<Message[]> {
  const messages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(beforeId && { cursor: { id: beforeId }, skip: 1 }),
  });
  return messages.reverse(); // Return chronological order
}

export async function updateMessageStatus(
  messageId: string,
  status: 'pending' | 'streaming' | 'complete' | 'error',
  data?: {
    content?: ContentBlock[];
    inputTokens?: number;
    outputTokens?: number;
    stopReason?: string;
  },
): Promise<Message> {
  return prisma.message.update({
    where: { id: messageId },
    data: {
      status,
      ...(data?.content && { content: data.content as any }),
      ...(data?.inputTokens !== undefined && { inputTokens: data.inputTokens }),
      ...(data?.outputTokens !== undefined && { outputTokens: data.outputTokens }),
      ...(data?.stopReason && { stopReason: data.stopReason }),
      ...(status === 'complete' && { completedAt: new Date() }),
    },
  });
}

export async function countByThread(threadId: string): Promise<number> {
  return prisma.message.count({ where: { threadId } });
}

export async function incrementThreadTokens(
  threadId: string,
  delta: number,
): Promise<void> {
  await prisma.thread.update({
    where: { id: threadId },
    data: { tokenCount: { increment: delta } },
  });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npm test -- tests/services/messageService.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/messageService.ts tests/services/messageService.test.ts
git commit -m "feat: add message service with CRUD and pagination"
```

---

## Task 7: Context Window Service

**Files:**
- Create: `backend/src/services/contextService.ts`
- Create: `backend/tests/services/contextService.test.ts`

- [ ] **Step 1: Write context service tests**

```typescript
// tests/services/contextService.test.ts
const mockPrisma = {
  message: {
    findMany: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import { ContextService } from '../../src/services/contextService';

describe('ContextService', () => {
  let ctx: ContextService;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = new ContextService();
  });

  describe('buildContextWindow', () => {
    it('returns messages formatted as prompt string', async () => {
      mockPrisma.message.findMany.mockResolvedValue([
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }], createdAt: new Date('2026-01-02') },
        { role: 'user', content: [{ type: 'text', text: 'Hello' }], createdAt: new Date('2026-01-01') },
      ]);

      const result = await ctx.buildContextWindow('tid-1');

      // Reversed to chronological, formatted as role: content
      expect(result).toContain('user: Hello');
      expect(result).toContain('assistant: Hi!');
      expect(result.indexOf('user: Hello')).toBeLessThan(result.indexOf('assistant: Hi!'));
    });

    it('returns empty string for empty thread', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);

      const result = await ctx.buildContextWindow('tid-1');
      expect(result).toBe('');
    });

    it('serves from cache on second call within TTL', async () => {
      mockPrisma.message.findMany.mockResolvedValue([
        { role: 'user', content: [{ type: 'text', text: 'Hello' }], createdAt: new Date() },
      ]);

      await ctx.buildContextWindow('tid-1');
      await ctx.buildContextWindow('tid-1');

      // DB queried only once — second call served from cache
      expect(mockPrisma.message.findMany).toHaveBeenCalledTimes(1);
    });

    it('cache is invalidated by invalidate()', async () => {
      mockPrisma.message.findMany.mockResolvedValue([
        { role: 'user', content: [{ type: 'text', text: 'Hello' }], createdAt: new Date() },
      ]);

      await ctx.buildContextWindow('tid-1');
      ctx.invalidate('tid-1');
      await ctx.buildContextWindow('tid-1');

      expect(mockPrisma.message.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      expect(ctx.estimateTokens('Hello world! This is a test.')).toBe(7);
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npm test -- tests/services/contextService.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement context service**

```typescript
// src/services/contextService.ts
import prisma from '../config/database';

interface CacheEntry {
  prompt: string;
  timestamp: number;
}

export class ContextService {
  private cache = new Map<string, CacheEntry>();
  private ttlMs = 10 * 60 * 1000; // 10 minutes

  async buildContextWindow(threadId: string, maxTokens = 100_000): Promise<string> {
    // Check cache
    const cached = this.cache.get(threadId);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.prompt;
    }

    // Fetch from DB (newest first)
    const messages = await prisma.message.findMany({
      where: { threadId, status: 'complete' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (messages.length === 0) return '';

    // Reverse to chronological order
    const chronological = messages.reverse();

    // Token budget: walk from newest, keep what fits
    const reserveForCompletion = 4096;
    let budget = maxTokens - reserveForCompletion;
    const window: typeof chronological = [];

    for (const msg of [...chronological].reverse()) {
      const text = this.extractText(msg.content as any[]);
      const tokens = this.estimateTokens(text);
      if (budget - tokens < 0) break;
      window.unshift(msg);
      budget -= tokens;
    }

    // Safety floor: always include at least the last 4 messages
    const minMessages = chronological.slice(-4);
    const merged = this.dedupeById([...window, ...minMessages]);

    // Format as prompt string
    const prompt = merged
      .map((m) => `${m.role}: ${this.extractText(m.content as any[])}`)
      .join('\n\n');

    // Cache
    this.cache.set(threadId, { prompt, timestamp: Date.now() });

    return prompt;
  }

  invalidate(threadId: string) {
    this.cache.delete(threadId);
  }

  estimateTokens(text: string): number {
    // ~4 chars per token (rough estimate)
    // TODO: Use tiktoken for accurate counting
    return Math.ceil(text.length / 4);
  }

  private extractText(content: any[]): string {
    if (!Array.isArray(content)) return String(content);
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ');
  }

  private dedupeById(messages: any[]): any[] {
    const seen = new Set<string>();
    return messages.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }
}

// Singleton instance
// TODO: Replace with Redis-backed cache for horizontal scaling
export const contextService = new ContextService();
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npm test -- tests/services/contextService.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/contextService.ts tests/services/contextService.test.ts
git commit -m "feat: add context window service with in-memory cache"
```

---

## Task 8: Message API + Streaming

**Files:**
- Create: `backend/src/controllers/messageController.ts`
- Create: `backend/src/routes/messageRoutes.ts`
- Create: `backend/tests/controllers/messageController.test.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Write message controller tests**

```typescript
// tests/controllers/messageController.test.ts
const mockThreadService = {
  getThreadById: jest.fn(),
};

const mockMessageService = {
  createMessage: jest.fn(),
  getByThread: jest.fn(),
  updateMessageStatus: jest.fn(),
  countByThread: jest.fn(),
  incrementThreadTokens: jest.fn(),
};

const mockContextService = {
  buildContextWindow: jest.fn(),
  invalidate: jest.fn(),
};

const mockAIFactory = {
  getAIService: jest.fn(),
};

jest.mock('../../src/services/threadService', () => mockThreadService);
jest.mock('../../src/services/messageService', () => mockMessageService);
jest.mock('../../src/services/contextService', () => ({
  contextService: mockContextService,
  ContextService: jest.fn(),
}));
jest.mock('../../services/ai_factory', () => mockAIFactory);

// Mock prisma for title update
const mockPrisma = {
  thread: { update: jest.fn() },
};
jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import request from 'supertest';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth';
import { messageRoutes } from '../../src/routes/messageRoutes';

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/v1', messageRoutes);

const USER_ID = '00000000-0000-0000-0000-000000000001';

describe('Message API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /api/v1/threads/:id/messages', () => {
    it('returns paginated messages', async () => {
      mockThreadService.getThreadById.mockResolvedValue({ id: 'tid-1', userId: USER_ID });
      const msgs = [{ id: 'mid-1', role: 'user', content: [{ type: 'text', text: 'Hi' }] }];
      mockMessageService.getByThread.mockResolvedValue(msgs);

      const res = await request(app).get('/api/v1/threads/tid-1/messages');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(msgs);
    });

    it('returns 404 for unknown thread', async () => {
      mockThreadService.getThreadById.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/threads/bad/messages');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/threads/:id/messages', () => {
    it('returns 404 if thread not found', async () => {
      mockThreadService.getThreadById.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/threads/bad/messages')
        .send({ content: [{ type: 'text', text: 'Hi' }] });

      expect(res.status).toBe(404);
    });

    it('returns 400 if content is missing', async () => {
      mockThreadService.getThreadById.mockResolvedValue({ id: 'tid-1', userId: USER_ID });

      const res = await request(app)
        .post('/api/v1/threads/tid-1/messages')
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Create message routes**

```typescript
// src/routes/messageRoutes.ts
import { Router } from 'express';
import {
  handleSendMessage,
  handleGetMessages,
} from '../controllers/messageController';

const router = Router();

router.post('/threads/:id/messages', handleSendMessage);
router.get('/threads/:id/messages', handleGetMessages);

export { router as messageRoutes };
```

- [ ] **Step 3: Implement message controller**

This is the core streaming integration. It handles both streaming AI services (Llama, DeepSeek) and non-streaming ones (OpenAI, Google).

```typescript
// src/controllers/messageController.ts
import { Request, Response } from 'express';
import { getThreadById } from '../services/threadService';
import {
  createMessage,
  getByThread,
  updateMessageStatus,
  countByThread,
  incrementThreadTokens,
} from '../services/messageService';
import { contextService } from '../services/contextService';
import { ContentBlock } from '../types';

// Import legacy AI factory (JS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getAIService } = require('../../services/ai_factory');

function isReadableStream(obj: any): boolean {
  return obj && typeof obj.on === 'function';
}

export async function handleGetMessages(req: Request, res: Response) {
  const thread = await getThreadById(req.params.id, req.user!.id);
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const beforeId = req.query.before_id as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;

  const messages = await getByThread(thread.id, beforeId, limit);
  return res.json(messages);
}

export async function handleSendMessage(req: Request, res: Response) {
  const thread = await getThreadById(req.params.id, req.user!.id);
  if (!thread) {
    return res.status(404).json({ error: 'Thread not found' });
  }

  const { content } = req.body as { content?: ContentBlock[] };
  if (!content || !Array.isArray(content) || content.length === 0) {
    return res.status(400).json({ error: 'content is required and must be a non-empty array' });
  }

  // 1. Persist user message
  const userMessage = await createMessage({
    threadId: thread.id,
    role: 'user',
    content,
    status: 'complete',
  });

  // 2. Create assistant placeholder
  const assistantMessage = await createMessage({
    threadId: thread.id,
    role: 'assistant',
    content: [],
    status: 'streaming',
    modelSnapshot: thread.model,
  });

  // 3. Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial event with message IDs
  res.write(
    `data: ${JSON.stringify({
      type: 'message_created',
      user_msg_id: userMessage.id,
      assistant_msg_id: assistantMessage.id,
    })}\n\n`,
  );

  try {
    // 4. Build context window
    const contextPrompt = await contextService.buildContextWindow(thread.id);
    const userText = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ');

    const fullPrompt = contextPrompt
      ? `${contextPrompt}\n\nuser: ${userText}`
      : userText;

    // 5. Handle image content (pass to imageCompletion if present)
    const imageBlock = content.find((b) => b.type === 'image_url');
    let imageContext = '';

    const apiKey = process.env[`${thread.model.toUpperCase()}_API_KEY`] || '';
    const aiService = getAIService(apiKey, thread.model);

    if (imageBlock && imageBlock.url) {
      try {
        imageContext = await aiService.imageCompletion({ image: imageBlock.url });
        imageContext = 'Image Context: ' + imageContext;
      } catch {
        // Model doesn't support images — skip
      }
    }

    // 6. Call AI service
    const result = await aiService.textCompletion(fullPrompt + imageContext);
    let fullText = '';

    if (isReadableStream(result)) {
      // Streaming services (Llama, DeepSeek)
      await new Promise<void>((resolve, reject) => {
        result.on('data', (chunk: any) => {
          if (chunk.text) {
            fullText += chunk.text;
            res.write(
              `data: ${JSON.stringify({
                type: 'delta',
                text: chunk.text,
                msg_id: assistantMessage.id,
              })}\n\n`,
            );
          }
        });
        result.on('end', resolve);
        result.on('error', reject);
      });
    } else {
      // Non-streaming services (OpenAI, Google) — result is a string
      fullText = typeof result === 'string' ? result : JSON.stringify(result);
      res.write(
        `data: ${JSON.stringify({
          type: 'delta',
          text: fullText,
          msg_id: assistantMessage.id,
        })}\n\n`,
      );
    }

    // 7. Persist assistant message
    await updateMessageStatus(assistantMessage.id, 'complete', {
      content: [{ type: 'text', text: fullText }],
      stopReason: 'end_turn',
    });

    // 8. Update thread token count (rough estimate)
    const estimatedTokens = contextService.estimateTokens(fullPrompt + fullText);
    await incrementThreadTokens(thread.id, estimatedTokens);

    // 9. Invalidate context cache
    contextService.invalidate(thread.id);

    // 10. Auto-generate title on first exchange
    const msgCount = await countByThread(thread.id);
    if (msgCount === 2 && !thread.title) {
      const title = userText.substring(0, 60).replace(/\n/g, ' ').trim() || 'New chat';
      // TODO: Use AI to generate a better title (async via BullMQ)
      const prisma = (await import('../config/database')).default;
      await prisma.thread.update({
        where: { id: thread.id },
        data: { title },
      });
    }

    // 11. Send done event
    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        msg_id: assistantMessage.id,
        stop_reason: 'end_turn',
      })}\n\n`,
    );
    res.end();
  } catch (error: any) {
    // Update assistant message to error status
    await updateMessageStatus(assistantMessage.id, 'error').catch(() => {});

    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        code: 'internal_error',
        message: error.message || 'Something went wrong',
        retryable: true,
      })}\n\n`,
    );
    res.end();
  }
}
```

- [ ] **Step 4: Mount message routes in server.ts**

Add to `src/server.ts`:

```typescript
import { messageRoutes } from './routes/messageRoutes';

// Add after threadRoutes mount:
app.use('/api/v1', messageRoutes);
```

- [ ] **Step 5: Run controller tests**

```bash
cd backend && npm test -- tests/controllers/messageController.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/messageController.ts src/routes/messageRoutes.ts tests/controllers/messageController.test.ts src/server.ts
git commit -m "feat: add message API with SSE streaming and persistence"
```

---

## Task 9: Integration Testing with curl

No new files — verify the full flow works end-to-end.

- [ ] **Step 1: Start PostgreSQL + server**

```bash
docker-compose up -d postgres
cd backend && npm start
```

- [ ] **Step 2: Create a thread**

```bash
curl -s -X POST http://localhost:5001/api/v1/threads \
  -H "Content-Type: application/json" \
  -d '{"model": "lama"}' | jq .
```

Expected: JSON with `id`, `model: "lama"`, `status: "active"`, `title: null`.
Save the thread `id` for subsequent calls.

- [ ] **Step 3: List threads**

```bash
curl -s http://localhost:5001/api/v1/threads | jq .
```

Expected: Array with the created thread.

- [ ] **Step 4: Send a message (SSE stream)**

```bash
curl -N -X POST http://localhost:5001/api/v1/threads/<THREAD_ID>/messages \
  -H "Content-Type: application/json" \
  -d '{"content": [{"type": "text", "text": "What is TypeScript?"}]}'
```

Expected: SSE events — `message_created`, then `delta` chunks, then `done`.
(Requires Ollama running with llama3.2 for the `lama` model.)

- [ ] **Step 5: Get thread with messages**

```bash
curl -s http://localhost:5001/api/v1/threads/<THREAD_ID> | jq .
```

Expected: `thread` object with auto-generated `title`, plus `messages` array containing the user message and assistant response.

- [ ] **Step 6: Get message history (pagination)**

```bash
curl -s "http://localhost:5001/api/v1/threads/<THREAD_ID>/messages?limit=10" | jq .
```

Expected: Array of messages in chronological order.

- [ ] **Step 7: Update thread title**

```bash
curl -s -X PATCH http://localhost:5001/api/v1/threads/<THREAD_ID> \
  -H "Content-Type: application/json" \
  -d '{"title": "TypeScript Discussion"}' | jq .
```

Expected: Updated thread with new title.

- [ ] **Step 8: Soft-delete thread**

```bash
curl -s -X DELETE http://localhost:5001/api/v1/threads/<THREAD_ID> | jq .
```

Expected: Thread with `status: "deleted"`.

- [ ] **Step 9: Verify deleted thread is hidden from list**

```bash
curl -s http://localhost:5001/api/v1/threads | jq .
```

Expected: Empty array (deleted thread not shown).

- [ ] **Step 10: Verify legacy endpoint still works**

```bash
curl -N -X POST http://localhost:5001/content-completion \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello", "model": "lama"}'
```

Expected: SSE stream response (same as before).

---

## Future Improvements (TODOs)

These items are noted in the code with `// TODO` comments and documented here for tracking.

### High Priority
| Area | Improvement | TDD Reference |
|------|-------------|---------------|
| Auth | Real JWT auth with access/refresh tokens, signup/login flow | Section 07 |
| Validation | Add Zod schemas on all routes (input validation, max content length) | Section 07 |
| Streaming | Separate POST /messages (returns 202) + GET /stream (SSE) endpoints | Section 05 |
| Title generation | AI-generated titles via async BullMQ job instead of truncated user text | Section 05, step 05 |
| Token counting | Use tiktoken for accurate token estimation instead of `length/4` | Section 06 |

### Medium Priority
| Area | Improvement | TDD Reference |
|------|-------------|---------------|
| Cache | Redis-backed context cache for horizontal scaling | Section 06 |
| Streaming | Redis Pub/Sub for SSE fan-out (decouple LLM pod from SSE pod) | Section 05 |
| Streaming | Heartbeat pings every 15s to survive proxy timeouts | Section 05 |
| Streaming | Stream token (signed, 60s TTL) for SSE auth | Section 05 |
| Rate limiting | Per-user token budget via Redis counters | Section 07 |
| AI services | Upgrade to native multi-turn conversation (messages array vs string concat) | — |
| AI services | Add Anthropic Claude as primary provider | Section 01 |
| Pagination | Return `has_more` flag and `next_cursor` in list responses | — |

### Low Priority
| Area | Improvement | TDD Reference |
|------|-------------|---------------|
| Infra | API gateway (Cloudflare/Kong) for TLS, WAF, rate limiting | Section 08 |
| Infra | Read replica for listing/pagination queries | Section 08 |
| Workers | BullMQ workers for embeddings, audit logs, webhooks | Section 01 |
| Model | Pin model per thread — prevent changing after first message | Section 08 |
| Model | Fork-thread-with-new-model action | Section 08 |
| Storage | S3-compatible object store for image/file attachments | Section 08 |
| Cleanup | Hard-delete GC job for `status=deleted` threads after 30 days | Section 04 |
| Build | Production `tsc` build + Dockerfile for compiled output | — |
| TypeScript | Enable `strict: true` and fix type errors | — |
| TypeScript | Convert existing JS services to TypeScript | — |
