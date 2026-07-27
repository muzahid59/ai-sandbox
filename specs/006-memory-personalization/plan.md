# Implementation Plan: Memory & Personalization

**Feature Branch**: `006-memory-personalization`
**Spec**: `specs/006-memory-personalization/spec.md`
**Status**: Ready for implementation

## Technical Context

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js + Express (ts-node) |
| Database | PostgreSQL + Prisma — two new models: `Memory`, `UserPreferences` |
| Memory extraction | Secondary AI call using `createProvider()` — same factory as main chat |
| Duplicate detection | Jaccard similarity ≥ 0.75 over word sets (pure JS, no library) |
| Memory injection | Prepend custom instructions + memory block in `chatService.processMessage` |
| Token budget | 2,000 tokens reserved for memory block; trim oldest first |
| Preferences init | Atomic transaction with `User.create` in `authService.register` |
| Display name | Stored in existing `User.displayName` — no new column added |
| Default model | Thread `model` field becomes optional; falls back to preferences then `"openai"` |
| Frontend refresh | Re-fetch memories after SSE `done` event when Memory Manager is mounted |
| New npm deps | None — all required packages already installed |

## Constitution Check

### I. Code Quality (NON-NEGOTIABLE)

- **TypeScript**: All new code in `backend/src/`. Five new TypeScript files; no JS added. ✅
- **Single responsibility**: `memoryService` owns storage + duplicate detection + injection. `memoryExtractionService` owns the async AI call. `preferencesService` owns CRUD for preferences. Routes only handle HTTP. ✅
- **Structured logging**: `logger.child({ service: '...' })` in every new service. No `console.log`. ✅
- **Dead code**: No backwards-compat shims added. Thread `model` field remains required in DB; only the route layer makes it optional. ✅
- **Linting**: All new files must pass `npm run lint` before PR. ✅
- **Function size**: Each service function stays well under 50 lines. Extraction prompt builder and duplicate checker are small, pure functions. ✅

### II. Testing Standards

- **Unit tests**: `memoryService` — CRUD, duplicate detection (same/different users, above/below threshold), token budget trimming, system prompt builder. `preferencesService` — getOrCreate, update. `memoryExtractionService` — provider call mocked, JSON parse, graceful failure. ✅
- **Integration tests**: All 6 new endpoints via supertest. Thread creation with and without `model` field. ✅
- **Deterministic**: All tests mock Prisma and AI provider calls. No external network calls. ✅
- **SSE streaming**: Existing SSE tests remain green — extraction runs after `writer.end()` in a separate try/catch. ✅
- **Coverage**: 80% line minimum for new code. Memory injection and extraction paths must have 100% branch coverage. ✅

### III. User Experience Consistency

- **Loading states**: Memory Manager shows a loading skeleton while fetching. Settings panel shows a saving indicator during PATCH. ✅
- **Error messages**: "Memory cannot be blank", "You've reached the 200 memory limit" — no internal codes exposed. ✅
- **CSS Modules**: `MemoryManager.module.css`, `SettingsPanel.module.css`. No global styles added. ✅
- **Streaming unaffected**: Memory extraction is fire-and-forget after `writer.end()`. The streaming UX is identical to today. ✅
- **Prop drilling**: `MemoryManager` and `SettingsPanel` receive their data/callbacks as props from `App.tsx`. No new state management layer. ✅

### IV. Performance Requirements

- **DB indexes**: `(userId, updatedAt DESC)` on `memories` — covers the primary list query. `userId` unique index on `user_preferences` — covers the GET preferences query. ✅
- **Memory injection overhead**: `memoryService.buildMemorySystemPrompt` runs one DB query per message send. Query returns at most 200 short-text rows by index. Estimated < 5ms — well within the 500ms first-delta budget. ✅
- **Extraction async**: No extraction latency visible to the user. ✅
- **No new bundle dependencies**: Zero new frontend npm packages. ✅

### Quality Gates

- Lint Gate: `npm run lint` (backend + frontend) — zero errors. ✅
- Type Gate: `npm run build` (backend) — zero TS errors. ✅
- Test Gate: `npm test` (backend + frontend) — all green. ✅
- Coverage Gate: 80% line coverage for all new files. ✅
- Performance Gate: No new queries without index coverage. ✅
- Security Gate: Memory content is user-provided text — stored as parameterised Prisma queries (no SQL injection). Custom instructions are injected into the system prompt, not executed as code. No secrets in new files. ✅

