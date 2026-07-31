# Tasks: RAG over Personal Documents

**Feature Branch**: `007-rag-personal-documents`
**Spec**: `specs/007-rag-personal-documents/spec.md`
**Plan**: `specs/007-rag-personal-documents/plan.md`
**Generated**: 2026-07-31

---

## User Stories

| ID | Story | Priority | Description |
|----|-------|----------|-------------|
| US1 | Upload and Query | P1 | Upload a file, process it, and ask questions answered from its content with source citations |
| US2 | URL Ingestion | P2 | Ingest a web page URL as a document and query it like a file |
| US3 | Document Management Panel | P3 | View, monitor granular processing status, cancel processing, and delete documents |
| US4 | Source Citations | P4 | Display which documents the assistant drew from in its response |
| US5 | Validation & Duplicates | P5 | Reject invalid uploads with clear errors; detect duplicate filenames and content fingerprints |

---

## Phase 1: Setup

**Goal**: Install new dependencies and swap the PostgreSQL Docker image to enable pgvector.

**Independent test**: `docker-compose build postgres` succeeds. `cd backend && npm ls pdf-parse pgvector multer` shows all three installed.

- [x] T001 [P] Install backend dependencies: `cd backend && npm install pdf-parse pgvector multer && npm install -D @types/multer` in backend/package.json
- [x] T002 [P] Swap PostgreSQL Docker image from `postgres:16-alpine` to `pgvector/pgvector:pg16` in docker-compose.yml

---

## Phase 2: Foundational

**Goal**: Database schema with vector support, core services that all user stories depend on, shared types, and unit tests for foundational services. Must complete before any user story phase begins.

**Independent test**: `npx prisma migrate status` shows no pending migrations. `npx prisma generate` exits clean. `npm run build` and `npm test` in `backend/` pass. Shared types import without error.

- [x] T003 Add `DocumentSourceType` enum (`file`, `url`), `DocumentStatus` enum (`processing`, `extracting`, `chunking`, `embedding`, `ready`, `failed`, `cancelled`), `Document` model (id UUID PK, threadId FK->Thread cascade, userId FK->User cascade, title VarChar(255), sourceType, sourceUrl nullable VarChar(2048), mimeType VarChar(127), fileSize Int, contentFingerprint Char(64), status default `processing`, statusMessage nullable VarChar(500), chunkCount default 0, createdAt, updatedAt, `@@index([threadId, status])`, `@@index([threadId, contentFingerprint])`, `@@index([userId])`, `@@map("documents")`), and `DocumentChunk` model (id UUID PK, documentId FK->Document cascade, chunkIndex Int, content Text, tokenCount Int, embedding `Unsupported("vector(1536)")?`, searchVector `Unsupported("tsvector")?` mapped to `search_vector`, embeddingModel VarChar(100), createdAt, `@@index([documentId])`, `@@map("document_chunks")`) to backend/prisma/schema.prisma
- [x] T004 Add `documents Document[]` relation to `Thread` and `User` models in backend/prisma/schema.prisma; create migration with `npx prisma migrate dev --name add-documents-and-chunks`; prepend `CREATE EXTENSION IF NOT EXISTS vector;` and append HNSW index `CREATE INDEX idx_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);` and GIN index `CREATE INDEX idx_document_chunks_search_vector ON document_chunks USING gin (search_vector);` as raw SQL in the generated migration file
- [x] T005 [P] Create text chunker service in backend/src/services/textChunker.ts: export `chunkText(text: string, options?: {chunkSize?: number, overlap?: number}): Chunk[]` with defaults ~2000 chars per chunk (~500 tokens), ~200 char overlap (~50 tokens); split at sentence boundaries (`. `, `? `, `! `, newlines); return `{content: string, index: number, tokenCount: number}[]` with token count estimated as `Math.ceil(content.length / 4)`
- [x] T006 [P] Create embedding service in backend/src/services/embeddingService.ts: export `embedTexts(texts: string[]): Promise<number[][]>` using OpenAI `text-embedding-3-small` (1536 dims) via the existing `openai` npm package; batch up to 100 texts per API call; retry up to 3 times with exponential backoff on API errors; enforce 30s timeout per batch; read API key from `process.env.OPENAI_API_KEY`
- [x] T007 [P] Add shared types in shared/types/: `Document` interface (id, threadId, title, sourceType, mimeType, fileSize, contentFingerprint, status, statusMessage, chunkCount, createdAt, duplicateNotice?), `DocumentStatus` type (`'processing' | 'extracting' | 'chunking' | 'embedding' | 'ready' | 'failed' | 'cancelled'`), `DocumentSourceType` type, `DocumentSearchResult` interface (documentId, documentTitle, chunkIndex, relevanceScore, snippet), `DuplicateNotice` interface (matchedDocumentId, matchedDocumentTitle, message), and SSE event types `DocumentSearchStartEvent`, `DocumentSearchResultEvent` (with sources array), `DocumentSearchEmptyEvent`
- [x] T008 Create document service in backend/src/services/documentService.ts: export `createDocument(threadId, userId, title, sourceType, mimeType, fileSize, contentFingerprint)` -> insert with status `processing`; `listDocuments(threadId)` -> return documents for thread; `getDocument(threadId, documentId)` -> single document with ownership check; `deleteDocument(threadId, documentId)` -> hard delete (cascades to chunks); `cancelDocument(threadId, documentId)` -> verify document is in processing state, set status `cancelled`, delete any partial chunks; `updateDocumentStatus(id, status, statusMessage?, chunkCount?)` -> status transitions; `checkDuplicateFilename(threadId, filename)` -> boolean duplicate check; `checkDuplicateFingerprint(threadId, fingerprint)` -> find document with matching content fingerprint; `hasReadyDocuments(threadId)` -> boolean check for any ready documents
- [x] T009 [P] Create unit tests for text chunker in backend/tests/services/textChunker.test.ts: chunking at sentence boundaries produces clean splits; empty text returns empty array; single sentence shorter than chunk size produces one chunk; overlap preserves context across chunk boundaries; very long text produces correct chunk count with expected overlap; token count estimation matches `Math.ceil(content.length / 4)`
- [x] T010 [P] Create unit tests for embedding service in backend/tests/services/embeddingService.test.ts: mocked OpenAI calls return 1536-dim vectors; batch splitting at 100 texts per API call; retry on API error up to 3 attempts with backoff; timeout enforcement at 30s; empty input returns empty array; API key read from environment

