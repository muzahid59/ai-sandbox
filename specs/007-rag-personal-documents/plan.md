# Implementation Plan: RAG over Personal Documents (007)

**Feature ID**: 007
**Status**: Ready for task generation
**Created**: 2026-07-29
**Spec**: [spec.md](spec.md)

---

## Technical Context

### Current Architecture

- **Backend**: Express.js + TypeScript (`backend/src/`), Prisma ORM v5.22.0, PostgreSQL 16
- **Frontend**: React 18 + TypeScript (`app/src/`), CSS Modules, prop-drilling state management
- **AI Integration**: Multi-provider via `ai_factory.js` (OpenAI, Google, DeepSeek, Ollama)
- **Tool System**: `ToolRegistry` singleton with Zod-validated tools, `toolExecutor.ts` agentic loop (max 10 iterations)
- **SSE Streaming**: `SSEWriter` utility, event types: `message_created`, `delta`, `tool_use_start`, `tool_use_result`, `done`, `error`
- **Auth**: JWT-based with hardcoded dev user middleware
- **Docker**: 4 services (frontend, backend, postgres:16-alpine, searxng)

### Key Integration Points

| Integration Point | File | What Changes |
|---|---|---|
| Prisma schema | `backend/prisma/schema.prisma` | Add Document, DocumentChunk models, enums |
| Docker postgres | `docker-compose.yml` | Swap to `pgvector/pgvector:pg16` |
| Thread model | `backend/prisma/schema.prisma` | Add `documents Document[]` relation |
| User model | `backend/prisma/schema.prisma` | Add `documents Document[]` relation |
| API routes | `backend/src/routes/` | New `documentRoutes.ts` |
| Tool registry | `backend/src/tools/index.ts` | Register `document_search` tool |
| Message handler | `backend/src/controllers/messageController.ts` | Add RAG context injection before AI call |
| SSE events | SSE stream | New event types: `document_search_start`, `document_search_result`, `document_search_empty` |
| Frontend | `app/src/` | New DocumentPanel, DocumentUpload components |

### Dependencies Introduced

| Package | Purpose | Size Impact |
|---------|---------|-------------|
| `pdf-parse` | PDF text extraction | ~1.2 MB (includes pdfjs-dist) |
| `pgvector` | Vector serialization for raw SQL | ~15 KB |
| `multer` | Multipart file upload middleware | ~50 KB |
| `@types/multer` | TypeScript definitions (dev) | — |

No new dependencies are needed for hybrid search (uses PostgreSQL built-in `tsvector`/`tsquery`), content fingerprinting (uses Node.js built-in `crypto`), or observability (uses existing `pino` logger).

---

## Constitution Check

### I. Code Quality (NON-NEGOTIABLE)
- ✅ All new code in TypeScript under `backend/src/`
- ✅ Each module has single responsibility (documentService, embeddingService, retrievalService, chunker, textExtractor, documentProcessor)
- ✅ Structured logging via pino for all document operations — including metric events at each pipeline stage (FR-16)
- ✅ No dead code or commented-out blocks
- ⚠️ **Raw SQL for vector and full-text search operations** — Required by Prisma v5 limitation. Encapsulated in `retrievalService.ts` to minimize surface area. Not a constitution violation — it's a technical constraint, not a quality choice.

### II. Testing Standards
- ✅ Unit tests for chunker, embedding service (mocked API), retrieval service
- ✅ Integration tests via supertest for all document endpoints
- ✅ SSE streaming tests for new event types
- ✅ Deterministic tests — embedding API mocked in tests, no external dependencies

### III. User Experience Consistency
- ✅ Document processing status visible (processing → ready → failed)
- ✅ Upload errors are actionable and non-technical
- ✅ CSS Modules for all new components
- ✅ Streaming feedback for document search during message response
- ✅ Document panel follows existing prop-drilling pattern

