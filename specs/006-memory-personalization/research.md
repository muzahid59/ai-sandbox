# Research: Memory & Personalization

## §1 — Memory Extraction: Secondary AI Call vs Regex Heuristics

**Decision**: Secondary AI call (fire-and-forget after SSE stream closes), using the same provider/model as the conversation thread.

**Rationale**: Regex patterns miss nuanced personal facts (e.g. "I mainly work on Orion, our internal billing platform" — no keyword reliably captures this). A secondary AI call with a structured extraction prompt produces higher-quality, concise fact strings. Runs asynchronously after `writer.end()` so it never blocks the streaming response seen by the user.

**Alternatives considered**: Regex/keyword matching — rejected; low recall on naturally phrased statements. Embedding-based extraction — requires a new dependency and model, disproportionate complexity for Phase 2.

---

## §2 — Duplicate Detection: Word-Overlap Jaccard Similarity

**Decision**: Normalize both candidate and existing memory content (lowercase, strip punctuation, split on whitespace), compute Jaccard similarity over word sets; if any existing memory scores ≥ 0.75, skip the candidate.

**Rationale**: Handles common rewording ("I'm a backend engineer" vs "I am a backend engineer") without requiring an external library. Pure JS, deterministic, and stays within the 500-char content cap where small sets converge quickly. Threshold of 0.75 allows minor phrasing differences while blocking near-duplicates.

**Alternatives considered**: Exact string match — rejects too many legitimate rewrites (missed de-dupe). Cosine similarity on TF-IDF vectors — more accurate but adds implementation overhead. Semantic embeddings (OpenAI Embeddings API) — best accuracy but adds a network round trip and API cost per extraction; deferred to future.

---

## §3 — Memory Injection Placement in System Prompt

**Decision**: Prepend custom instructions + memory block to the system prompt string returned by `getSystemPrompt()` inside `chatService.processMessage()`. Memory block format:

```
{customInstructions}

[WHAT YOU KNOW ABOUT THE USER]
- {memory content}
- {memory content}

---

{baseSystemPrompt}
```

Custom instructions appear first (highest precedence). Memory block follows. Base system prompt is last.

**Rationale**: `chatService.processMessage` is the single point where the system prompt is assembled before passing to the agentic loop. Injecting here requires touching one file and does not change the `ContextService`, `ToolExecutor`, or any provider. The format uses a clear section header so the AI treats memories as background knowledge, not instructions.

**Alternatives considered**: Injecting into `ContextService.buildContextWindow` as a pseudo-system message — rejected; the context service handles message history, not static session context. Injecting at the route handler level — too early, before provider selection.

---

## §4 — Memory Token Budget

**Decision**: Reserve 2,000 tokens for the combined custom-instructions + memory block. Sort memories by `updatedAt DESC`; if the block would exceed budget, trim oldest memories until it fits. Custom instructions always included (capped at 2,000 chars ≈ ~500 tokens; safe within budget).

**Rationale**: The context service already reserves 4,096 tokens for completion headroom. Adding 2,000 for memory leaves ~93,000 tokens for conversation at the default 100k budget. 2,000 tokens ≈ 1,500 words, comfortably fitting 50+ typical memory entries. Recency bias (most recently updated = most relevant) aligns with expected usage patterns.

---

## §5 — UserPreferences Initialization

**Decision**: Create `UserPreferences` record with defaults inside `authService.register()` using `prisma.$transaction([user.create, preferences.create])`. Defaults: `defaultModel: null`, `customInstructions: null`.

**Rationale**: A-05 (preferences endpoint always returns a record) is best guaranteed at registration time. A database transaction ensures the `User` and `UserPreferences` rows are created atomically — no partial state. The preferences GET endpoint never needs to handle a missing record.

**Alternatives considered**: Lazy creation on first GET request — adds branching logic in the GET handler and risks a race on concurrent requests. Prisma `upsert` on every GET — wastes a write on every read.

---

## §6 — Display Name: Use Existing `User.displayName`

**Decision**: The `UserPreferences` table does NOT add a second `displayName` column. Display name preference is stored in and read from the existing `User.displayName` field. The preferences PATCH endpoint updates `User.displayName` directly.

**Rationale**: `User.displayName` already exists in the schema (added in feature 004). Duplicating it in `UserPreferences` violates the constitution's single-responsibility principle and creates a synchronisation problem. The AI personalization use case (inject "User's name is Alex" into the system prompt) reads the same field.

---

## §7 — Default Model on Thread Creation

**Decision**: Make `model` optional in `POST /api/v1/threads`. If omitted, read `UserPreferences.defaultModel`; if also null, fall back to `"openai"`. Existing callers that supply `model` are unaffected.

**Rationale**: User Story 6 acceptance criterion 2 requires threads to default to the user's preferred model. Making `model` optional in the route handler (with Zod `.optional()`) is the minimal change to `threadRoutes.ts` and `threadController.ts`. No schema change needed on `Thread.model` (it remains a required String in the DB; we just compute the value before creating the record).

---

## §8 — Frontend Memory Refresh Strategy

**Decision**: After the SSE `done` event is received, if the Memory Manager component is mounted, dispatch an in-app event (custom React event or `useState` version counter) that triggers a memory list re-fetch.

**Rationale**: Memory extraction runs asynchronously after `writer.end()`, so the result is not available inside the SSE stream. A single GET request per conversation turn is lightweight (small payload, fast query). WebSocket or persistent SSE infrastructure would be disproportionate for Phase 2. The re-fetch is only triggered when the Memory Manager is visible — no polling overhead otherwise.

**Alternatives considered**: Polling interval — wastes requests when no conversation is active. New SSE event type for extraction result — requires keeping the SSE stream open longer than needed, complicating error handling. Server-Sent Events on a dedicated `/events` endpoint (persistent) — deferred to future.

---

## §9 — Memory Extraction Prompt

**Decision**: Use a tight structured prompt that requests JSON-only output:

```
You are a memory extraction assistant. Analyze the conversation turn below and identify any personal facts about the user that are worth remembering for future conversations.

Return ONLY a valid JSON array of strings. Each string must be a single, concise, third-person fact about the user (e.g. "User is a senior backend engineer working primarily in TypeScript"). Return an empty array [] if there are no memorable facts.

Do not include: opinions, questions, generic statements, facts about the world, or anything not specific to the user.

User message: {userMessage}
Assistant reply: {aiResponse}
```

**Rationale**: JSON-only output is easy to parse with `JSON.parse()`. Third-person framing ("User is…") produces a consistent injection format. Explicit exclusions reduce noise from general chat messages.