---

## Phase 3: US1 — Upload and Query a Document

**Goal**: End-to-end flow: upload a PDF or text file -> extract text -> chunk -> embed -> store vectors with keyword index -> user sends a message -> AI searches documents via hybrid retrieval tool -> responds with cited answer. This is the feature's MVP.

**Independent test**: Upload a PDF via `POST /api/v1/threads/:id/documents` with a multipart form. Poll `GET /api/v1/threads/:id/documents` until status is `ready` (progresses through `extracting` -> `chunking` -> `embedding` -> `ready`). Send a message asking about the document content. The SSE stream includes `document_search_start` and `document_search_result` events, and the AI response references the document content.

- [x] T011 [P] [US1] Create text extractor for PDF and plain text in backend/src/services/textExtractor.ts: export `extractFromPdf(buffer: Buffer): Promise<string>` using `pdf-parse`; `extractFromText(buffer: Buffer): Promise<string>` via UTF-8 decode; `extractText(buffer: Buffer, mimeType: string): Promise<string>` dispatching by MIME type; throw typed errors for unsupported formats (`UnsupportedFormatError`), password-protected PDFs (`PasswordProtectedError`), and corrupt files (`CorruptFileError`)
- [x] T012 [P] [US1] Create upload middleware in backend/src/middleware/upload.ts: configure `multer` with `memoryStorage()`, 20 MB file size limit, file filter accepting only `application/pdf`, `text/plain`, and `text/markdown` MIME types; export as Express middleware; return 400 with `FILE_TOO_LARGE` or `UNSUPPORTED_FORMAT` error codes on rejection
- [x] T013 [US1] Create document processor orchestrator in backend/src/services/documentProcessor.ts: export `processDocument(documentId: string, content: Buffer, mimeType: string): Promise<void>` that runs the pipeline with granular status updates and cancellation checks between stages: (1) set status `extracting` -> extract text via `textExtractor` -> log `document.extract` metric, (2) check cancellation -> set status `chunking` -> chunk text via `textChunker` -> log `document.chunk` metric, (3) check cancellation -> set status `embedding` -> batch embed via `embeddingService` -> log `document.embed` metric, (4) store chunks via `$executeRaw` with pgvector serialization and `to_tsvector('english', content)` for search_vector and `text-embedding-3-small` as embedding_model -> set status `ready` with chunk count -> log `document.process.complete`; on failure: catch specific errors and update status to `failed` with cause-specific messages ("This PDF is password-protected and cannot be read", "This file appears to be corrupt", "Indexing service unavailable -- please re-upload shortly") -> log `document.process.failed`; on cancellation: abort pipeline, delete partial chunks, set status `cancelled`
- [x] T014 [P] [US1] Create unit tests for document processor in backend/tests/services/documentProcessor.test.ts: full pipeline with mocked extractor, chunker, and embedder completes and sets status to `ready`; granular status transitions verified (extracting -> chunking -> embedding -> ready); status updated to `failed` with "password-protected" message on PasswordProtectedError; status updated to `failed` with "corrupt" message on CorruptFileError; status updated to `failed` with "service unavailable" message when embedding API fails after 3 retries; cancellation mid-pipeline sets status `cancelled` and removes partial chunks; chunk storage via `$executeRaw` called with correct pgvector serialization and tsvector population
- [x] T015 [US1] Create retrieval service with hybrid search in backend/src/services/retrievalService.ts: export `searchDocuments(threadId: string, query: string, topK?: number): Promise<SearchResult[]>` with default topK=10; (1) embed query via `embeddingService.embedTexts([query])`; (2) execute vector search via raw SQL: `SELECT dc.id, dc.content, dc.chunk_index, d.id as document_id, d.title, 1 - (dc.embedding <=> $2) as vector_score FROM document_chunks dc JOIN documents d ON dc.document_id = d.id WHERE d.thread_id = $1 AND d.status = 'ready' ORDER BY dc.embedding <=> $2 LIMIT 20`; (3) execute keyword search via raw SQL: `SELECT dc.id, dc.content, dc.chunk_index, d.id as document_id, d.title, ts_rank(dc.search_vector, plainto_tsquery('english', $2)) as keyword_score FROM document_chunks dc JOIN documents d ON dc.document_id = d.id WHERE d.thread_id = $1 AND d.status = 'ready' AND dc.search_vector @@ plainto_tsquery('english', $2) ORDER BY keyword_score DESC LIMIT 20`; (4) merge with RRF: `score = 1/(60 + vector_rank) + 1/(60 + keyword_rank)`, deduplicate by chunk ID; (5) return top `topK` sorted by RRF score as `{documentId, documentTitle, chunkIndex, content, relevanceScore}[]`; log `document.retrieve` metric with `{threadId, durationMs, chunksReturned, queryLength}`
- [x] T016 [P] [US1] Create unit tests for retrieval service in backend/tests/services/retrievalService.test.ts: mocked vector and keyword DB queries return results; RRF merging correctly combines ranks from both sources; deduplication by chunk ID removes duplicates across vector and keyword results; empty results from both queries returns empty array; query embedding called via embeddingService; thread scoping enforced in SQL WHERE clause; topK parameter limits result count; metric logging called with correct shape
- [x] T017 [US1] Extend tool execution context to include `threadId`: add `threadId: string` to `ToolExecutionContext` type; ensure `toolRegistry.execute()` forwards context to tool handlers; update existing tools to accept but ignore the new field if needed
- [x] T018 [US1] Create document search tool in backend/src/tools/documentSearch.ts: export `definition` with name `document_search`, description "Search documents uploaded to this conversation thread for relevant passages. Use this tool when the user asks about or references their uploaded documents.", input schema `{query: string}` (required); export `handler` that receives query and context (threadId), calls `retrievalService.searchDocuments`, formats results as `[Source: filename, chunk N]\n{content}` text with metadata `{sourcesUsed: string[], chunksSearched: number}`; register in backend/src/tools/index.ts
- [x] T019 [US1] Create document controller in backend/src/controllers/documentController.ts: `handleUploadDocument` -- validate file from multer, compute SHA-256 fingerprint via `crypto.createHash('sha256').update(req.file.buffer).digest('hex')`, check content fingerprint duplicate via `documentService.checkDuplicateFingerprint(threadId, fingerprint)`, create Document record via `documentService.createDocument` with fingerprint, fire-and-forget `processDocument(doc.id, req.file.buffer, mimeType)`, return 201 with document metadata and optional `duplicateNotice` if fingerprint matched; `handleListDocuments` -- call `documentService.listDocuments(threadId)`, return 200; `handleGetDocument` -- call `documentService.getDocument(threadId, documentId)`, return 200 or 404; `handleDeleteDocument` -- call `documentService.deleteDocument(threadId, documentId)`, return 204 or 404
- [x] T020 [US1] Create document routes in backend/src/routes/documentRoutes.ts: mount under `/api/v1/threads/:threadId/documents`; `POST /` with upload middleware -> `handleUploadDocument`; `GET /` -> `handleListDocuments`; `GET /:documentId` -> `handleGetDocument`; `DELETE /:documentId` -> `handleDeleteDocument`; register router in backend/src/server.ts with auth middleware
- [x] T021 [US1] Create integration tests for document API in backend/tests/api/documents.test.ts: POST upload file -> 201 with correct metadata including contentFingerprint; POST upload duplicate content -> 201 with duplicateNotice present; POST oversized file -> 400 FILE_TOO_LARGE; POST unsupported format -> 400 UNSUPPORTED_FORMAT; GET list -> 200 with documents array; GET single -> 200; GET non-existent -> 404; DELETE -> 204; DELETE non-existent -> 404; cross-thread access -> 404
- [x] T022 [US1] Integrate RAG into message flow in backend/src/controllers/messageController.ts: before calling the agentic loop, check `documentService.hasReadyDocuments(threadId)`; if true, include `document_search` tool definition in the tools passed to the agentic loop and pass `{threadId, userId}` as `ToolExecutionContext`; in the existing `onToolUseStart` callback, detect `document_search` calls and emit `document_search_start` SSE event; in `onToolUseResult`, emit `document_search_result` with sources array or `document_search_empty` based on the result
- [x] T023 [P] [US1] Add document API client functions in app/src/api.ts: `uploadDocument(threadId: string, file: File): Promise<Document>` using FormData POST; `listDocuments(threadId: string): Promise<Document[]>` via GET; `deleteDocument(threadId: string, documentId: string): Promise<void>` via DELETE
- [x] T024 [US1] Create document upload component in app/src/components/DocumentUpload.tsx and app/src/components/DocumentUpload.module.css: upload button with hidden file input accepting `.pdf,.txt,.md`; on file select, call `api.uploadDocument(threadId, file)`; show upload progress indicator; display error for rejected files (size/format); accept `threadId` and `onUploadComplete` callback as props; ensure all interactive elements are keyboard-navigable with appropriate ARIA labels
- [x] T025 [P] [US1] Create component tests for DocumentUpload in app/src/components/DocumentUpload.test.tsx: file input accepts only .pdf/.txt/.md; upload triggers API call with correct FormData; error state renders for rejected files; upload progress indicator visible during upload; upload button is keyboard-accessible
- [x] T026 [US1] Integrate upload into ChatContainer in app/src/components/ChatContainer.tsx: import DocumentUpload; render upload button near the chat input area; pass active thread ID and a refresh callback; manage document list state `documents: Document[]` with `listDocuments` fetch on thread change