### IV. Performance Requirements
- ✅ Document endpoints < 200ms (excluding upload transfer time)
- ✅ HNSW + GIN indexes ensure hybrid search < 100ms for thousands of chunks
- ✅ Embedding service has timeout enforcement
- ✅ Query-time target: retrieval + generation streaming within 3 seconds (SC-8)
- ✅ No impact on existing context cache or bundle size budget

### Quality Gates
- ✅ Lint, Type, Test gates will be enforced
- ✅ SSRF protection reused from existing `fetchUrl.ts` — no new attack surface
- ✅ File validation at multer level prevents oversized uploads from consuming memory

---

## Phase 0: Research (Complete)

All unknowns resolved in [research.md](research.md):
- pgvector + Prisma: `Unsupported("vector(1536)")` + raw SQL
- Embedding: OpenAI `text-embedding-3-small` (1536 dims)
- PDF extraction: `pdf-parse` v2.x
- Chunking: ~500 tokens, 50-token overlap, sentence-boundary-aware
- Upload: `multer` in-memory storage, discard after extraction
- Retrieval: hybrid search (vector + keyword via `tsvector`), RRF re-ranking, top-10 chunks
- Processing: in-process async (no job queue), granular status stages
- Cascade: DB-level cascade delete via Prisma relations
- Content fingerprinting: SHA-256 hash for informational duplicate detection
- Embedding model versioning: model ID stored per chunk for incremental upgrades
- Observability: structured pino logs at each pipeline stage

---

## Phase 1: Design (Complete)

### Data Model

See [data-model.md](data-model.md). Two new models:
- **Document** — metadata, status, content fingerprint (SHA-256), thread-scoped ownership
- **DocumentChunk** — text segment + vector(1536) embedding + tsvector keyword index + embedding model version

### API Contracts

See [contracts/api.md](contracts/api.md). New endpoints:
- `POST /api/v1/threads/:threadId/documents` — upload file or ingest URL (includes content fingerprint duplicate notice)
- `GET /api/v1/threads/:threadId/documents` — list documents
- `GET /api/v1/threads/:threadId/documents/:documentId` — get document
- `DELETE /api/v1/threads/:threadId/documents/:documentId` — delete document
- `POST /api/v1/threads/:threadId/documents/:documentId/cancel` — cancel processing document
- `GET /api/v1/threads/:threadId/documents/check-duplicate` — duplicate filename check

New SSE events: `document_search_start`, `document_search_result`, `document_search_empty`

New tool: `document_search` (internal, called by agentic loop)

---

## Phase 2: Implementation Plan

### Layer 1: Infrastructure & Data Layer

**Goal:** pgvector enabled, schema migrated, basic CRUD operations working.

#### 1.1 Docker — Enable pgvector
- Swap `postgres:16-alpine` → `pgvector/pgvector:pg16` in `docker-compose.yml`
- Verify the extension loads on container start

#### 1.2 Prisma Schema — Add Document and DocumentChunk models
- Add `DocumentSourceType` and `DocumentStatus` enums (status includes granular stages: `processing`, `extracting`, `chunking`, `embedding`, `ready`, `failed`, `cancelled`)
- Add `Document` model with all fields per data-model.md, including `contentFingerprint` (SHA-256 hex, 64 chars)
- Add `DocumentChunk` model with `Unsupported("vector(1536)")` embedding field, `Unsupported("tsvector")` search vector, and `embeddingModel` string
- Add `documents Document[]` relation to Thread and User models
- Run `npx prisma migrate dev --name add-documents-and-chunks`
- Add raw SQL to migration for: `CREATE EXTENSION IF NOT EXISTS vector;`, HNSW index on embeddings, and GIN index on search vectors

