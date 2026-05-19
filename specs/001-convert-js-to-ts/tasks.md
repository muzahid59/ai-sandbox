# Tasks: Convert JavaScript to TypeScript

**Input**: Design documents from `specs/001-convert-js-to-ts/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md

**Tests**: No test tasks generated — the spec does not request new tests.
Existing tests must continue passing (SC-003, SC-004) and are verified
via checkpoint tasks.

**Organization**: Tasks grouped by user story for independent
implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Record baseline and install dependencies

- [X] T001 Record pre-migration frontend bundle size by running `npm run build` in `app/` and saving output for SC-007 comparison
- [X] T002 Install TypeScript and type dependencies in `app/`: `npm install --save-dev typescript @types/react @types/react-dom @types/node @types/jest`
- [X] T003 Install ESLint TypeScript dependencies in `app/`: `npm install --save-dev @typescript-eslint/parser @typescript-eslint/eslint-plugin`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: TypeScript configuration and type infrastructure that MUST be complete before ANY file conversion can begin

**CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Create `app/tsconfig.json` with `strict: true`, JSX react-jsx, path alias `@shared/*` pointing to `../shared/*`, include `src/**/*`
- [X] T005 [P] Create CSS Module wildcard type declaration at `app/src/types/css.d.ts` declaring `*.module.css` modules
- [X] T006 [P] Create Web Speech API type declaration at `app/src/types/speech.d.ts` augmenting Window with SpeechRecognition and webkitSpeechRecognition
- [X] T007 [P] Create frontend-specific types at `app/src/types/index.ts` — UIMessage, UIToolCall, StreamCallbacks, and component prop interfaces per data-model.md Frontend-Only Types section
- [X] T008 Update ESLint config at `app/.eslintrc.js` to use `@typescript-eslint/parser`, add `@typescript-eslint/eslint-plugin`, replace `no-unused-vars` with `@typescript-eslint/no-unused-vars`, update file extensions to `ts,tsx`

**Checkpoint**: TypeScript compiles an empty `.tsx` file in `app/src/` without errors. ESLint parses `.tsx` files.

---

## Phase 3: User Story 1 — Frontend TypeScript Migration (Priority: P1)

**Goal**: Convert all 12 JS/JSX files in `app/src/` to TS/TSX with full type annotations

**Independent Test**: `npm run build` in `app/` completes with zero errors; `npm test` passes; dev server starts and all chat features work

### Utility Files (parallel — no interdependencies)

- [X] T009 [P] [US1] Convert `app/src/reportWebVitals.js` → `app/src/reportWebVitals.ts` — type the onPerfEntry callback parameter as `(entry: unknown) => void`
- [X] T010 [P] [US1] Convert `app/src/setupTests.js` → `app/src/setupTests.ts` — no type changes needed, rename only
- [X] T011 [P] [US1] Convert `app/src/fetch_message.js` → `app/src/fetch_message.ts` — type the module-level callback, message object shape, and exported functions

### API Client

- [X] T012 [US1] Convert `app/src/api.js` → `app/src/api.ts` — type all API functions with return types, use StreamCallbacks interface from `app/src/types/index.ts` for sendMessage callbacks, type SSE event parsing with discriminated union

### Components (bottom-up: leaf components first, then containers)

- [X] T013 [P] [US1] Convert `app/src/components/MessageBubble/MessageBubble.jsx` → `.tsx` — define MessageBubbleProps interface (message: UIMessage), type the component as `React.FC<MessageBubbleProps>`
- [X] T014 [P] [US1] Convert `app/src/components/MessageList/MessageList.jsx` → `.tsx` — define MessageListProps interface (messages: UIMessage[]), type useRef for scroll behavior
- [X] T015 [P] [US1] Convert `app/src/components/Sidebar/Sidebar.jsx` → `.tsx` — define SidebarProps interface (threads, activeThreadId, onSelectThread, onNewChat, onDeleteThread), type inline SVG components
- [X] T016 [US1] Convert `app/src/components/ChatInput/ChatInput.jsx` → `.tsx` — define ChatInputProps interface per data-model.md (14 props), type event handlers (onChange, onSubmit, onKeyDown), type refs
- [X] T017 [US1] Convert `app/src/components/ChatContainer/ChatContainer.js` → `.tsx` — define ChatContainerProps interface (activeThreadId, onThreadCreated, onThreadUpdated), type SpeechRecognition usage via speech.d.ts, type all useState hooks, type SSE event handlers using StreamCallbacks

### App Root and Entry

- [X] T018 [US1] Convert `app/src/App.js` → `app/src/App.tsx` — type thread state (Thread[]), activeThreadId (string | null), all handler functions (handleNewChat, handleSelectThread, handleDeleteThread, handleThreadCreated, handleThreadUpdated), type localStorage interactions
- [X] T019 [US1] Convert `app/src/index.js` → `app/src/index.tsx` — type ReactDOM.createRoot call
- [X] T020 [US1] Convert `app/src/App.test.js` → `app/src/App.test.tsx` — update import path, no test logic changes

### Verification

- [X] T021 [US1] Verify frontend build: run `npm run build` in `app/` — must complete with zero TypeScript errors
- [X] T022 [US1] Verify frontend tests: run `npm test` in `app/` — all existing tests must pass (SC-003)

**Checkpoint**: User Story 1 fully functional — all JS/JSX files converted, build passes, tests pass

---

## Phase 4: User Story 2 — Backend JavaScript Cleanup (Priority: P2)

**Goal**: Convert 2 remaining JS files, enable `strict: true`, remove `allowJs` compatibility

**Independent Test**: `npm run build` in `backend/` compiles with `allowJs: false` and `strict: true`; `npm test` passes

- [X] T023 [P] [US2] Convert `backend/jest.config.js` → `backend/jest.config.ts` — use `import type { Config } from 'jest'` and `export default` syntax
- [X] T024 [P] [US2] Convert `backend/scripts/google-auth.js` → `backend/scripts/google-auth.ts` — replace `require()` with ES imports, type googleapis OAuth2Client, type http server callbacks, type URL parsing
- [X] T025 [US2] Update `backend/tsconfig.json`: set `strict: true`, fix any strict-mode errors surfaced in existing TS files (implicit any, null checks)
- [X] T026 [US2] Update `backend/package.json` dev script: remove `.js` from `--ext ts,js` flag (change to `--ext ts` only)
- [X] T027 [US2] Verify backend build: run `npm run build` in `backend/` — must compile with zero errors
- [X] T028 [US2] Verify backend tests: run `npm test` in `backend/` — all existing tests must pass

**Checkpoint**: Backend is fully TypeScript with strict mode, no JS files remain except in node_modules

---

## Phase 5: User Story 3 — Shared Type Definitions (Priority: P3)

**Goal**: Create shared type definitions at repo root consumed by both projects via path aliases

**Independent Test**: Changing a field name in `shared/types/thread.ts` causes build failures in both `app/` and `backend/`

### Shared Types Creation (parallel — independent files)

- [X] T029 [P] [US3] Create `shared/types/thread.ts` with Thread, CreateThreadRequest, UpdateThreadRequest interfaces per data-model.md
- [X] T030 [P] [US3] Create `shared/types/message.ts` with Message, ContentBlock, TextBlock, ToolUseBlock, ToolCall types per data-model.md
- [X] T031 [P] [US3] Create `shared/types/events.ts` with SSEEvent discriminated union (MessageCreatedEvent, DeltaEvent, ToolUseStartEvent, ToolUseResultEvent, DoneEvent, ErrorEvent) per data-model.md
- [X] T032 [US3] Create `shared/types/index.ts` re-exporting all types from thread.ts, message.ts, events.ts

### Integration

- [X] T033 [US3] Add path alias `@shared/*` → `../shared/*` in `backend/tsconfig.json` (add `baseUrl` and `paths` fields)
- [X] T034 [US3] Update `app/src/api.ts` to import SSE event types from `@shared/types` instead of local definitions
- [X] T035 [US3] Update `app/src/types/index.ts` to import and re-export shared types, remove duplicated definitions
- [X] T036 [US3] Update backend `src/types/index.ts` to import and re-export from `@shared/types` where definitions overlap

### Verification

- [X] T037 [US3] Verify both builds pass: run `npm run build` in both `app/` and `backend/` with shared type imports
- [X] T038 [US3] Verify shared type safety: temporarily rename a field in `shared/types/thread.ts` and confirm both builds fail, then revert

**Checkpoint**: All user stories complete — shared types consumed by both projects

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, cleanup, and documentation updates

- [X] T039 [P] Compare post-migration frontend bundle size to T001 baseline — must be within 5% (SC-007)
- [X] T040 [P] Verify no JS/JSX files remain in `app/src/` — run `find app/src -name "*.js" -o -name "*.jsx"` and confirm empty result (SC-001)
- [X] T041 Update `app/package.json` lint script glob from `src/**/*.{js,jsx}` to `src/**/*.{ts,tsx}` and format script from `src/**/*.{js,jsx,css,md}` to `src/**/*.{ts,tsx,css,md}`
- [X] T042 Update `CLAUDE.md` to reflect TypeScript-only codebase: remove "Hybrid JS/TS" references, update frontend file references from .js/.jsx to .ts/.tsx, note shared types directory
- [ ] T043 Start frontend dev server (`npm start` in `app/`) and manually verify: send a message, observe streaming, test tool execution display, navigate sidebar, create/delete threads (SC-006)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — largest scope, do first
- **US2 (Phase 4)**: Depends on Phase 2 — can run in parallel with US1 (different directories)
- **US3 (Phase 5)**: Depends on US1 and US2 completion — needs both projects in TS before creating shared types
- **Polish (Phase 6)**: Depends on all user stories complete

### Within Each User Story

- Utility files before components (components may import utilities)
- Leaf components before container components (containers import children)
- API client before ChatContainer (ChatContainer imports api.ts)
- App root after all components (imports everything)
- Verification tasks are always last in each phase

### Parallel Opportunities

- T002 + T003: Independent dependency installs
- T005 + T006 + T007: Independent type declaration files
- T009 + T010 + T011: Independent utility file conversions
- T013 + T014 + T015: Independent leaf component conversions
- T023 + T024: Independent backend file conversions
- T029 + T030 + T031: Independent shared type files
- T039 + T040: Independent verification checks

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Build passes, tests pass, dev server works
5. Frontend is fully TypeScript — ship if backend/shared types can wait

### Incremental Delivery

1. Setup + Foundational → TS infrastructure ready
2. US1 (Frontend) → All frontend JS/JSX → TS/TSX (MVP!)
3. US2 (Backend) → Last 2 JS files → TS, strict mode enabled
4. US3 (Shared Types) → Cross-boundary type safety
5. Polish → Bundle size verified, docs updated, manual testing done

### Parallel Team Strategy

With two developers:

1. Both complete Setup + Foundational together
2. Once Foundational is done:
   - Developer A: US1 (Frontend — larger scope)
   - Developer B: US2 (Backend — smaller scope, done faster, then helps with US1)
3. Both collaborate on US3 (shared types touching both projects)
4. Polish together

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- No new test tasks — existing tests must pass per SC-003 and SC-004
- File renames should use `git mv` to preserve history
- Commit after each task or logical group per constitution Development Workflow
