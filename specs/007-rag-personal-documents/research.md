# Research: RAG over Personal Documents (007)

## 1. Vector Storage — pgvector with Prisma

**Decision:** Use PostgreSQL `pgvector` extension with `Unsupported("vector(1536)")` in Prisma schema; all vector operations via `$queryRaw` / `$executeRaw`.

**Rationale:** Prisma v5.22.0 has no native vector column type. The `Unsupported(...)` annotation lets Prisma's migration tooling create the correct SQL column while vector reads/writes use raw SQL with the `pgvector` npm package for serialization. This keeps our ORM on the current version without introducing a separate vector database. The `pgvector/pgvector:pg16` Docker image is a drop-in replacement for `postgres:16-alpine`.

**Alternatives considered:**
- **Prisma v6 upgrade** — v6.13+ has early-access pgvector support, but the upgrade is too disruptive for a single feature.
- **Drizzle ORM** — Has native pgvector support but would require a full ORM migration.
- **Dedicated vector DB (Pinecone, Qdrant)** — Unnecessary operational overhead when PostgreSQL already hosts all our data and pgvector handles the scale we need (thousands, not millions of vectors).

---

## 2. Embedding Provider

**Decision:** Use OpenAI `text-embedding-3-small` (1536 dimensions, $0.02/M tokens) as primary; Ollama `nomic-embed-text` (768 dimensions) as local/offline alternative.

**Rationale:** `text-embedding-3-small` is 5× cheaper than `ada-002` and scores higher on MTEB benchmarks (62.3% vs 61.0%). It supports Matryoshka dimensionality reduction if storage becomes a concern. For local development, Ollama exposes `nomic-embed-text` via the OpenAI-compatible `/v1/embeddings` endpoint — this aligns with the project's existing Ollama integration on port 11434.

**Design implication:** The embedding service must accept a provider config to switch between OpenAI and Ollama. Vector dimensions differ (1536 vs 768), so the schema uses `vector(1536)` for OpenAI and the embedding service normalizes/pads if a different provider is used — or we fix on a single provider per deployment.

**Decision refinement:** Fix on OpenAI `text-embedding-3-small` at 1536 dimensions for v1. Ollama support is a follow-up configuration option. This avoids dimension-mismatch complexity in the initial implementation.

**Alternatives considered:**
- `text-embedding-3-large` (3072 dims) — overkill for personal-document RAG scale.
- Google embedding models — would add another API key dependency.

---

## 3. PDF Text Extraction

**Decision:** Use `pdf-parse` (v2.x).

**Rationale:** Simple, high-level API: `await pdf(buffer)` returns plain text. v2.4.5 is a TypeScript rewrite with zero native dependencies. 2M+ weekly npm downloads. It wraps `pdfjs-dist` internally but exposes the minimal surface we need — full text output from a buffer.

**Alternatives considered:**
- `pdfjs-dist` — More powerful but its page-by-page API is unnecessary complexity when we only need plain text.
- `unpdf` — Modern UnJS alternative (~200K weekly downloads) — viable but less battle-tested.
- Tesseract/OCR — Only needed for scanned image-based PDFs, which are explicitly out of scope per the spec.

---

## 4. Chunking Strategy

**Decision:** Fixed-size chunking at ~500 tokens with 50-token overlap, using a simple token-based splitter.

**Rationale:** The spec explicitly calls for "approximately 500 tokens with a 50-token overlap" (Assumption 6). This is a well-understood starting point that balances retrieval precision with context preservation. We'll implement a simple character-based splitter (1 token ≈ 4 chars → ~2000 chars per chunk, ~200 char overlap) using a sentence-boundary-aware split to avoid cutting mid-sentence.

**Alternatives considered:**
- `langchain` text splitters — Heavy dependency for a single utility. We'll implement our own.
- Semantic chunking — More accurate but significantly more complex and slower. Can be explored post-v1.
- `tiktoken` for exact token counting — Adds a dependency for marginal accuracy gain over character estimation.

---

## 5. File Upload Handling

**Decision:** Use `multer` for multipart file uploads with in-memory storage; extract text immediately, then discard the buffer.

**Rationale:** The spec requires that "raw file bytes are discarded immediately after text extraction" (FR-10). Using multer's `memoryStorage` keeps the file in a Buffer without touching disk. After text extraction, the buffer is dereferenced for garbage collection. The 20 MB limit (FR-6) is enforced at the multer level.

**Alternatives considered:**
- `busboy` directly — Lower-level, more control, but multer already wraps it with Express middleware integration.
- Disk storage + cleanup — Unnecessary complexity when in-memory processing is sufficient for 20 MB files.

---

## 6. Retrieval Strategy

**Decision:** Cosine similarity search via pgvector, returning top-5 chunks above a relevance threshold (0.7), scoped to the current thread's ready documents.

**Rationale:** pgvector's `<=>` operator (cosine distance) is the standard for text embedding similarity. Top-5 chunks at ~500 tokens each = ~2,500 tokens of context, well within model limits. The 0.7 threshold prevents low-relevance noise from contaminating responses. Thread scoping is enforced in the SQL WHERE clause (`WHERE document.thread_id = $1 AND document.status = 'ready'`).

**Alternatives considered:**
- Inner product (`<#>`) — Requires normalized vectors; cosine distance is more forgiving.
- No threshold, just top-K — Risks injecting irrelevant context that confuses the model.
- Hybrid search (BM25 + vector) — More accurate but significantly more complex for v1. Can layer in post-launch.

---

## 7. Async Document Processing

**Decision:** Process documents in-process using a background async function (not a job queue). Status tracked in the `Document` table.

**Rationale:** The application is single-user (or very low concurrency). A full job queue (Bull, BullMQ, Redis) is over-engineered for this scale. The upload endpoint returns immediately after creating the Document record with status `processing`; a fire-and-forget async function handles text extraction → chunking → embedding → status update. Failures are caught and recorded as `failed` status with a specific error message.

**Alternatives considered:**
- BullMQ with Redis — Robust but adds infrastructure (Redis) for a use case that doesn't need it yet.
- Worker threads — Unnecessary for I/O-bound work (embedding API calls, PDF parsing).

---

## 8. Thread Deletion Cascade

**Decision:** Add `onDelete: Cascade` from Thread → Document and Document → DocumentChunk in the Prisma schema. Extend the existing soft-delete flow to hard-delete documents when a thread is permanently removed.

**Rationale:** The spec requires "all documents attached to that thread are deleted along with it" (FR-5). Prisma's cascade delete handles this at the database level. The current `softDeleteThread` only sets status to `deleted` — documents should be hard-deleted (including their vector data) when the thread reaches terminal deletion. A separate cleanup step or a hard-delete path handles this.

**Design decision:** When a thread is soft-deleted, documents remain but are excluded from search (thread status check). When the thread is permanently purged (future admin action or background job), cascade delete removes documents and chunks via the DB constraint.