#### 1.3 Document Service — CRUD operations
- Create `backend/src/services/documentService.ts`
- `createDocument(threadId, userId, title, sourceType, mimeType, fileSize, contentFingerprint)` → inserts Document with status `processing`
- `listDocuments(threadId)` → returns documents for a thread
- `getDocument(threadId, documentId)` → single document with ownership check
- `deleteDocument(threadId, documentId)` → hard delete (cascades to chunks)
- `cancelDocument(threadId, documentId)` → sets status to `cancelled`, deletes any partial chunks
- `updateDocumentStatus(id, status, statusMessage?, chunkCount?)` → status transitions (granular stages)
- `checkDuplicateFilename(threadId, filename)` → duplicate check for FR-6c
- `checkDuplicateFingerprint(threadId, fingerprint)` → content fingerprint match for FR-6d

### Layer 2: Document Processing Pipeline

**Goal:** Upload → extract text → chunk → embed → store chunks.

#### 2.1 Text Extraction
- Create `backend/src/services/textExtractor.ts`
- `extractFromPdf(buffer: Buffer): Promise<string>` — uses `pdf-parse`
- `extractFromText(buffer: Buffer): Promise<string>` — UTF-8 decode
- `extractFromUrl(url: string): Promise<{text: string, title: string}>` — reuse SSRF protection from `fetchUrl.ts`, use `html-to-text` for conversion
- Dispatch by MIME type; throw typed errors for unsupported formats, password-protected PDFs, corrupt files

#### 2.2 Text Chunker
- Create `backend/src/services/textChunker.ts`
- `chunkText(text: string, options?: {chunkSize?: number, overlap?: number}): Chunk[]`
- Default: ~2000 chars per chunk (~500 tokens), ~200 char overlap (~50 tokens)
- Split at sentence boundaries (`. `, `? `, `! `, newlines) to avoid mid-sentence breaks
- Return `{content: string, index: number, tokenCount: number}[]`

#### 2.3 Embedding Service
- Create `backend/src/services/embeddingService.ts`
- `embedTexts(texts: string[]): Promise<number[][]>` — batch embed via OpenAI `text-embedding-3-small`
- Use the existing `openai` npm package (already installed)
- Batch up to 100 texts per API call (OpenAI limit)
- Retry up to 3 times with exponential backoff on API errors
- Timeout enforcement (30s per batch)

#### 2.4 Document Processor — Orchestrator
- Create `backend/src/services/documentProcessor.ts`
- `processDocument(documentId: string, content: Buffer | string, mimeType: string): Promise<void>`
- Pipeline with granular status updates and cancellation check at each stage:
  1. Set status `extracting` → extract text → log `document.extract` metric
  2. Check cancellation flag → set status `chunking` → chunk text → log `document.chunk` metric
  3. Check cancellation flag → set status `embedding` → embed (batched) → log `document.embed` metric
  4. Store chunks via raw SQL → update document status to `ready` → log `document.process.complete`
- On failure: update status to `failed` with specific error message per cause → log `document.process.failed`
- On cancellation: abort pipeline, delete any partial chunks, set status `cancelled`
- Chunk storage uses `$executeRaw` with pgvector serialization: `INSERT INTO document_chunks (id, document_id, chunk_index, content, token_count, embedding, search_vector, embedding_model) VALUES ...`
- `search_vector` populated via `to_tsvector('english', content)` in the INSERT statement
- `embedding_model` set to the configured model identifier (e.g., `text-embedding-3-small`)

### Layer 3: Retrieval & AI Integration

**Goal:** Vector search integrated into the agentic loop as a tool.

#### 3.1 Retrieval Service — Hybrid Search
- Create `backend/src/services/retrievalService.ts`
- `searchDocuments(threadId: string, query: string, topK?: number): Promise<SearchResult[]>`
- Hybrid retrieval pipeline:
  1. Embed the query using `embeddingService`
  2. **Vector search** (raw SQL): `SELECT id, ... 1 - (embedding <=> $query_embedding) AS vector_score FROM document_chunks dc JOIN documents d ON dc.document_id = d.id WHERE d.thread_id = $1 AND d.status = 'ready' ORDER BY dc.embedding <=> $2 LIMIT 20`
  3. **Keyword search** (raw SQL): `SELECT id, ... ts_rank(search_vector, query) AS keyword_score FROM document_chunks dc JOIN documents d ON dc.document_id = d.id WHERE d.thread_id = $1 AND d.status = 'ready' AND dc.search_vector @@ plainto_tsquery('english', $2) ORDER BY keyword_score DESC LIMIT 20`
  4. **Merge with RRF**: `score = 1/(60 + vector_rank) + 1/(60 + keyword_rank)` — deduplicate by chunk ID
  5. Return top 10 (configurable via `topK`, default 10) sorted by RRF score