## Architecture Decisions

### AD-1: Async Memory Extraction After SSE End

**Decision**: Extraction is triggered inside `handleSendMessage` after `writer.end()` using an immediately-invoked async IIFE with a `.catch(err => log.warn(...))` guard. It does not block the HTTP response.

**Why**: FR-07 requires extraction not to block streaming. Express sends the response immediately when `writer.end()` is called; any code after that runs in the same Node.js event loop tick, before the next request, which is sufficient for fire-and-forget.

**See**: `research.md §1`, `messageController.ts`

### AD-2: Jaccard Similarity for Deduplication

**Decision**: `jaccard(new_words, existing_words) >= 0.75` → skip. Computed over lowercased, punctuation-stripped word sets.

**Why**: No library needed. Handles minor rewording. At 500-char max content, word sets are small — computation is negligible.

**See**: `research.md §2`

### AD-3: Memory Injection in chatService, Not ContextService

**Decision**: `memoryService.buildMemorySystemPrompt(userId)` is called inside `chatService.processMessage`, immediately after `getSystemPrompt()`.

**Why**: `ContextService` manages message history. System-level context (who the user is) belongs at the prompt assembly layer. This keeps each service's responsibility clean.

**See**: `research.md §3`

### AD-4: No New Prisma Enum for Model Names

**Decision**: `UserPreferences.defaultModel` is `String?`, validated at the Zod layer against a literal union.

**Why**: Thread.model is already a `String` in the schema. Adding a Prisma enum would require migrating `Thread.model` or having an inconsistency. Zod validation at the API boundary is sufficient and avoids schema churn.

### AD-5: `User.displayName` Reused for Display Name Preference

**Decision**: `UserPreferences` stores `defaultModel` and `customInstructions` only. Display name preference updates `User.displayName` via the preferences PATCH endpoint.

**Why**: `User.displayName` already exists. Duplicating it in `UserPreferences` violates single-responsibility and creates a sync hazard.

**See**: `research.md §6`

### AD-6: Memory Cap Enforced at Service Layer

**Decision**: `memoryService.create()` counts the user's current memories before inserting. If count ≥ 200, throws a `MemoryLimitError`. No DB constraint.

**Why**: The cap is a product policy, not a data integrity constraint. A service-layer check with a clear error code is more appropriate than a CHECK constraint, which would produce an opaque DB error.

---

## Implementation Phases

### Phase 1: Database Schema Changes

**Goal**: Add `Memory` and `UserPreferences` models; add back-relations to `User` and `Thread`; run migration.

**Files to modify**:
1. `backend/prisma/schema.prisma`:
   - Add `MemorySource` enum
   - Add `Memory` model (see `data-model.md` for exact Prisma syntax)
   - Add `UserPreferences` model
   - Add `memories Memory[]` and `preferences UserPreferences?` relations to `User`
   - Add `extractedMemories Memory[] @relation("MemorySourceThread")` to `Thread`

**Commands**:
```bash
cd backend
npx prisma migrate dev --name add-memory-and-user-preferences
npx prisma generate
```

**Verification**: `npx prisma migrate status` shows migration applied. TypeScript build succeeds.

---

### Phase 2: Memory Service

**Goal**: Service layer for memory CRUD, duplicate detection, token-budgeted system prompt builder.

**Files to create**:
1. `backend/src/services/memoryService.ts`

**Key functions**:

