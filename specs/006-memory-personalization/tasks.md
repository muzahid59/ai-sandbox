# Tasks: Memory & Personalization

**Feature Branch**: `006-memory-personalization`
**Spec**: `specs/006-memory-personalization/spec.md`
**Plan**: `specs/006-memory-personalization/plan.md`
**Generated**: 2026-07-27

---

## Phase 1: Setup — Database Schema

**Goal**: Add `Memory` and `UserPreferences` Prisma models, the `MemorySource` enum, and back-relations to `User` and `Thread`. This migration is a hard prerequisite for every subsequent phase.

**Independent test**: `npx prisma migrate status` shows no pending migrations. `npx prisma generate` exits with zero errors. `npm run build` in `backend/` compiles cleanly.

- [X] T001 Add `MemorySource` enum (`manual`, `extracted`), `Memory` model (id, userId FK→User cascade, content VarChar(500), source MemorySource, sourceThreadId nullable FK→Thread SetNull, createdAt, updatedAt, `@@index([userId, updatedAt(sort: Desc)])`, `@@map("memories")`), and `UserPreferences` model (id, userId unique FK→User cascade, defaultModel String?, customInstructions VarChar(2000)?, createdAt, updatedAt, `@@map("user_preferences")`) to `backend/prisma/schema.prisma`
- [X] T002 Add `memories Memory[]`, `preferences UserPreferences?` relations to the `User` model and `extractedMemories Memory[] @relation("MemorySourceThread")` back-relation to the `Thread` model in `backend/prisma/schema.prisma`; run `cd backend && npx prisma migrate dev --name add-memory-and-user-preferences && npx prisma generate`

---

## Phase 2: Foundational — Core Services

**Goal**: Implement the service layer that all user stories depend on — memory CRUD with duplicate detection, preferences CRUD, and atomic preferences initialization on registration. No routes yet.

**Independent test**: `npm test` in `backend/` passes all new service unit tests. `npm run build` exits clean.

- [X] T003 Create `backend/src/services/memoryService.ts` exporting: `listMemories(userId, limit?, beforeId?)`, `createMemory(userId, content, source, sourceThreadId?)`, `updateMemory(userId, memoryId, content)`, `deleteMemory(userId, memoryId)`, custom errors `MemoryLimitError` and `DuplicateMemoryError`; implement private helpers `tokenize(text): Set<string>` (lowercase, strip punctuation, split), `jaccard(a, b): number` (intersection.size / union.size), `isDuplicate(candidate, existing[]): boolean` (Jaccard ≥ 0.75 → true); enforce 200-memory cap and duplicate detection in `createMemory` and `updateMemory`
- [X] T004 [P] Create `backend/src/services/preferencesService.ts` exporting: `getPreferences(userId)` returning merged object with `displayName` from `User.displayName`, `defaultModel` and `customInstructions` from `UserPreferences`; `updatePreferences(userId, update)` updating `User.displayName` when `displayName` is in the update, and `UserPreferences` fields for `defaultModel`/`customInstructions`; `initializeDefaults(userId)` creating a blank `UserPreferences` record
- [X] T005 Update `backend/src/services/authService.ts` `register()` function: replace `prisma.user.create({ data: { email, passwordHash } })` with a Prisma nested write `prisma.user.create({ data: { email, passwordHash: hash, preferences: { create: {} } } })` to atomically create `UserPreferences` on every new account
- [X] T006 Create `backend/tests/services/memoryService.test.ts` covering: `listMemories` returns records ordered by `updatedAt DESC`; `createMemory` saves with `source: 'manual'`; `createMemory` throws `MemoryLimitError` when count ≥ 200; `createMemory` throws `DuplicateMemoryError` for Jaccard ≥ 0.75; `createMemory` succeeds for Jaccard < 0.75; `updateMemory` throws `NotFoundError` for another user's memory; `deleteMemory` throws `NotFoundError` for another user's memory; `isDuplicate` returns true for identical content; `isDuplicate` returns false for unrelated content; `jaccard` returns 1.0 for identical sets and 0.0 for disjoint sets
- [X] T007 [P] Create `backend/tests/services/preferencesService.test.ts` covering: `getPreferences` merges `displayName` from `User`; `updatePreferences` updates `User.displayName` when provided; `updatePreferences` updates `defaultModel` without touching `displayName`; `updatePreferences` clears `customInstructions` when passed `null`; `initializeDefaults` creates record with null `defaultModel` and `customInstructions`; after `authService.register`, a `UserPreferences` record exists for the new user

