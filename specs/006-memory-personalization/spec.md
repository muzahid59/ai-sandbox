# Feature Specification: Memory & Personalization

**Feature Branch**: `006-memory-personalization`
**Created**: 2026-07-27
**Status**: Draft
**Input**: Implement memory and personalization — the AI assistant can remember facts about the user across conversations, and users can manage those memories, set custom instructions, and configure personal preferences.

---

## Background & Problem Statement

Each conversation in the current app starts completely fresh. The AI has no knowledge of who the user is, their preferences, their ongoing projects, or anything they have mentioned in previous threads. This creates repetitive interactions where users must re-explain context every time.

Real auth (Phase 1.1) is now in place, so each user has a stable identity. This is the moment to layer on per-user memory and personalization:

- **Without memory**: Users must repeat context in every thread ("I'm a software engineer, I prefer TypeScript, my project uses Prisma…"). The AI cannot build on prior interactions.
- **Without personalization**: Every user gets the same default experience regardless of their communication style, preferred model, or expertise level.
- **Impact**: Users spend time on boilerplate instead of productive conversation. The assistant feels like a general tool rather than a personal one.

---

## Scope

**In scope:**
- A persistent memory store where facts about the user are saved and later injected into AI conversations
- Two creation paths: user explicitly adds a memory, or the AI extracts one automatically during a conversation
- A memory management UI where users can view, edit, and delete individual memories
- A "Custom Instructions" setting — a free-text block the user writes once that is prepended to every AI prompt
- Basic user preferences: preferred AI model, display name
- Memory injection into the conversation context so the AI references stored facts naturally

**Out of scope:**
- Memory shared between users or on a team/org level
- Automatic summarization or compaction of old memories (future)
- Semantic search across memories (future — initial version uses full context injection)
- Per-thread memory opt-out toggle (future)
- Memory versioning or audit trail (future)
- Onboarding flow that actively elicits user context on first login (future)

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — AI Extracts a Memory Automatically (Priority: P0)

During a conversation, the user mentions something significant about themselves (their job title, a recurring project name, a preference). The AI offers to save this as a memory. On the user's confirmation, it is stored and subsequently injected into future conversations.

**Why this priority**: Automatic extraction is the primary discovery mechanism — most users will not proactively create memories manually.

**Independent Test**: Send a chat message containing a clear personal fact (e.g. "I'm a backend engineer working in TypeScript"). Verify that after the response the backend has a new memory record associated with that user.

**Acceptance Scenarios**:

1. **Given** a user says "I'm a senior backend engineer", **When** the AI responds, **Then** a memory `"User is a senior backend engineer"` is saved to their profile without the user taking any additional action.
2. **Given** the AI extracts a memory during a conversation, **When** the user checks their memory list, **Then** the new memory appears with the date it was created and the source thread.
3. **Given** the AI extracts a memory the user considers wrong, **When** the user edits or deletes it from the memory list, **Then** the corrected or removed fact is used (or not used) in subsequent conversations.
4. **Given** the same fact is mentioned in multiple conversations (e.g. "I use TypeScript"), **When** memory extraction runs, **Then** a duplicate is not created — the existing memory is updated or the new extraction is skipped.

---

### User Story 2 — User Manually Adds a Memory (Priority: P1)

A user wants to proactively tell the assistant something without waiting for it to be extracted. They open the memory manager, write a fact, and save it.

**Why this priority**: Some users prefer explicit control over what the AI knows about them.

**Independent Test**: POST a new memory via the API with a specific content string; verify a subsequent AI response references it.

**Acceptance Scenarios**:

1. **Given** a user opens the memory manager and types "My main project is called Orion and uses Prisma + PostgreSQL", **When** they save it, **Then** it appears in their memory list immediately.
2. **Given** a user has saved a manual memory, **When** they start a new thread, **Then** the AI's first response demonstrates awareness of the stored fact without the user repeating it.
3. **Given** a user saves a memory with no content (empty string), **When** they submit, **Then** a validation error prevents saving and the user is told the memory cannot be blank.

---

### User Story 3 — Memories Are Injected Into Every Conversation (Priority: P0)

When a user sends any message in any thread, all their stored memories are included in the system context sent to the AI model. The AI responds as though it already knows those facts.

**Why this priority**: Injection is the payoff — without it, saved memories have no effect.

**Independent Test**: Create a user, save a memory "User prefers concise bullet-point answers", start a new thread, send an open-ended question; verify the AI's response is formatted as bullet points without the user asking.

**Acceptance Scenarios**:

1. **Given** a user has a stored memory "I work in London", **When** they ask "What time zone should I use for my standup?", **Then** the AI suggests a UK-appropriate time zone without the user specifying their location.
2. **Given** a user has no stored memories, **When** they start a conversation, **Then** no memory block is added to the context — behavior is identical to today.
3. **Given** a user has 20 stored memories, **When** an AI call is made, **Then** all memories are included in the system prompt and the AI call still completes within normal response time.
4. **Given** the memory list grows very large, **When** memory injection would exceed the model's context limit, **Then** the most recently updated memories take priority and older ones are trimmed — the user is not shown an error.

