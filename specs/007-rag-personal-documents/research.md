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

## 6. Retrieval Strategy — Hybrid Search

**Decision:** Hybrid retrieval combining semantic vector search (pgvector cosine similarity) and keyword search (PostgreSQL `ts_vector` full-text search), with Reciprocal Rank Fusion (RRF) to merge and re-rank results. Returns up to 10 chunks per query, scoped to the current thread's ready documents.

**Rationale:** FR-9 requires both semantic and keyword search with re-ranking. Pure vector search misses exact keyword matches (e.g., proper nouns, product codes, dates); pure keyword search misses semantic similarity. RRF is a simple, parameter-light fusion method: `score = Σ 1/(k + rank_i)` where k=60 is standard. PostgreSQL's built-in `tsvector`/`tsquery` with `ts_rank` provides keyword search without additional infrastructure.

**Implementation:**
1. Add a `search_vector tsvector` column to `document_chunks`, populated at chunk insertion time via `to_tsvector('english', content)`.
2. Create a GIN index on `search_vector` for fast full-text lookups.
3. At query time, run two parallel queries:
   - **Vector search:** `ORDER BY embedding <=> $query_embedding LIMIT 20`
   - **Keyword search:** `WHERE search_vector @@ plainto_tsquery('english', $query) ORDER BY ts_rank(search_vector, ...) DESC LIMIT 20`
4. Merge results using RRF (k=60), deduplicate by chunk ID, return top 10.
5. Apply a minimum relevance threshold (RRF score > 0.0) to exclude noise.

**Alternatives considered:**
- Pure vector search — Misses exact keyword matches; the spec explicitly requires hybrid.
- Inner product (`<#>`) — Requires normalized vectors; cosine distance is more forgiving.
- BM25 via `pg_bm25` extension — More accurate than `ts_rank` but requires an additional Postgres extension not available in the standard pgvector image.
- External search engine (Elasticsearch, Typesense) — Unnecessary infrastructure overhead when PostgreSQL full-text search is sufficient for this scale.
- Cohere Rerank / cross-encoder re-ranking — Better accuracy but adds API latency and cost; RRF is a pragmatic v1 choice.

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

---

## 9. Content Fingerprinting

**Decision:** Compute a SHA-256 hash of the raw file/URL content at upload time and store it on the Document record. Used for informational duplicate detection (FR-6d), not deduplication.

**Rationale:** Assumption 10 requires a content fingerprint for detecting when identical content is uploaded again, regardless of filename. SHA-256 is fast, collision-resistant, and available in Node's built-in `crypto` module — no new dependency. The hash is computed from the raw Buffer before text extraction and stored as a hex string (64 chars).

**Implementation:** `crypto.createHash('sha256').update(buffer).digest('hex')` — computed in the upload handler before dispatching to the document processor. For URL ingestion, hash the fetched response body.

**Alternatives considered:**
- MD5 — Faster but collision-prone; SHA-256 is negligibly slower for files ≤ 20 MB.
- Content-based deduplication (block upload if duplicate) — Spec explicitly says upload proceeds; fingerprint is informational only.
- Perceptual hashing — Only relevant for images/media, not text documents.

---

## 10. Embedding Model Versioning

**Decision:** Store the embedding model identifier (e.g., `text-embedding-3-small`) on each DocumentChunk record. This enables future model upgrades without requiring a bulk re-embed.

**Rationale:** Assumption 11 requires recording which model produced each chunk's vector. If the embedding model is upgraded later, new chunks use the new model while old chunks retain their version tag — enabling incremental migration or mixed-model retrieval strategies.

**Implementation:** A `embeddingModel` string field on DocumentChunk, set during the embedding step. Default value matches the configured embedding model.

**Alternatives considered:**
- Store model version at the Document level — Less granular; if a document is partially re-embedded, chunk-level tracking is more accurate.
- No versioning — Spec explicitly requires it (Assumption 11).

---

## 11. Observability Strategy

**Decision:** Use the existing pino structured logger to emit metric events at each pipeline stage. No separate metrics backend in this phase (Assumption 12).

**Rationale:** FR-16 requires tracking upload duration, extraction duration, embedding duration, retrieval latency, chunks retrieved, and embedding failures. Structured JSON logs with well-defined event types can be parsed by any log aggregation tool (ELK, Datadog, CloudWatch). Each pipeline stage logs a timing event with `{event, documentId, durationMs, ...metadata}`.

**Implementation:**
- Upload handler: log `document.upload` with `{documentId, fileSize, durationMs}`
- Text extraction: log `document.extract` with `{documentId, durationMs, charCount}`
- Embedding: log `document.embed` with `{documentId, durationMs, chunkCount, batchCount}`
- Embedding failure: log `document.embed.error` with `{documentId, attempt, error}`
- Retrieval: log `document.retrieve` with `{threadId, durationMs, chunksReturned, queryLength}`
- End-to-end: log `document.process.complete` or `document.process.failed`

**Alternatives considered:**
- Prometheus metrics — More structured but adds infrastructure (metrics server, scraper); overkill for single-user local dev.
- OpenTelemetry spans — Excellent for distributed tracing but requires an OTLP collector; deferred to a future phase.