---

## Phase 4: US2 — URL Ingestion

**Goal**: Users can submit a URL to ingest a web page as a document. Reuses the entire processing pipeline from US1.

**Independent test**: `POST /api/v1/threads/:id/documents` with JSON body `{"url": "https://example.com"}` -> 201. Document status transitions through granular stages to `ready`. Content from the page is searchable via document_search tool.

- [x] T027 [US2] Add URL text extraction in backend/src/services/textExtractor.ts: export `extractFromUrl(url: string): Promise<{text: string, title: string}>` reusing SSRF protection from existing `fetchUrl.ts` (block internal IPs, localhost, private ranges); fetch URL content; extract text using existing text extraction approach; throw `SsrfBlockedError` for private IPs and `FetchFailedError` for network errors
- [x] T028 [US2] Add URL ingestion handler in backend/src/controllers/documentController.ts: `handleIngestUrl` -- validate URL from JSON body, call `extractFromUrl`, compute SHA-256 fingerprint from fetched content, check content fingerprint duplicate, create Document record with sourceType `url` and sourceUrl, fire-and-forget `processDocument` with extracted text buffer, return 201 with optional duplicateNotice; update POST route in backend/src/routes/documentRoutes.ts to dispatch to `handleIngestUrl` when Content-Type is `application/json` with a `url` field, or to `handleUploadDocument` for multipart/form-data
- [x] T029 [US2] Add URL ingestion integration tests in backend/tests/api/documents.test.ts: POST URL ingestion -> 201 with sourceType `url` and sourceUrl populated; POST private IP URL -> 403 SSRF_BLOCKED; POST unreachable URL -> 422 FETCH_FAILED; POST invalid URL format -> 400 INVALID_URL
- [x] T030 [US2] Add URL input to upload component in app/src/components/DocumentUpload.tsx: add text input field for pasting a URL; on submit, call `api.ingestUrl(threadId, url)` (add `ingestUrl(threadId: string, url: string): Promise<Document>` function to app/src/api.ts); validate URL format client-side before submission; show loading state during ingestion