---

### User Story 4 — Custom Instructions (Priority: P1)

A user writes a persistent instruction block (e.g. "Always respond in Spanish", "Assume I know Python well — skip beginner explanations", "Format code with 4-space indentation"). This block is prepended to every system prompt.

**Why this priority**: Custom instructions are the highest-leverage personalization tool — one setting affects every interaction.

**Independent Test**: Set custom instructions to "Always respond in French", send an English message, verify the AI replies in French.

**Acceptance Scenarios**:

1. **Given** a user sets custom instructions to "Respond only in bullet points", **When** they ask any question in any thread, **Then** the AI formats every response as bullet points.
2. **Given** a user clears their custom instructions, **When** they start a new conversation, **Then** the AI uses no special formatting or behavior constraints.
3. **Given** custom instructions contain a conflict with an in-thread user message (e.g. instructions say "be brief" but user says "explain in detail"), **When** the AI responds, **Then** it follows the in-thread instruction (it takes precedence over the standing instruction).
4. **Given** a user saves custom instructions longer than 2,000 characters, **When** they submit, **Then** a validation error is shown and the instructions are not saved.

---

### User Story 5 — Memory Management UI (Priority: P1)

A user can open a dedicated view that lists all their saved memories. They can read each one, edit the content, and permanently delete individual entries.

**Why this priority**: Users must trust the system. Without visibility and control, they cannot correct wrong memories or remove sensitive ones.

**Independent Test**: Create 5 memories, open the manager, delete one, verify it no longer appears and is absent from the next AI call's context.

**Acceptance Scenarios**:

1. **Given** a user opens the memory manager, **When** they view it, **Then** all their memories are listed with content and creation date — most recent first.
2. **Given** a user clicks "Edit" on a memory, **When** they change the content and save, **Then** the updated text is used in subsequent AI calls.
3. **Given** a user clicks "Delete" on a memory, **When** they confirm the deletion, **Then** the memory is permanently removed and does not appear in future AI prompts.
4. **Given** a user has no memories, **When** they open the memory manager, **Then** they see an empty state with a prompt to either write one or start chatting.
5. **Given** a user has many memories (50+), **When** they open the manager, **Then** the list is paginated or scrollable — not truncated silently.

---

### User Story 6 — User Preferences (Priority: P2)

A user can set a display name and choose a default AI model. These preferences persist across sessions.

**Why this priority**: Display name personalizes the experience; model preference reduces per-session friction.

**Independent Test**: Set display name to "Alex", verify subsequent API responses greet the user as "Alex". Set default model to "google", start a new thread, verify thread creation defaults to the Google model.

**Acceptance Scenarios**:

1. **Given** a user sets their display name to "Alex", **When** the AI is primed with memory injection, **Then** the user is referred to as "Alex" in relevant AI responses.
2. **Given** a user sets a default AI model in preferences, **When** they create a new thread without explicitly picking a model, **Then** the thread uses their preferred model.
3. **Given** a user updates their display name, **When** they reload the app, **Then** the new name is shown in the UI without re-logging in.

---

## Functional Requirements *(mandatory)*

### Memory Storage

| ID | Requirement |
|----|-------------|
| FR-01 | The system must store memories as discrete text entries, each associated with exactly one user |
| FR-02 | Each memory must record: content (text), creation timestamp, last-updated timestamp, and source (manual or auto-extracted) |
| FR-03 | A user may have at most 200 active memories; attempts to add a 201st must be rejected with a clear message |
| FR-04 | Memory content must not exceed 500 characters per entry |
| FR-05 | Duplicate detection must prevent saving a memory with content substantially identical to an existing one for the same user |

### Memory Extraction

| ID | Requirement |
|----|-------------|
| FR-06 | After each AI response, the system must evaluate whether the conversation turn contains a new extractable personal fact |
| FR-07 | Extraction must not block or delay the streaming SSE response seen by the user |
| FR-08 | Extracted memories must be attributed to the source thread |

### Memory Injection

| ID | Requirement |
|----|-------------|
| FR-09 | All stored memories for the authenticated user must be included in the system prompt block sent to the AI model for every message |
| FR-10 | If the user has no memories, the memory block must be omitted entirely from the system prompt |
| FR-11 | When the total memory content would exceed a defined token budget, the most recently updated memories must be prioritised and older ones trimmed |
| FR-12 | Custom instructions, if set, must be prepended to the system prompt before the memory block |

### Memory Management API

| ID | Requirement |
|----|-------------|
| FR-13 | The system must provide endpoints to: list all memories for the authenticated user, create a memory, update a memory, delete a memory |
| FR-14 | All memory endpoints must require authentication and must return only the requesting user's data |
| FR-15 | Deletion must be permanent (no soft-delete for memories) |

### User Preferences API