```typescript
import prisma from '../config/database';
import { contextService } from './contextService';
import logger from '../config/logger';

const log = logger.child({ service: 'memory' });
const MEMORY_CAP = 200;
const MEMORY_TOKEN_BUDGET = 2000;

export class MemoryLimitError extends Error {}
export class DuplicateMemoryError extends Error {}

export async function listMemories(userId: string, limit = 50, beforeId?: string): Promise<Memory[]>;
  // prisma.memory.findMany({ where: { userId, updatedAt: { lt: beforeUpdatedAt } }, orderBy: { updatedAt: 'desc' }, take: limit })

export async function createMemory(userId: string, content: string, source: MemorySource, sourceThreadId?: string): Promise<Memory>;
  // 1. Count existing memories → throw MemoryLimitError if >= 200
  // 2. Check duplicates against all existing memories → throw DuplicateMemoryError if similar
  // 3. prisma.memory.create(...)

export async function updateMemory(userId: string, memoryId: string, content: string): Promise<Memory>;
  // 1. Find memory by id AND userId (404 guard)
  // 2. Duplicate check against other memories (exclude self)
  // 3. prisma.memory.update(...)

export async function deleteMemory(userId: string, memoryId: string): Promise<void>;
  // 1. Find memory by id AND userId (404 guard)
  // 2. prisma.memory.delete(...)

export async function buildMemorySystemPrompt(userId: string): Promise<string>;
  // 1. Fetch all memories for user, ordered by updatedAt DESC
  // 2. Fetch user preferences for customInstructions
  // 3. Apply token budget — trim oldest until block fits MEMORY_TOKEN_BUDGET
  // 4. Return formatted string (empty string if no memories and no customInstructions)

// Private helpers
function isDuplicate(candidate: string, existing: string[]): boolean;
  // Jaccard similarity over lowercased word sets; returns true if any score >= 0.75

function jaccard(a: Set<string>, b: Set<string>): number;
  // intersection.size / union.size

function tokenize(text: string): Set<string>;
  // lowercase, replace /[^a-z0-9\s]/g with '', split on whitespace, filter empty
```

**System prompt format**:
```
{customInstructions}

[WHAT YOU KNOW ABOUT THE USER]
- {memory.content}
- {memory.content}

---
```

Return empty string `""` when user has no memories and no custom instructions.

**Tests**: `backend/tests/services/memoryService.test.ts`
- `listMemories` returns memories sorted by updatedAt DESC, respects limit
- `createMemory` creates a record with source `manual`
- `createMemory` throws `MemoryLimitError` at 200 memories
- `createMemory` throws `DuplicateMemoryError` for near-identical content (>= 0.75 Jaccard)
- `createMemory` succeeds for content with < 0.75 Jaccard vs existing
- `updateMemory` throws `NotFoundError` for another user's memory
- `deleteMemory` throws `NotFoundError` for another user's memory
- `buildMemorySystemPrompt` returns empty string for user with no memories
- `buildMemorySystemPrompt` includes customInstructions when set
- `buildMemorySystemPrompt` trims oldest memories when token budget exceeded
- `isDuplicate` returns true for identical content
- `isDuplicate` returns false for unrelated content
- `jaccard` returns 1.0 for identical sets, 0.0 for disjoint sets

---

### Phase 3: Memory Extraction Service

**Goal**: Async service that calls a secondary AI to extract personal facts from a conversation turn.

**Files to create**:
1. `backend/src/services/memoryExtractionService.ts`

```typescript
import { createProvider } from '../providers';
import { createMemory, isDuplicate } from './memoryService';
import logger from '../config/logger';

const log = logger.child({ service: 'memoryExtraction' });

export async function extractAndSaveMemories(
  userId: string,
  threadId: string,
  model: string,
  userMessage: string,
  aiResponse: string,
): Promise<void>;
```

**Implementation steps**:
1. Build the extraction prompt (see `research.md §9`)
2. Call `createProvider(model).chatCompletion(...)` with no tools, no streaming
3. Parse response text as JSON array — if parse fails, log warning and return
4. For each extracted fact string (max 5 per turn to limit noise):
   - If `isDuplicate(fact, existingMemories)` → skip
   - If user is at the 200-memory cap → log info and stop
   - Call `createMemory(userId, fact, 'extracted', threadId)`
5. All errors caught and logged — never throws

**Tests**: `backend/tests/services/memoryExtractionService.test.ts`
- Calls provider with extraction prompt
- Saves extracted facts as `source: 'extracted'` with correct `sourceThreadId`
- Skips duplicate facts
- Handles JSON parse failure gracefully (no throw)
- Handles provider error gracefully (no throw)
- Does not save more than 5 facts per turn

---

### Phase 4: Memory API Routes

**Goal**: CRUD endpoints for the authenticated user's memories.