---

## Phase 3: US3 — Memory Injection Into Every Conversation

**Goal**: Every AI prompt includes the user's stored memories and custom instructions, prepended before the base system prompt. Users with no memories experience no behavior change.

**Independent test**: Create a memory `"User is a backend engineer"` for a user via direct DB insert, send a message in a new thread, capture the system prompt from logs — verify it contains the `[WHAT YOU KNOW ABOUT THE USER]` block with that fact. Verify an account with zero memories sends no memory block.

- [X] T008 [US3] Add `buildMemorySystemPrompt(userId: string): Promise<string>` to `backend/src/services/memoryService.ts`: fetch all memories for user ordered by `updatedAt DESC`; fetch `customInstructions` from `UserPreferences`; apply 2,000-token budget using `contextService.estimateTokens` — trim oldest memories until block fits; format as `"{customInstructions}\n\n[WHAT YOU KNOW ABOUT THE USER]\n- {content}\n- ...\n\n---"` (omit sections that are null/empty); return empty string when nothing to inject
- [X] T009 [US3] Update `backend/src/services/chatService.ts` `processMessage`: import `buildMemorySystemPrompt` from `./memoryService`; after `const baseSystemPrompt = getSystemPrompt(...)`, call `const memoryBlock = await buildMemorySystemPrompt(userId ?? '')` and set `const systemPrompt = memoryBlock ? \`${memoryBlock}\n${baseSystemPrompt}\` : baseSystemPrompt`; `userId` is already accepted as an optional parameter — pass it through
- [X] T010 [P] [US3] Add tests to `backend/tests/services/memoryService.test.ts` for `buildMemorySystemPrompt`: returns empty string for user with no memories and no customInstructions; includes customInstructions when set; includes memories in `[WHAT YOU KNOW ABOUT THE USER]` block; trims oldest memories when token budget is exceeded; preserves customInstructions even when all memories are trimmed
- [X] T011 [P] [US3] Add tests to `backend/tests/services/chatService.test.ts` (or create it): system prompt includes memory block when user has memories; system prompt is unchanged when user has no memories; `buildMemorySystemPrompt` is called with the `userId` passed to `processMessage`

---

## Phase 4: US1 — AI Extracts a Memory Automatically

**Goal**: After each AI response, the system asynchronously evaluates the conversation turn for personal facts and saves them — without blocking the SSE stream. New memories appear in the Memory Manager without a page refresh.

**Independent test**: Send the message `"I'm a senior backend engineer working mostly in TypeScript"` in any thread. After the response completes, query `GET /api/v1/memories` — a new memory with `source: "extracted"` referencing the correct `sourceThreadId` must be present within 5 seconds.