---

## Phase 5: US3 — Document Management Panel

**Goal**: Users can see all documents in the current thread with granular processing status, cancel documents mid-processing, and delete individual documents. The panel provides visibility into what the AI can search.

**Independent test**: Upload 2 documents. The panel shows both with correct titles and status badges. A processing document shows cancel button and status badge transitions (Extracting -> Chunking -> Embedding -> Ready). Click cancel on a processing document -> status becomes cancelled. Click delete on a ready document -> it disappears from the panel. Failed documents show specific error message.

- [x] T031 [US3] Create document panel component in app/src/components/DocumentPanel.tsx and app/src/components/DocumentPanel.module.css: render list of documents for the active thread; each row shows title, granular status badge (`extracting` -> "Extracting...", `chunking` -> "Chunking...", `embedding` -> "Embedding...", `ready` -> green "Ready", `failed` -> red with statusMessage, `cancelled` -> grey "Cancelled"), file size (formatted), and a delete button; cancel button visible on processing-state documents (processing/extracting/chunking/embedding); empty state: "No documents uploaded. Upload a file to ask questions about it."; ensure keyboard navigation and screen reader compatibility
- [x] T032 [US3] Add cancel document support: add `cancelDocument(threadId: string, documentId: string): Promise<void>` to app/src/api.ts; wire cancel button in DocumentPanel to call this endpoint; add `POST /:documentId/cancel` route in backend/src/routes/documentRoutes.ts -> `handleCancelDocument` in documentController (verify document is in processing state, delegate to `documentService.cancelDocument`, return 200 or 409 DOCUMENT_NOT_PROCESSING)
- [x] T033 [US3] Add document panel to ChatContainer layout in app/src/components/ChatContainer.tsx: render DocumentPanel as a collapsible right sidebar or inline panel; pass `documents` state array, `onDelete` handler calling `api.deleteDocument` then refreshing list, `onCancel` handler calling `api.cancelDocument`, and `threadId` as props
- [x] T034 [US3] Implement status polling for processing documents in app/src/components/DocumentPanel.tsx: when any document has a processing status (processing/extracting/chunking/embedding), poll `api.listDocuments(threadId)` every 3 seconds; stop polling when all documents are in terminal state (ready/failed/cancelled); use `useEffect` with cleanup to clear interval on unmount or thread change
- [x] T035 [P] [US3] Create component tests for DocumentPanel in app/src/components/DocumentPanel.test.tsx: renders document titles and granular status badges correctly; processing document shows cancel button; ready document shows "Ready" badge with no cancel button; failed document shows error message from statusMessage; cancelled document shows "Cancelled" badge; delete button calls onDelete callback; cancel button calls onCancel callback; empty state renders placeholder text