**Files to create**:
1. `backend/src/routes/memoryRoutes.ts`

**Endpoints** (all under `/api/v1/memories`, require `authMiddleware`):

```typescript
import { z } from 'zod';
import { Router } from 'express';
import * as memoryService from '../services/memoryService';

const contentSchema = z.string().min(1).max(500);

// GET /api/v1/memories
// PATCH /api/v1/memories/:id
// POST /api/v1/memories
// DELETE /api/v1/memories/:id
```

Each handler:
- Validates input with Zod
- Calls corresponding `memoryService` function
- Maps `MemoryLimitError` → 422, `DuplicateMemoryError` → 409, `NotFoundError` → 404

**Files to modify**:
2. `backend/src/server.ts`: Mount `memoryRoutes` under `/api/v1` (after `authMiddleware`)

**Tests**: `backend/tests/routes/memories.test.ts`
- `GET /api/v1/memories` → 200 with array
- `GET /api/v1/memories` → 401 without token
- `POST /api/v1/memories` → 201 with valid content
- `POST /api/v1/memories` → 400 with empty content
- `POST /api/v1/memories` → 400 with content > 500 chars
- `POST /api/v1/memories` → 409 on duplicate
- `POST /api/v1/memories` → 422 at 200-memory cap
- `PATCH /api/v1/memories/:id` → 200 with updated content
- `PATCH /api/v1/memories/:id` → 404 for another user's memory
- `DELETE /api/v1/memories/:id` → 204 on success
- `DELETE /api/v1/memories/:id` → 404 for another user's memory

---

### Phase 5: User Preferences Service

**Goal**: Service for reading and updating the one-to-one `UserPreferences` record.

**Files to create**:
1. `backend/src/services/preferencesService.ts`

```typescript
import prisma from '../config/database';

export async function getPreferences(userId: string): Promise<UserPreferences & { displayName: string | null }>;
  // prisma.userPreferences.findUniqueOrThrow({ where: { userId } })
  // + fetch User.displayName
  // Return merged object

export async function updatePreferences(
  userId: string,
  update: { displayName?: string | null; defaultModel?: string | null; customInstructions?: string | null }
): Promise<UserPreferences & { displayName: string | null }>;
  // If displayName in update → prisma.user.update({ where: { id: userId }, data: { displayName } })
  // For defaultModel / customInstructions → prisma.userPreferences.update({ where: { userId }, data: { ... } })
  // Return merged object

export async function initializeDefaults(userId: string): Promise<void>;
  // prisma.userPreferences.create({ data: { userId } })
  // Called only from authService.register — not a public endpoint handler
```

**Tests**: `backend/tests/services/preferencesService.test.ts`
- `getPreferences` returns merged object with `displayName` from User
- `updatePreferences` updates `User.displayName` when displayName is provided
- `updatePreferences` updates `defaultModel` without touching displayName
- `updatePreferences` clears `customInstructions` when passed null
- `initializeDefaults` creates a record with null defaultModel and customInstructions

---

### Phase 6: User Preferences API Routes

**Goal**: GET and PATCH endpoints for user preferences.

**Files to create**:
1. `backend/src/routes/preferencesRoutes.ts`

**Endpoints** (under `/api/v1/preferences`, require `authMiddleware`):

```typescript
const patchSchema = z.object({
  displayName: z.string().min(1).max(100).nullable().optional(),
  defaultModel: z.enum(['openai', 'google', 'deepseek', 'lama']).nullable().optional(),
  customInstructions: z.string().min(1).max(2000).nullable().optional(),
});

// GET /api/v1/preferences → 200 UserPreferences
// PATCH /api/v1/preferences → 200 updated UserPreferences
```

**Files to modify**:
2. `backend/src/server.ts`: Mount `preferencesRoutes` under `/api/v1`

**Tests**: `backend/tests/routes/preferences.test.ts`
- `GET /api/v1/preferences` → 200 with preferences object
- `GET /api/v1/preferences` → 401 without token
- `PATCH /api/v1/preferences` → 200 with valid partial update
- `PATCH /api/v1/preferences` → 400 with invalid defaultModel value
- `PATCH /api/v1/preferences` → 400 with customInstructions > 2000 chars
- `PATCH /api/v1/preferences` → 200 when clearing customInstructions with null