- [X] T012 [US1] Create `backend/src/services/memoryExtractionService.ts` exporting `extractAndSaveMemories(userId, threadId, model, userMessage, aiResponse): Promise<void>`: build the extraction prompt (see `research.md §9`); call `createProvider(model).chatCompletion(...)` with no tools; parse JSON array response — on parse failure, log warning and return; for each extracted string (max 5): call `isDuplicate` against existing memories — skip if duplicate; catch `MemoryLimitError` and log info then stop; call `createMemory(userId, fact, 'extracted', threadId)`; all errors caught and logged — never throws
- [X] T013 [US1] Update `backend/src/controllers/messageController.ts` `handleSendMessage`: after `writer.end()` in the success path, add a fire-and-forget IIFE: `(async () => { try { const userText = extractTextContent(content); await extractAndSaveMemories(req.user!.id, thread.id, thread.model, userText, result.text); } catch (err) { log.warn({ err }, 'Memory extraction failed'); } })()`; import `extractAndSaveMemories` from `'../services/memoryExtractionService'`
- [X] T014 [US1] Create `backend/tests/services/memoryExtractionService.test.ts` covering: calls provider with correct extraction prompt; saves extracted facts with `source: 'extracted'` and correct `sourceThreadId`; skips facts that are duplicates of existing memories; handles JSON parse failure gracefully (no throw); handles provider error gracefully (no throw); does not save more than 5 facts per turn; stops saving when user reaches 200-memory limit
- [X] T015 [P] [US1] Update `app/src/components/ChatContainer/ChatContainer.tsx`: accept optional `onMessageComplete?: () => void` prop; call `onMessageComplete?.()` immediately after the SSE `done` event is received and processed
- [X] T016 [P] [US1] Update `app/src/App.tsx`: add `const [memoriesVersion, setMemoriesVersion] = useState(0)` state; pass `onMessageComplete={() => setMemoriesVersion(v => v + 1)}` to `ChatContainer`; pass `version={memoriesVersion}` to `MemoryManager` (wired in Phase 7)

---

## Phase 5: US2 — User Manually Adds a Memory

**Goal**: Authenticated users can create, update, and delete their own memories via REST API. The Memory service layer from Phase 2 is already complete — this phase exposes it over HTTP.

**Independent test**: `POST /api/v1/memories` with `{ "content": "My project is Orion" }` → 201 with a Memory object. `GET /api/v1/memories` → list includes the new entry. `PATCH /api/v1/memories/:id` with updated content → 200. `DELETE /api/v1/memories/:id` → 204 and subsequent GET excludes it.

- [X] T017 [US2] Create `backend/src/routes/memoryRoutes.ts` with Express router: define `contentSchema = z.string().min(1).max(500)`; `GET /memories` → `listMemories(req.user!.id, limit, beforeId)` → `res.json({ memories, hasMore })`; `POST /memories` → validate body with contentSchema → `createMemory(...)` → 201; map `MemoryLimitError` → 422 `memory_limit_reached`, `DuplicateMemoryError` → 409 `duplicate_memory`; `PATCH /memories/:id` → validate content → `updateMemory(...)` → 200; map `NotFoundError` → 404; `DELETE /memories/:id` → `deleteMemory(...)` → 204; map `NotFoundError` → 404
- [X] T018 [US2] Update `backend/src/server.ts`: import `memoryRoutes` from `./routes/memoryRoutes`; mount with `app.use('/api/v1', authMiddleware, memoryRoutes)` (after existing protected route mounts); verify `authMiddleware` is already applied to `/api/v1` — use existing pattern from `threadRoutes`
- [X] T019 [US2] Create `backend/tests/routes/memories.test.ts` covering: `GET /api/v1/memories` → 200 with array; `GET /api/v1/memories` → 401 without token; `POST /api/v1/memories` → 201 with valid content; `POST /api/v1/memories` → 400 with empty content; `POST /api/v1/memories` → 400 with content > 500 chars; `POST /api/v1/memories` → 409 on duplicate; `POST /api/v1/memories` → 422 at 200-memory cap; `PATCH /api/v1/memories/:id` → 200 with updated content; `PATCH /api/v1/memories/:id` → 404 for another user's memory; `DELETE /api/v1/memories/:id` → 204 on success; `DELETE /api/v1/memories/:id` → 404 for another user's memory

---

## Phase 6: US4 — Custom Instructions

**Goal**: Users set a persistent instruction block prepended to every system prompt. Exposed via a GET + PATCH preferences endpoint and a Settings UI section.

**Independent test**: `PATCH /api/v1/preferences` with `{ "customInstructions": "Always respond in French" }` → 200. Send an English message → AI reply is in French. `PATCH /api/v1/preferences` with `{ "customInstructions": null }` → AI reverts to English.