| ID | Requirement |
|----|-------------|
| FR-16 | The system must store per-user preferences: display name (optional, max 100 chars), default AI model (enum), custom instructions (optional, max 2000 chars) |
| FR-17 | Preferences must be read and writable via a single user-preferences endpoint |
| FR-18 | Preferences must be initialised to sensible defaults on account creation and must not require explicit setup |

### Frontend

| ID | Requirement |
|----|-------------|
| FR-19 | The frontend must provide a Memory Manager view accessible from the sidebar or settings |
| FR-20 | The Memory Manager must support inline editing and deletion with a confirmation step for deletes |
| FR-21 | The frontend must provide a Settings panel for Custom Instructions and Preferences |
| FR-22 | New memories extracted automatically must be visible in the Memory Manager without a page refresh |

---

## Success Criteria *(mandatory)*

| # | Criterion | Measurement |
|---|-----------|-------------|
| SC-01 | Stored memories are reflected in AI responses without user repetition | Start a new thread after saving a memory; verify the AI references it in the first relevant response |
| SC-02 | Custom instructions apply to every thread | Set an instruction and open 3 different threads; verify consistent behavior across all 3 |
| SC-03 | Memory management operations complete without perceived delay | Create, edit, and delete operations each complete and reflect in the UI in under 2 seconds |
| SC-04 | Memory injection does not degrade AI response time | Compare time-to-first-token with 0 memories vs 50 memories; degradation must be under 500ms |
| SC-05 | Users can fully clear all memories and the AI reverts to blank-slate behavior | Delete all memories, send a follow-up on a prior topic; verify the AI has no knowledge of prior facts |
| SC-06 | No user's memories are visible to or injected into another user's context | Verify with two accounts: memories from account A never appear in account B's prompts |

---

## Key Entities *(mandatory)*

### Memory

| Field | Description |
|-------|-------------|
| `id` | UUID primary key |
| `userId` | Foreign key → User (owner) |
| `content` | Text of the remembered fact (max 500 chars) |
| `source` | Enum: `manual` (user-created) or `extracted` (AI-created) |
| `sourceThreadId` | Nullable FK → Thread; set when source is `extracted` |
| `createdAt` | Timestamp of first save |
| `updatedAt` | Timestamp of last edit |

### UserPreferences

| Field | Description |
|-------|-------------|
| `id` | UUID primary key |
| `userId` | Unique FK → User (one-to-one) |
| `displayName` | Optional custom name (max 100 chars) |
| `defaultModel` | Enum matching AI service types: `openai`, `google`, `deepseek`, `lama` |
| `customInstructions` | Optional free-text system prompt prefix (max 2000 chars) |
| `updatedAt` | Timestamp of last preference change |

---

## Dependencies *(mandatory)*

| Dependency | Type | Notes |
|------------|------|-------|
| 005-real-auth | Prerequisite (hard) | Memory is user-scoped — requires real user IDs; cannot be built without Phase 1.1 |
| Context Service (`contextService.ts`) | Integration | Memory injection must hook into the system prompt construction already performed by the context service |
| Agentic Loop (`toolExecutor.ts`) | Integration | Memory extraction runs after the final AI response is assembled; must not block SSE streaming |
| Prisma / PostgreSQL | Required | New `Memory` and `UserPreferences` tables require schema migrations |
| Frontend thread state | Compatible | No changes needed to thread/message state — memory is injected at the API layer |

---

## Assumptions *(mandatory)*

| # | Assumption |
|---|------------|
| A-01 | Memory extraction is done by a secondary AI call (or regex heuristics) after the primary response completes — not a synchronous part of the main response loop |
| A-02 | The initial implementation injects all memories as a flat list in the system prompt; semantic retrieval is a future optimisation |
| A-03 | The per-user cap of 200 memories is sufficient for Phase 2; the cap can be raised without a breaking schema change |
| A-04 | Custom instructions are trusted input from the user — no content moderation or safety filtering is applied to them in this phase |
| A-05 | `UserPreferences` is created with defaults when a user account is first created, so the preferences endpoint always returns a record (never 404) |
| A-06 | The existing `Thread` model's `model` field will be used as the default model if the user has no preference set |
| A-07 | Memories extracted from a deleted thread are retained — they describe the user, not the thread |

---

## Edge Cases *(optional)*

- **Memory extraction on tool-use responses**: If the AI's final response after a tool call contains a personal fact, extraction must still run on the assembled final text.
- **User deletes account**: All memories and preferences must be cascade-deleted when the user account is removed.
- **Custom instructions that break the AI**: A user who writes harmful or jailbreak-style custom instructions bears responsibility; the system logs such instructions but does not filter them in Phase 2.
- **Very long display name in AI prompt**: Display names injected into the system prompt are capped at 100 characters, which is within safe bounds for all supported models.
- **Concurrent edits to the same memory**: Last-write-wins; no optimistic locking needed at this scale.
- **Memory content in a language other than English**: Stored and injected verbatim — the AI handles multilingual content natively.