---

## Phase 6: US4 — Source Citations in Responses

**Goal**: When the AI uses document content to answer, the response shows which documents were referenced -- making retrieval transparent and verifiable.

**Independent test**: Upload a document, wait for `ready`, ask a question about it. The message bubble shows a "Sources (N documents)" section below the response text listing the document titles and relevance indicators.

- [x] T036 [US4] Handle document search SSE events in app/src/api.ts or streaming handler: parse `document_search_start`, `document_search_result`, and `document_search_empty` event types in the SSE streaming handler; store source citations from `document_search_result` events (sources array with documentId, documentTitle, chunkIndex, relevanceScore, snippet) on the message object or pass via callback
- [x] T037 [US4] Display source citations in message bubbles in app/src/components/MessageBubble.tsx and app/src/components/MessageBubble.module.css: when a message has associated document sources, render a collapsible "Sources used (N documents)" section below the message content; each citation shows document title and relevance score as a percentage; style with muted colors and smaller font to avoid competing with the response text

---

## Phase 7: US5 — Validation & Duplicate Handling

**Goal**: Invalid uploads are rejected with clear, actionable errors. Duplicate filenames trigger a confirmation prompt. Content fingerprint matches show a non-blocking notice. Failed documents show cause-specific error messages.

**Independent test**: Upload a 25 MB file -> 400 error with "File exceeds 20 MB limit". Upload a `.zip` file -> 400 with "Unsupported format". Upload a file with the same name as an existing document -> confirmation dialog. Click proceed -> both copies exist. Upload identical content under a different name -> non-blocking notice "This content matches an existing document: [name]". Upload a password-protected PDF -> document status shows "Failed: This PDF is password-protected and cannot be read."