- Log `document.retrieve` metric with `{threadId, durationMs, chunksReturned, queryLength}`
- Return: `{documentId, documentTitle, chunkIndex, content, relevanceScore}[]`

#### 3.2 Document Search Tool
- Create `backend/src/tools/documentSearch.ts`
- Export `definition` (ToolDefinition) and `handler` (async function)
- The handler receives `{query: string}`, calls `retrievalService.searchDocuments` with the current thread's ID
- Format results as text with source attribution: `[Source: filename.pdf, chunk N]\n{content}`
- Register in `backend/src/tools/index.ts`
- The tool needs `threadId` context — pass via tool execution context (extend ToolRegistry to support context injection)

#### 3.3 Message Flow Integration
- Modify `backend/src/controllers/messageController.ts`:
  - Before calling the agentic loop, check if the thread has any `ready` documents
  - If yes, include `document_search` tool in the tool definitions passed to the agentic loop
  - Emit `document_search_start` SSE event when the tool is invoked
  - Emit `document_search_result` SSE event with source details after tool execution
  - If the tool finds nothing, emit `document_search_empty`
- The AI model decides when to call the tool based on the user's message — no forced invocation

### Layer 4: API Endpoints

**Goal:** REST endpoints for document CRUD + file upload.

#### 4.1 Upload Middleware
- Create `backend/src/middleware/upload.ts`
- Configure `multer` with `memoryStorage()`, 20 MB limit, MIME type filter (PDF, text/plain, text/markdown)
- Export as Express middleware

#### 4.2 Document Controller
- Create `backend/src/controllers/documentController.ts`
- `handleUploadDocument` — validate, compute SHA-256 fingerprint, check for content fingerprint duplicate (FR-6d), create Document record, fire-and-forget `processDocument`, return 201 with optional `duplicateNotice`
- `handleIngestUrl` — validate URL, fetch content (with SSRF check), compute fingerprint, create Document, process
- `handleListDocuments` — delegate to `documentService.listDocuments`
- `handleGetDocument` — delegate to `documentService.getDocument`
- `handleDeleteDocument` — delegate to `documentService.deleteDocument`
- `handleCancelDocument` — verify document is in a processing state, delegate to `documentService.cancelDocument`
- `handleCheckDuplicate` — delegate to `documentService.checkDuplicateFilename`

#### 4.3 Document Routes
- Create `backend/src/routes/documentRoutes.ts`
- Mount under `/api/v1/threads/:threadId/documents`
- Routes: POST (upload/URL), GET (list), GET /:documentId, DELETE /:documentId, POST /:documentId/cancel, GET /check-duplicate
- Wire all handlers with appropriate middleware (auth, upload)
- Register in `backend/src/server.ts` (or wherever routes are mounted)

### Layer 5: Frontend

**Goal:** Upload UI, document panel, source citations in messages.

#### 5.1 API Client Extensions
- Add to `app/src/api.ts`:
  - `uploadDocument(threadId, file)` — FormData POST
  - `ingestUrl(threadId, url)` — JSON POST
  - `listDocuments(threadId)` — GET
  - `deleteDocument(threadId, documentId)` — DELETE
  - `cancelDocument(threadId, documentId)` — POST
  - `checkDuplicate(threadId, filename)` — GET