---

### Phase 7: chatService Integration — Memory Injection

**Goal**: Inject the user's memories and custom instructions into every AI prompt.

**Files to modify**:
1. `backend/src/services/chatService.ts`:

```typescript
import { buildMemorySystemPrompt } from './memoryService';

// Inside processMessage, after getSystemPrompt():
const baseSystemPrompt = getSystemPrompt({ supportsTools: useToolPrompt });
const memoryBlock = await buildMemorySystemPrompt(userId ?? '');
const systemPrompt = memoryBlock ? `${memoryBlock}\n${baseSystemPrompt}` : baseSystemPrompt;
```

`userId` is already passed to `processMessage` as an optional parameter — pass it through.

**Tests**: `backend/tests/services/chatService.test.ts` (new tests added)
- System prompt includes memory block when user has memories
- System prompt omits memory block when user has no memories
- Memory injection happens before base system prompt

---

### Phase 8: messageController Integration — Async Extraction

**Goal**: Trigger memory extraction after the SSE stream closes, without blocking the response.

**Files to modify**:
1. `backend/src/controllers/messageController.ts`:

After `writer.end()` in the success path, add:

```typescript
// Fire-and-forget memory extraction
const userText = extractTextContent(content);
(async () => {
  try {
    await extractAndSaveMemories(req.user!.id, thread.id, thread.model, userText, result.text);
  } catch (err) {
    log.warn({ err }, 'Memory extraction failed');
  }
})();
```

The `await` inside the IIFE is necessary to surface errors to the `.catch`-equivalent try/catch, but the IIFE itself is not awaited by the handler — the response has already ended.

**Tests**: `backend/tests/controllers/messageController.test.ts` (verify existing tests remain green; add one test verifying extraction is triggered with correct args)

---

### Phase 9: authService Integration — Create Preferences on Registration

**Goal**: Guarantee a `UserPreferences` record exists for every user immediately on registration.

**Files to modify**:
1. `backend/src/services/authService.ts` — update the `register` function:

```typescript
import { initializeDefaults } from './preferencesService';

// In register(), replace prisma.user.create with a transaction:
const [user] = await prisma.$transaction([
  prisma.user.create({ data: { email, passwordHash: hash } }),
  // Preferences created in same transaction
]);
await initializeDefaults(user.id);  // separate call, acceptable if not atomic
```

Actually, since `initializeDefaults` needs the user ID, use a nested write instead:

```typescript
const user = await prisma.user.create({
  data: {
    email,
    passwordHash: hash,
    preferences: { create: {} },  // Prisma nested create
  },
});
```

This is atomic and requires no separate call.

**Tests**: `backend/tests/services/authService.test.ts` — add test: after `register`, a `UserPreferences` record exists for the new user.

---

### Phase 10: threadService Integration — Default Model from Preferences

**Goal**: When `model` is not supplied to thread creation, fall back to user preferences.

**Files to modify**:
1. `backend/src/controllers/threadController.ts` or `backend/src/services/threadService.ts` — in the `createThread` handler:

```typescript
import { getPreferences } from '../services/preferencesService';

// If model is not provided in request body:
const model = req.body.model ?? (await getPreferences(req.user!.id)).defaultModel ?? 'openai';
```

2. Update the Zod schema for thread creation to make `model` optional:

```typescript
const createThreadSchema = z.object({
  model: z.string().optional(),
  // ... other fields
});
```

**Tests**: `backend/tests/routes/threads.test.ts` — add tests:
- Thread created without `model` uses `UserPreferences.defaultModel`
- Thread created without `model` when preferences has null `defaultModel` uses `"openai"`
- Thread created with explicit `model` always uses the provided value

---

### Phase 11: Frontend — Memory Manager Component

**Goal**: A view listing all memories with inline edit and delete confirmation.