- [x] T038 [US5] Add duplicate filename check endpoint in backend/src/controllers/documentController.ts: `handleCheckDuplicate` -- accept `filename` query param, call `documentService.checkDuplicateFilename(threadId, filename)`, return `{filenameMatch: {exists, existingDocumentId?, existingTitle?}}`; add `GET /check-duplicate` route in backend/src/routes/documentRoutes.ts
- [x] T039 [US5] Enhance upload middleware error responses in backend/src/middleware/upload.ts: return structured JSON errors `{code: "FILE_TOO_LARGE", message: "File exceeds the 20 MB limit"}` and `{code: "UNSUPPORTED_FORMAT", message: "Only PDF, TXT, and MD files are supported"}` with 400 status
- [x] T040 [US5] Add duplicate confirmation dialog to upload component in app/src/components/DocumentUpload.tsx: before uploading, call `api.checkDuplicate(threadId, file.name)` (add `checkDuplicate(threadId: string, filename: string): Promise<{filenameMatch: {exists: boolean, existingDocumentId?: string, existingTitle?: string}}>` to app/src/api.ts); if duplicate exists, show confirmation dialog "A document with this name already exists in this conversation. Upload anyway?"; proceed or cancel based on user choice; ensure dialog is keyboard-accessible and focus-trapped
- [x] T041 [US5] Display content fingerprint duplicate notice as non-blocking toast in app/src/components/DocumentUpload.tsx: when upload response includes `duplicateNotice`, show informational toast "This content matches an existing document: [matchedDocumentTitle]"; toast auto-dismisses after 5 seconds; does not block the upload flow

---

## Phase 8: Polish & Cross-Cutting Concerns

**Goal**: Verify cascade behavior, add observability, handle edge cases, and ensure security/correctness.

- [x] T042 Verify cascade deletion at all levels: thread deletion cascades to documents and chunks via Prisma `onDelete: Cascade`; user account deletion cascades through threads to documents and chunks; soft-deleted threads exclude documents from search (add thread status check to retrieval SQL WHERE clause in backend/src/services/retrievalService.ts)
- [x] T043 Handle edge cases in document processor in backend/src/services/documentProcessor.ts: empty text after extraction -> mark `failed` with "No readable text found in this document"; single sentence shorter than chunk size -> create one chunk; add structured metric logging: `document.extract` (durationMs, charCount), `document.chunk` (durationMs, chunkCount), `document.embed` (durationMs, chunkCount, batchCount), `document.process.complete`, `document.process.failed` via pino
- [x] T044 Add observability logging to retrieval and upload paths: log `document.retrieve` in backend/src/services/retrievalService.ts with `{threadId, durationMs, chunksReturned, queryLength}` via pino; log `document.upload` in backend/src/controllers/documentController.ts with `{documentId, fileSize, durationMs}` including upload timing; log `document.embed.error` on embedding failures with `{documentId, attempt, error}` in backend/src/services/embeddingService.ts
- [x] T045 Add drag-and-drop file support to upload component in app/src/components/DocumentUpload.tsx: add drop zone with visual indicator (border highlight on drag-over); accept same file types as the file picker; reuse existing upload flow after drop
- [x] T046 Create security and correctness verification tests in backend/tests/api/documents.test.ts: SC-4 -- user A uploads document in thread, user B queries same thread -> 404 (cross-user isolation); user queries thread A, document in thread B not returned (cross-thread isolation); SC-5 -- send message with uploaded finance docs asking unrelated question, verify response contains no fabricated citations; SC-6 -- send message that triggers document search, verify response includes source references
- [x] T047 Update Postman collection in docs/postman/chat-thread-api.postman_collection.json: add requests for POST upload document (multipart), POST ingest URL (JSON), GET list documents, GET single document, DELETE document, POST cancel document, GET check-duplicate; include example responses matching contracts/api.md
- [x] T048 End-to-end manual test: upload PDF -> wait for ready (verify granular status transitions) -> ask question -> verify cited response with source attribution -> delete document -> verify removed from search -> delete thread -> verify cascade removes all documents and chunks