- [X] T020 [US4] Create `backend/src/routes/preferencesRoutes.ts` with Express router: `patchSchema = z.object({ displayName: z.string().min(1).max(100).nullable().optional(), defaultModel: z.enum(['openai','google','deepseek','lama']).nullable().optional(), customInstructions: z.string().min(1).max(2000).nullable().optional() })`; `GET /preferences` → `getPreferences(req.user!.id)` → 200; `PATCH /preferences` → validate body with patchSchema → `updatePreferences(req.user!.id, update)` → 200; map Zod errors → 400 `validation_error`
- [X] T021 [US4] Update `backend/src/server.ts`: import `preferencesRoutes` from `./routes/preferencesRoutes`; mount with `app.use('/api/v1', authMiddleware, preferencesRoutes)` alongside the existing route mounts
- [X] T022 [US4] Create `backend/tests/routes/preferences.test.ts` covering: `GET /api/v1/preferences` → 200 with preferences object; `GET /api/v1/preferences` → 401 without token; `PATCH /api/v1/preferences` → 200 with valid partial update; `PATCH /api/v1/preferences` → 400 with invalid `defaultModel` value (e.g. `"anthropic"`); `PATCH /api/v1/preferences` → 400 with `customInstructions` > 2000 chars; `PATCH /api/v1/preferences` → 200 when clearing `customInstructions` with `null`
- [X] T023 [US4] Create `app/src/components/SettingsPanel/SettingsPanel.tsx`: fetch `GET /api/v1/preferences` on mount using `fetchWithAuth`; render a `<textarea>` for custom instructions with character counter (2000 limit); render "Save" button → `PATCH /api/v1/preferences` with changed fields; show "Saved ✓" inline confirmation for 2 seconds after success; show error message on failure; "Clear" link sets `customInstructions: null`; accept `onClose: () => void` prop; use CSS Modules
- [X] T024 [US4] Create `app/src/components/SettingsPanel/SettingsPanel.module.css` with styles for the panel container, textarea, character counter, save button, success/error states
- [X] T025 [P] [US4] Update `app/src/components/Sidebar/Sidebar.tsx`: add a "Settings" button (gear icon or text link) at the bottom; accept `onOpenSettings: () => void` prop and wire it to the button's `onClick`
- [X] T026 [P] [US4] Update `app/src/App.tsx`: add `const [showSettings, setShowSettings] = useState(false)` state; pass `onOpenSettings={() => setShowSettings(true)}` to `Sidebar`; conditionally render `<SettingsPanel onClose={() => setShowSettings(false)} />` when `showSettings` is true

---

## Phase 7: US5 — Memory Management UI

**Goal**: Users can view all their memories with creation date and source badge, add new memories manually, edit memory content inline, and permanently delete memories with a confirmation step.

**Independent test**: Create 5 memories via API, open the Memory Manager — all 5 appear. Click "Delete" on one, confirm — it disappears from the list and `GET /api/v1/memories` excludes it. Edit a memory — the updated text appears without a page reload.

- [X] T027 [US5] Create `app/src/components/MemoryManager/MemoryManager.tsx`: fetch `GET /api/v1/memories` on mount using `fetchWithAuth`; re-fetch when `version` prop changes; render list with content text, formatted `createdAt` date, and source badge (`"manual"` / `"AI"`); inline edit mode: "Edit" button → replaces text with `<textarea>` pre-filled with content + "Save" / "Cancel" buttons; "Save" calls `PATCH /api/v1/memories/:id`, updates list on success; "Cancel" reverts without API call; delete flow: "Delete" button → shows inline `"Delete this memory? Confirm / Cancel"`; "Confirm" calls `DELETE /api/v1/memories/:id`, removes from list; add form: `<input>` + "Add" button at top → `POST /api/v1/memories`, prepends to list on success; empty state: `"No memories yet. Start a conversation and the AI will start learning about you."`; accept `version: number` and `onClose: () => void` props; use CSS Modules
- [X] T028 [US5] Create `app/src/components/MemoryManager/MemoryManager.module.css` with styles for the panel container, memory list items, source badge, edit mode textarea, delete confirmation inline row, add form input, and empty state
- [ ] T029 [US5] Create `app/src/components/MemoryManager/MemoryManager.test.tsx` covering: renders memory list from API; shows empty state when no memories returned; edit mode renders textarea with existing content; save calls PATCH and updates list; cancel reverts to display mode without API call; delete confirmation appears before deletion; confirmed delete calls DELETE and removes item from list; add form calls POST and prepends new memory to list; shows error when save fails
- [X] T030 [P] [US5] Update `app/src/components/Sidebar/Sidebar.tsx`: add a "Memories" button; accept `onOpenMemories: () => void` prop and wire it to the button
- [X] T031 [P] [US5] Update `app/src/App.tsx`: add `const [showMemories, setShowMemories] = useState(false)` state; pass `onOpenMemories={() => setShowMemories(true)}` to `Sidebar`; pass `version={memoriesVersion}` (from T016) to `MemoryManager`; conditionally render `<MemoryManager version={memoriesVersion} onClose={() => setShowMemories(false)} />` when `showMemories` is true