**Files to create**:
1. `app/src/components/MemoryManager/MemoryManager.tsx`
   - Fetches `GET /api/v1/memories` on mount
   - Renders a list: each item shows content, date, source badge (`manual` / `AI`)
   - Inline edit: clicking "Edit" makes the content editable; "Save" calls PATCH; "Cancel" discards
   - Delete: "Delete" button shows an inline confirmation (`"Delete this memory?"` with Confirm/Cancel); confirmed → DELETE request
   - Empty state: "No memories yet. Start a conversation and the AI will start learning about you."
   - Add memory form: text input + "Add" button → POST request
   - Exposes `refresh()` method via `useImperativeHandle` (or controlled via parent prop `version` counter)

2. `app/src/components/MemoryManager/MemoryManager.module.css`

**Files to modify**:
3. `app/src/components/Sidebar/Sidebar.tsx`: Add a "Memories" button that shows/hides the MemoryManager panel (slide-in sidebar panel or inline section)
4. `app/src/App.tsx`: Wire up MemoryManager visibility state and the `refreshMemories` trigger

**Tests**: `app/src/components/MemoryManager/MemoryManager.test.tsx`
- Renders memory list fetched from API
- Shows empty state when no memories
- Edit mode shows input with existing content
- Save calls PATCH with updated content
- Cancel reverts to display mode
- Delete confirmation appears before deletion
- Confirmed delete calls DELETE and removes from list
- Add memory form calls POST and adds to list
- Shows error when save fails

---

### Phase 12: Frontend — Settings Panel

**Goal**: Panel for custom instructions and preferences (display name, default model).

**Files to create**:
1. `app/src/components/SettingsPanel/SettingsPanel.tsx`
   - Fetches `GET /api/v1/preferences` on mount
   - Fields: display name (text input), default model (select), custom instructions (textarea)
   - "Save" button → PATCH; shows "Saved" confirmation for 2 seconds
   - "Clear" link next to custom instructions → sets to null
   - Validation: character counters for custom instructions (2000 limit), display name (100 limit)

2. `app/src/components/SettingsPanel/SettingsPanel.module.css`

**Files to modify**:
3. `app/src/components/Sidebar/Sidebar.tsx`: Add a "Settings" / gear icon button that opens the SettingsPanel

**Tests**: `app/src/components/SettingsPanel/SettingsPanel.test.tsx`
- Renders with current preferences values
- Save calls PATCH with changed values
- Shows success confirmation after save
- Shows error message on save failure
- Character counter updates as user types in custom instructions

---

### Phase 13: Frontend — Memory Refresh After Conversation Turn

**Goal**: When the Memory Manager is visible, re-fetch memories after each completed AI response.

**Files to modify**:
1. `app/src/components/ChatContainer/ChatContainer.tsx` (or wherever the SSE `done` event is processed):
   - Accept optional `onMessageComplete?: () => void` prop
   - Call this prop when the SSE `done` event is received

2. `app/src/App.tsx`:
   - Track a `memoriesVersion` counter in state (`useState(0)`)
   - Pass `onMessageComplete={() => setMemoriesVersion(v => v + 1)}` to `ChatContainer`
   - Pass `version={memoriesVersion}` to `MemoryManager`

3. `app/src/components/MemoryManager/MemoryManager.tsx`:
   - Accept a `version: number` prop
   - `useEffect([version], () => { if (version > 0) fetchMemories(); })`

**Tests**: Manual verification — no unit test for the prop chain, covered by E2E scenario in Phase 14.

---

### Phase 14: Safety Verification

**Goal**: Validate all acceptance scenarios and cross-user isolation before PR.

**Verification checklist**:

- [ ] Save memory for User A; User B starts a conversation → User B's system prompt contains no trace of User A's memories
- [ ] Save memory `"User prefers bullet points"` for User A; send an open-ended question → response is in bullet points without asking
- [ ] Set custom instructions `"Always respond in French"` → next AI response is in French
- [ ] Set custom instructions > 2000 chars → 400 validation error shown in UI
- [ ] Create memory with empty string → validation error in UI
- [ ] Create 200 memories; attempt a 201st → 422 error shown in UI
- [ ] AI extracts a memory during conversation; open Memory Manager (no page refresh) → extracted memory appears
- [ ] Delete all memories; send follow-up → AI has no knowledge of prior facts
- [ ] Edit a memory; start new thread → AI uses the updated fact
- [ ] Set default model to `google` in preferences; create thread without specifying model → thread uses Google provider
- [ ] Thread created with explicit `model: "openai"` → ignores preferences, uses OpenAI
- [ ] Create memory via POST; check the system prompt log → memory appears in the `[WHAT YOU KNOW ABOUT THE USER]` block
- [ ] `GET /api/v1/memories` without auth → 401
- [ ] `GET /api/v1/preferences` without auth → 401
- [ ] `PATCH /api/v1/memories/{other_user_id_memory}` → 404