#### 5.2 Types
- Add to `shared/types/`:
  - `Document` interface (id, title, sourceType, mimeType, fileSize, contentFingerprint, status, statusMessage, chunkCount, createdAt, duplicateNotice?)
  - `DocumentStatus` type: `'processing' | 'extracting' | 'chunking' | 'embedding' | 'ready' | 'failed' | 'cancelled'`
  - `DocumentSearchResult` interface (documentId, documentTitle, chunkIndex, relevanceScore, snippet)
  - `DuplicateNotice` interface (matchedDocumentId, matchedDocumentTitle, message)
  - New SSE event types: `DocumentSearchStartEvent`, `DocumentSearchResultEvent`, `DocumentSearchEmptyEvent`

#### 5.3 Document Panel Component
- Create `app/src/components/DocumentPanel.tsx` + `DocumentPanel.module.css`
- Shows list of documents for the active thread
- Each document shows: title, granular status badge (extracting/chunking/embedding/ready/failed/cancelled), file size, delete button
- Cancel button visible on documents in processing states (processing/extracting/chunking/embedding)
- Polls for status updates on processing documents (every 3s until `ready`, `failed`, or `cancelled`)
- Content fingerprint duplicate notice shown as a non-blocking toast when `duplicateNotice` is present in the upload response
- Empty state: "No documents uploaded. Upload a file to ask questions about it."

#### 5.4 Document Upload Component
- Create `app/src/components/DocumentUpload.tsx` + `DocumentUpload.module.css`
- Upload button with file picker (accepts .pdf, .txt, .md)
- URL input field for URL ingestion
- Drag-and-drop zone (optional, nice-to-have)
- Duplicate filename confirmation dialog (calls check-duplicate endpoint)
- Progress indicator during upload
- Error display for rejected files (size, format)

#### 5.5 Source Citations in Messages
- Modify `app/src/components/MessageBubble.tsx`:
  - Parse `document_search_result` SSE events
  - Display source citations below the message content
  - Each citation shows document title and relevance indicator
  - Collapsible section: "Sources used (N documents)"

#### 5.6 Chat Container Integration
- Modify `app/src/components/ChatContainer.tsx`:
  - Add DocumentPanel to the layout (right sidebar or collapsible panel)
  - Handle `document_search_*` SSE events in the streaming handler
  - Pass document state down as props

### Layer 6: Testing

#### 6.1 Backend Unit Tests
- `backend/tests/services/textChunker.test.ts` — chunking logic, edge cases (empty text, single sentence, very long text)
- `backend/tests/services/embeddingService.test.ts` — mocked OpenAI calls, retry logic, batch handling
- `backend/tests/services/documentProcessor.test.ts` — full pipeline with mocks, failure scenarios, cancellation mid-pipeline, granular status transitions
- `backend/tests/services/retrievalService.test.ts` — hybrid search (vector + keyword), RRF merging, deduplication, result formatting

#### 6.2 Backend Integration Tests
- `backend/tests/api/documents.test.ts`:
  - Upload file → 201 + correct metadata + contentFingerprint
  - Upload duplicate content → 201 + duplicateNotice present
  - Upload oversized file → 400
  - Upload unsupported format → 400
  - Ingest URL → 201
  - Ingest private IP URL → 403
  - List documents → 200 + correct list
  - Delete document → 204
  - Delete non-existent → 404
  - Cancel processing document → 200
  - Cancel non-processing document → 409
  - Cross-thread access blocked → 404
  - Thread deletion cascades to documents
  - Document status transitions through granular stages