---

## Phase 8: US6 — User Preferences (Display Name & Default Model)

**Goal**: Users set a display name (used in AI prompts) and a default AI model (applied to new threads). Thread creation accepts `model` as optional and reads from preferences when omitted.

**Independent test**: `PATCH /api/v1/preferences` with `{ "displayName": "Alex", "defaultModel": "google" }` → 200. `POST /api/v1/threads` without `model` field → 201; thread's `model` field equals `"google"`. Reload the app → display name "Alex" is visible in the UI.

- [X] T032 [US6] Update `backend/src/controllers/threadController.ts` (or `backend/src/services/threadService.ts`) `createThread` handler: update Zod schema to make `model` optional (`z.string().optional()`); if `model` is absent, call `getPreferences(req.user!.id)` and use `preferences.defaultModel ?? 'openai'` as the model; pass resolved model value to the Prisma thread create call
- [X] T033 [US6] Add tests to `backend/tests/routes/threads.test.ts` (or create it): `POST /api/v1/threads` without `model` uses `UserPreferences.defaultModel`; `POST /api/v1/threads` without `model` when `defaultModel` is null uses `"openai"`; `POST /api/v1/threads` with explicit `model` always uses the provided value regardless of preferences
- [X] T034 [P] [US6] Update `app/src/components/SettingsPanel/SettingsPanel.tsx` (created in T023): add `<input>` for display name (max 100 chars, character counter); add `<select>` for default model with options `openai`, `google`, `deepseek`, `lama`; include these fields in the PATCH body alongside `customInstructions`
- [X] T035 [P] [US6] Update `app/src/App.tsx`: after auth restore succeeds (the `tryRestoreSession` useEffect), fetch `GET /api/v1/preferences` and store in state `const [preferences, setPreferences] = useState<UserPreferences | null>(null)`; pass current `preferences` and `onPreferencesChange={setPreferences}` to `SettingsPanel` so it can seed its form fields without a separate API call on open

---

## Phase 9: Polish & Cross-Cutting Concerns

**Goal**: Verify lint, types, test coverage, and all safety scenarios from the plan before opening a PR.

**Independent test**: `npm run lint` in both `app/` and `backend/` exits with zero errors. `npm run build` in `backend/` exits clean. `npm test` in both directories passes with all tests green.

- [X] T036 Run `npm run lint` in `backend/` and `app/`; fix any lint errors introduced by new files; run `npm run format` to ensure Prettier compliance in all new TypeScript/CSS files
- [X] T037 [P] Run `npm run build` in `backend/`; resolve any TypeScript strict-mode errors in new files (`memoryService.ts`, `memoryExtractionService.ts`, `preferencesService.ts`, `memoryRoutes.ts`, `preferencesRoutes.ts`, updated `chatService.ts`, `messageController.ts`, `threadController.ts`, `authService.ts`)
- [X] T038 [P] Run `npm test` in `backend/`; verify all new test files pass and line coverage for new files meets 80% threshold; critical paths (memory injection, extraction fire-and-forget, duplicate detection) must have 100% branch coverage
- [ ] T039 Execute the safety verification checklist from `specs/006-memory-personalization/plan.md` Phase 14: verify cross-user memory isolation (User A memories never in User B prompts), extraction does not block SSE streaming, `DELETE /api/v1/memories/:id` with another user's ID returns 404, `GET /api/v1/memories` without auth returns 401, setting `customInstructions: null` reverts AI to default behavior, thread created without `model` uses preferences fallback