---

## File Summary

### New Files (14)

| File | Description |
|------|-------------|
| `backend/src/services/memoryService.ts` | Memory CRUD, duplicate detection, system prompt builder |
| `backend/src/services/memoryExtractionService.ts` | Async secondary AI call for fact extraction |
| `backend/src/services/preferencesService.ts` | UserPreferences CRUD + display name update |
| `backend/src/routes/memoryRoutes.ts` | CRUD endpoints for memories |
| `backend/src/routes/preferencesRoutes.ts` | GET + PATCH endpoints for preferences |
| `backend/tests/services/memoryService.test.ts` | Unit tests for memory service |
| `backend/tests/services/memoryExtractionService.test.ts` | Unit tests for extraction service |
| `backend/tests/services/preferencesService.test.ts` | Unit tests for preferences service |
| `backend/tests/routes/memories.test.ts` | Integration tests for memory endpoints |
| `backend/tests/routes/preferences.test.ts` | Integration tests for preferences endpoints |
| `app/src/components/MemoryManager/MemoryManager.tsx` | Memory list with inline edit/delete/add |
| `app/src/components/MemoryManager/MemoryManager.module.css` | Memory Manager styles |
| `app/src/components/SettingsPanel/SettingsPanel.tsx` | Custom instructions + preferences UI |
| `app/src/components/SettingsPanel/SettingsPanel.module.css` | Settings Panel styles |

### Modified Files (9)

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add `Memory`, `UserPreferences` models; add relations to `User` and `Thread` |
| `backend/src/services/chatService.ts` | Inject memory system prompt block before base system prompt |
| `backend/src/services/authService.ts` | Nested create `UserPreferences` on user registration |
| `backend/src/controllers/messageController.ts` | Fire-and-forget extraction after SSE end |
| `backend/src/controllers/threadController.ts` | Make `model` optional; fall back to user preferences |
| `backend/src/server.ts` | Mount `memoryRoutes` and `preferencesRoutes` |
| `app/src/App.tsx` | Add `memoriesVersion` counter; wire `onMessageComplete` and `SettingsPanel` |
| `app/src/components/Sidebar/Sidebar.tsx` | Add Memories and Settings buttons |
| `app/src/components/ChatContainer/ChatContainer.tsx` | Accept + call `onMessageComplete` prop on SSE done |

### Unchanged Files

- `backend/src/services/contextService.ts` — memory injection is at the prompt layer, not the message history layer
- `backend/src/services/toolExecutor.ts` — no changes to the agentic loop
- `backend/src/middleware/auth.ts` — no changes
- All AI provider files — no changes
- `backend/src/services/googleAuthService.ts` — no changes
- All existing tests — must remain green after these changes

---

## Dependencies Between Phases

```
Phase 1 (DB Schema)
    │
    ├── Phase 2 (Memory Service)
    │       ├── Phase 3 (Extraction Service) ──→ Phase 8 (messageController)
    │       ├── Phase 4 (Memory Routes)
    │       └── Phase 7 (chatService injection)
    │
    └── Phase 5 (Preferences Service)
            ├── Phase 6 (Preferences Routes)
            ├── Phase 9 (authService init)
            └── Phase 10 (threadController default model)
                        │
    ┌───────────────────┴────────────────────────────────────┐
    │  All backend phases complete                            │
    │                                                         │
    ▼                                                         ▼
Phase 11 (Frontend Memory Manager) ──→ Phase 13 (Refresh)
Phase 12 (Frontend Settings Panel)
    │
    ▼
Phase 14 (Safety Verification)
```

Phases 2 and 5 can proceed in parallel after Phase 1. Within Phase 2, the memory service must be complete before Phases 3, 4, and 7. Frontend phases (11–13) can begin once the backend API is running end-to-end.