#### 6.3 Frontend Tests
- `app/src/components/DocumentPanel.test.tsx` — renders documents, granular status badges, cancel button, delete action
- `app/src/components/DocumentUpload.test.tsx` — file selection, validation, error display, duplicate fingerprint notice

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Frontend (React)                           │
│                                                                     │
│  ┌──────────────┐  ┌─────────────────┐  ┌───────────────────────┐  │
│  │ DocumentPanel │  │ DocumentUpload  │  │ MessageBubble         │  │
│  │ (list+status) │  │ (file/URL)      │  │ (+ source citations)  │  │
│  └──────┬───────┘  └────────┬────────┘  └───────────┬───────────┘  │
│         │                   │                       │               │
│         └───────────────────┼───────────────────────┘               │
│                             │ api.ts                                │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   Express Router   │
                    │  /api/v1/threads/  │
                    │  :id/documents    │
                    └─────────┬─────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
  ┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼──────┐
  │  Document     │  │  Message      │  │  Document    │
  │  Controller   │  │  Controller   │  │  Controller  │
  │  (CRUD)       │  │  (+ RAG)      │  │  (upload)    │
  └───────┬───────┘  └───────┬───────┘  └───────┬──────┘
          │                  │                   │
          │          ┌───────▼───────┐           │
          │          │  Agentic Loop │           │
          │          │  (toolExec)   │           │
          │          └───────┬───────┘           │
          │                  │                   │
  ┌───────▼───────┐  ┌──────▼────────┐  ┌──────▼──────────┐
  │  Document     │  │  Retrieval    │  │  Document       │
  │  Service      │  │  Service      │  │  Processor      │
  │  (CRUD ops)   │  │  (vector      │  │  (extract →     │
  │               │  │   search)     │  │   chunk → embed)│
  └───────┬───────┘  └──────┬────────┘  └──────┬──────────┘
          │                 │                   │
          │          ┌──────▼────────┐  ┌──────▼──────────┐
          │          │  Embedding    │  │  Text Extractor │
          │          │  Service      │  │  (pdf-parse,    │
          │          │  (OpenAI)     │  │   html-to-text) │
          │          └──────┬────────┘  └─────────────────┘
          │                 │
  ┌───────▼─────────────────▼───────┐
  │        PostgreSQL + pgvector     │
  │  ┌────────────┐ ┌─────────────┐ │
  │  │  documents  │ │ doc_chunks  │ │
  │  │  (metadata) │ │ (text +     │ │
  │  │             │ │  embedding) │ │
  │  └────────────┘ └─────────────┘ │
  └─────────────────────────────────┘
```

---

## Implementation Order

The layers should be implemented in order (1 → 6), as each depends on the previous:

1. **Infrastructure** (Docker + schema) — foundation, no dependencies
2. **Processing pipeline** (extract → chunk → embed) — depends on schema
3. **Retrieval + AI integration** (vector search + tool) — depends on processing pipeline
4. **API endpoints** (REST + upload) — depends on services
5. **Frontend** (UI components) — depends on API
6. **Testing** — can be written alongside each layer (TDD encouraged)

Total estimated new files: ~15 backend, ~6 frontend, ~6 test files.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| pgvector HNSW index slow for small datasets | Low — HNSW is optimized for large datasets | Use flat scan for < 1000 chunks; switch to HNSW above that |
| Embedding API rate limits | Medium — batch processing may hit limits | Implement exponential backoff; batch at 100 texts/call |
| Large PDF text extraction OOM | Low — 20 MB limit protects against this | multer memory limit + process.memoryUsage() monitoring |
| Prisma raw SQL maintenance burden | Low — ~5 raw queries total (vector + keyword search, chunk insert) | Encapsulate all raw SQL in retrievalService.ts and documentProcessor.ts |
| Frontend bundle size from pdf-parse | N/A — pdf-parse is backend-only | No frontend impact |
| Hybrid search RRF tuning | Low — k=60 is a well-studied default | Log both vector and keyword scores for tuning analysis |
| Cancellation race condition | Low — processor checks cancellation between stages | Flag-based check before each pipeline stage; partial chunks cleaned up atomically |

---

## Generated Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Feature spec | `specs/007-rag-personal-documents/spec.md` | ✅ Complete |
| Research | `specs/007-rag-personal-documents/research.md` | ✅ Complete |
| Data model | `specs/007-rag-personal-documents/data-model.md` | ✅ Complete |
| API contracts | `specs/007-rag-personal-documents/contracts/api.md` | ✅ Complete |
| Quickstart | `specs/007-rag-personal-documents/quickstart.md` | ✅ Complete |
| Implementation plan | `specs/007-rag-personal-documents/plan.md` | ✅ This file |