---

## Dependencies

```
T001 → T002 (migration requires schema)
T002 → T003, T004, T005 (services require generated Prisma types)
T003 → T006 (tests require service)
T004 → T007 (tests require service)
T005 → T007 (authService test verifies preferences created on register)
T003, T004 → T008 (buildMemorySystemPrompt uses both services)
T008 → T009 (chatService integration requires buildMemorySystemPrompt)
T008 → T010 (tests require buildMemorySystemPrompt)
T009 → T011 (chatService tests require updated chatService)
T003 → T012 (extraction uses memoryService.createMemory + isDuplicate)
T012 → T013 (messageController trigger requires extraction service)
T012 → T014 (tests require extraction service)
T003 → T017 (memory routes use memoryService)
T017 → T018 (server mount requires route file)
T017 → T019 (tests require routes)
T004 → T020 (preferences routes use preferencesService)
T020 → T021 (server mount requires route file)
T020 → T022 (tests require routes)
T020 → T023 (settings UI requires preferences API)
T023, T024 → T025, T026 (sidebar + App integration requires SettingsPanel)
T017 → T027 (MemoryManager uses memory API)
T027, T028 → T029 (tests require component)
T027 → T030, T031 (sidebar + App integration requires MemoryManager)
T015, T016 → T031 (memoriesVersion requires onMessageComplete wiring)
T004 → T032 (thread default model requires preferencesService)
T032 → T033 (tests require updated thread controller)
T023 → T034 (display name + model fields extend SettingsPanel)
T035 → T026 (preferences state requires App.tsx fetch)
T001–T035 → T036, T037, T038, T039 (Polish requires all code)
```

## Parallel Execution Opportunities

**After T002 completes**, all of these can run concurrently:
- T003 (memoryService) + T004 (preferencesService) + T005 (authService update)

**After T003 + T004 complete**, concurrently:
- T006 (memoryService tests) + T007 (preferencesService tests) + T008 (buildMemorySystemPrompt)

**After T008 completes**, concurrently:
- T009 (chatService integration) + T010 (buildMemorySystemPrompt tests)

**After T003 completes**, concurrently with T008–T011:
- T012 (memoryExtractionService) → T013 (messageController) + T014 (extraction tests)

**Frontend phases (T015, T016, T023–T031, T034, T035)** can run in parallel with backend test writing once the API routes are defined.

**Polish (T036, T037, T038)** can run in parallel with each other.

## Implementation Strategy

**MVP scope (US3 + US1 only — Phases 1–4)**:
- DB schema + memoryService + preferencesService (Phase 1–2)
- Memory injection via `buildMemorySystemPrompt` + chatService (Phase 3, US3)
- Async extraction via `memoryExtractionService` + messageController trigger (Phase 4, US1)
- Result: memories extracted from chat and injected into future chats, with no UI yet

**Increment 2 (add manual memory API — Phase 5, US2)**:
- Memory CRUD routes — users can test injection by POSTing memories directly

**Increment 3 (add custom instructions + preferences API — Phase 6, US4)**:
- Preferences routes + Settings UI for custom instructions

**Increment 4 (add Memory Manager UI — Phase 7, US5)**:
- Full frontend for viewing, editing, and deleting memories

**Increment 5 (add display name + default model — Phase 8, US6)**:
- Thread model defaulting + extended Settings UI

**Total tasks**: 39 (T001–T039)

| Phase | Story | Task Count |
|-------|-------|-----------|
| 1 — Setup | — | 2 |
| 2 — Foundational | — | 5 |
| 3 — Memory Injection | US3 (P0) | 4 |
| 4 — Extraction | US1 (P0) | 5 |
| 5 — Manual Memory API | US2 (P1) | 3 |
| 6 — Custom Instructions | US4 (P1) | 7 |
| 7 — Memory Manager UI | US5 (P1) | 5 |
| 8 — User Preferences | US6 (P2) | 4 |
| 9 — Polish | — | 4 |