---

## Dependencies

```
Phase 1 (Setup) ─────────────────────────────┐
                                              v
Phase 2 (Foundational) ──────────────────────┐
                                              v
Phase 3 (US1: Upload & Query) ───────────────┐
                     |                        |
                     +-->  Phase 4 (US2: URL) | (can start once US1 backend is done)
                     +-->  Phase 5 (US3: Panel) (can start once US1 is done)
                     └-->  Phase 6 (US4: Citations) (can start once US1 is done)
                                              |
Phase 7 (US5: Validation) <───────────────────┘ (needs US1 upload + US3 panel)
                                              |
Phase 8 (Polish) <────────────────────────────┘
```

**Story completion order**: US1 (required first) -> US2, US3, US4 (parallel) -> US5 -> Polish

---

## Parallel Execution Opportunities

**Within Phase 1**: T001 and T002 are independent -- run in parallel.

**Within Phase 2**: T005 (chunker), T006 (embedding), T007 (shared types) are independent -- run in parallel. T008 (document service) depends on T003/T004 (schema). T009 and T010 (unit tests) can run in parallel once their respective services are written.

**Within Phase 3**: T011 (text extractor) and T012 (upload middleware) are independent -- run in parallel. T014 and T016 (unit tests) can run in parallel once their services are done. T023 (API client) and T025 (upload tests) can run in parallel with later backend tasks.

**Across Phases 4-6**: US2, US3, US4 are independent of each other and can be developed in parallel once US1 is complete.

---

## Implementation Strategy

**MVP**: Phase 1 + Phase 2 + Phase 3 (US1). This delivers the core value -- upload a document and ask questions about it -- with hybrid retrieval, content fingerprinting, and full test coverage.

**Suggested order for a single developer**:
1. Setup + Foundational (Phases 1-2) -- ~3 hours
2. US1: Upload & Query (Phase 3) -- ~8 hours
3. US3: Document Panel (Phase 5) -- ~3 hours (gives visibility before adding more features)
4. US4: Source Citations (Phase 6) -- ~1 hour
5. US2: URL Ingestion (Phase 4) -- ~2 hours
6. US5: Validation & Duplicates (Phase 7) -- ~1.5 hours
7. Polish (Phase 8) -- ~2 hours

**Total estimated effort**: ~20.5 hours

---

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 48 |
| Phase 1 (Setup) | 2 tasks |
| Phase 2 (Foundational) | 8 tasks (incl. 2 test tasks) |
| Phase 3 (US1 -- Upload & Query) | 16 tasks (incl. 4 test tasks) |
| Phase 4 (US2 -- URL Ingestion) | 4 tasks (incl. 1 test task) |
| Phase 5 (US3 -- Document Panel) | 5 tasks (incl. 1 test task) |
| Phase 6 (US4 -- Source Citations) | 2 tasks |
| Phase 7 (US5 -- Validation & Duplicates) | 4 tasks |
| Phase 8 (Polish) | 7 tasks (incl. 1 verification test, 1 Postman update, 1 E2E test) |
| Test tasks | 9 (unit: 4, integration: 3, component: 2) |
| Parallelizable tasks | 15 (marked [P]) |
| New backend files | ~13 + ~6 test files |
| New frontend files | ~4 (+ CSS modules) + ~2 test files |
| Modified files | ~8 |
