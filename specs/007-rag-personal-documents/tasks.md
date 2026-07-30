# Tasks: RAG over Personal Documents

**Feature Branch**: `007-rag-personal-documents`
**Spec**: `specs/007-rag-personal-documents/spec.md`
**Plan**: `specs/007-rag-personal-documents/plan.md`
**Generated**: 2026-07-30

---

## User Stories

| ID | Story | Priority | Description |
|----|-------|----------|-------------|
| US1 | Upload and Query | P1 | Upload a file, process it, and ask questions answered from its content |
| US2 | URL Ingestion | P2 | Ingest a web page URL as a document and query it like a file |
| US3 | Document Management Panel | P3 | View, monitor status, and delete documents attached to a thread |
| US4 | Source Citations | P4 | Display which documents the assistant drew from in its response |
| US5 | Validation & Duplicates | P5 | Reject invalid uploads with clear errors; handle duplicate filenames |

---

## Phase 1: Setup

**Goal**: Install new dependencies and swap the PostgreSQL Docker image to enable pgvector.

**Independent test**: `docker-compose build postgres` succeeds. `cd backend && npm ls pdf-parse pgvector multer` shows all three installed.

- [ ] T001 [P] Install backend dependencies: `cd backend && npm install pdf-parse pgvector multer && npm install -D @types/multer` in backend/package.json
- [ ] T002 [P] Swap PostgreSQL Docker image from `postgres:16-alpine` to `pgvector/pgvector:pg16` in docker-compose.yml

---

## Phase 2: Foundational

**Goal**: Database schema with vector support, core services that all user stories depend on, shared types, and unit tests for foundational services. Must complete before any user story phase begins.

**Independent test**: `npx prisma migrate status` shows no pending migrations. `npx prisma generate` exits clean. `npm run build` and `npm test` in `backend/` pass. Shared types import without error.

- [ ] T003 Add `DocumentSourceType` enum (`file`, `url`), `DocumentStatus` enum (`processing`, `ready`, `failed`), `Document` model (id UUID PK, threadId FK→Thread cascade, userId FK→User cascade, title VarChar(255), sourceType, sourceUrl nullable VarChar(2048), mimeType VarChar(127), fileSize Int, status default `processing`, statusMessage nullable VarChar(500), chunkCount default 0, createdAt, updatedAt, `@@index([threadId, status])`, `@@index([userId])`, `@@map("documents")`), and `DocumentChunk` model (id UUID PK, documentId FK→Document cascade, chunkIndex Int, content Text, tokenCount Int, embedding `Unsupported("vector(1536)")?`, createdAt, `@@index([documentId])`, `@@map("document_chunks")`) to backend/prisma/schema.prisma
- [ ] T004 Add `documents Document[]` relation to `Thread` and `User` models in backend/prisma/schema.prisma; create migration with `npx prisma migrate dev --name add-documents-and-chunks`; prepend `CREATE EXTENSION IF NOT EXISTS vector;` and append `CREATE INDEX idx_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);` as raw SQL in the generated migration file
- [ ] T005 [P] Create text chunker service in backend/src/services/textChunker.ts: export `chunkText(text: string, options?: {chunkSize?: number, overlap?: number}): Chunk[]` with defaults ~2000 chars per chunk (~500 tokens), ~200 char overlap (~50 tokens); split at sentence boundaries (`. `, `? `, `! `, newlines); return `{content: string, index: number, tokenCount: number}[]` with token count estimated as `Math.ceil(content.length / 4)`
- [ ] T006 [P] Create embedding service in backend/src/services/embeddingService.ts: export `embedTexts(texts: string[]): Promise<number[][]>` using OpenAI `text-embedding-3-small` (1536 dims) via the existing `openai` npm package; batch up to 100 texts per API call; retry up to 3 times with exponential backoff on API errors; enforce 30s timeout per batch; read API key from `process.env.OPENAI_API_KEY`
- [ ] T007 [P] Add shared types in shared/types/: `Document` interface (id, threadId, title, sourceType, mimeType, fileSize, status, statusMessage, chunkCount, createdAt), `DocumentSearchResult` interface (documentId, documentTitle, chunkIndex, relevanceScore, snippet), and SSE event types `DocumentSearchStartEvent`, `DocumentSearchResultEvent` (with sources array), `DocumentSearchEmptyEvent`
- [ ] T008 Create document service in backend/src/services/documentService.ts: export `createDocument(threadId, userId, title, sourceType, mimeType, fileSize)` → insert with status `processing`; `listDocuments(threadId)` → return documents for thread; `getDocument(threadId, documentId)` → single document with ownership check; `deleteDocument(threadId, documentId)` → hard delete (cascades to chunks); `updateDocumentStatus(id, status, statusMessage?, chunkCount?)` → status transitions; `checkDuplicateFilename(threadId, filename)` → boolean duplicate check; `hasReadyDocuments(threadId)` → boolean check for any ready documents
- [ ] T009 [P] Create unit tests for text chunker in backend/tests/services/textChunker.test.ts: chunking at sentence boundaries produces clean splits; empty text returns empty array; single sentence shorter than chunk size produces one chunk; overlap preserves context across chunk boundaries; very long text produces correct chunk count with expected overlap; token count estimation matches `Math.ceil(content.length / 4)`
- [ ] T010 [P] Create unit tests for embedding service in backend/tests/services/embeddingService.test.ts: mocked OpenAI calls return 1536-dim vectors; batch splitting at 100 texts per API call; retry on API error up to 3 attempts with backoff; timeout enforcement at 30s; empty input returns empty array; API key read from environment

---

## Phase 3: US1 — Upload and Query a Document

**Goal**: End-to-end flow: upload a PDF or text file → extract text → chunk → embed → store vectors → user sends a message → AI searches documents via tool → responds with answer. This is the feature's MVP.

**Independent test**: Upload a PDF via `POST /api/v1/threads/:id/documents` with a multipart form. Poll `GET /api/v1/threads/:id/documents` until status is `ready`. Send a message asking about the document content. The SSE stream includes `document_search_start` and `document_search_result` events, and the AI response references the document content.

- [ ] T011 [P] [US1] Create text extractor for PDF and plain text in backend/src/services/textExtractor.ts: export `extractFromPdf(buffer: Buffer): Promise<string>` using `pdf-parse`; `extractFromText(buffer: Buffer): Promise<string>` via UTF-8 decode; `extractText(buffer: Buffer, mimeType: string): Promise<string>` dispatching by MIME type; throw typed errors for unsupported formats (`UnsupportedFormatError`), password-protected PDFs (`PasswordProtectedError`), and corrupt files (`CorruptFileError`)
- [ ] T012 [P] [US1] Create upload middleware in backend/src/middleware/upload.ts: configure `multer` with `memoryStorage()`, 20 MB file size limit, file filter accepting only `application/pdf`, `text/plain`, and `text/markdown` MIME types; export as Express middleware; return 400 with `FILE_TOO_LARGE` or `UNSUPPORTED_FORMAT` error codes on rejection
- [ ] T013 [US1] Create document processor orchestrator in backend/src/services/documentProcessor.ts: export `processDocument(documentId: string, content: Buffer, mimeType: string): Promise<void>` that runs the pipeline: extract text via `textExtractor` → chunk via `textChunker` → batch embed via `embeddingService` → store chunks with embeddings via `$executeRaw` with pgvector serialization → update document status to `ready` with chunk count; on failure: catch specific errors and update status to `failed` with cause-specific messages ("This PDF is password-protected and cannot be read", "This file appears to be corrupt", "Indexing service unavailable — please re-upload shortly")
- [ ] T014 [P] [US1] Create unit tests for document processor in backend/tests/services/documentProcessor.test.ts: full pipeline with mocked extractor, chunker, and embedder completes and sets status to `ready`; status updated to `failed` with "password-protected" message on PasswordProtectedError; status updated to `failed` with "corrupt" message on CorruptFileError; status updated to `failed` with "service unavailable" message when embedding API fails after 3 retries; chunk storage via `$executeRaw` called with correct pgvector serialization
- [ ] T015 [US1] Create retrieval service in backend/src/services/retrievalService.ts: export `searchDocuments(threadId: string, query: string, topK?: number, threshold?: number): Promise<SearchResult[]>` with defaults topK=5, threshold=0.7; embed the query via `embeddingService.embedTexts([query])`; execute raw SQL `SELECT dc.id, dc.content, dc.chunk_index, d.id as document_id, d.title, 1 - (dc.embedding <=> $2) as relevance FROM document_chunks dc JOIN documents d ON dc.document_id = d.id WHERE d.thread_id = $1 AND d.status = 'ready' ORDER BY dc.embedding <=> $2 LIMIT $3`; filter results below threshold; return `{documentId, documentTitle, chunkIndex, content, relevanceScore}[]`
- [ ] T016 [P] [US1] Create unit tests for retrieval service in backend/tests/services/retrievalService.test.ts: mocked DB query returns results sorted by relevance; results below 0.7 threshold filtered out; empty result set returns empty array; query embedding called via embeddingService; thread scoping enforced in SQL WHERE clause; topK parameter limits result count
- [ ] T017 [US1] Add `threadId: string` to `ToolExecutionContext` in backend/src/types/context.ts; the context parameter is already accepted by `toolRegistry.execute()` and forwarded to tool handlers — no changes needed in toolRegistry.ts
- [ ] T018 [US1] Create document search tool in backend/src/tools/documentSearch.ts: export `definition` with name `document_search`, description for searching uploaded documents, input schema `{query: string}`; export `handler` that receives query and context (threadId), calls `retrievalService.searchDocuments`, formats results as `[Source: filename, chunk N]\n{content}` text with metadata `{sourcesUsed, chunksSearched}`; register in backend/src/tools/index.ts
- [ ] T019 [US1] Create document controller in backend/src/controllers/documentController.ts: `handleUploadDocument` — validate file from multer, create Document record via `documentService`, fire-and-forget `processDocument(doc.id, req.file.buffer, mimeType)`, return 201 with document metadata; `handleListDocuments` — call `documentService.listDocuments(threadId)`, return 200; `handleGetDocument` — call `documentService.getDocument(threadId, documentId)`, return 200 or 404; `handleDeleteDocument` — call `documentService.deleteDocument(threadId, documentId)`, return 204 or 404
- [ ] T020 [US1] Create document routes in backend/src/routes/documentRoutes.ts: mount under `/api/v1/threads/:threadId/documents`; `POST /` with upload middleware → `handleUploadDocument`; `GET /` → `handleListDocuments`; `GET /:documentId` → `handleGetDocument`; `DELETE /:documentId` → `handleDeleteDocument`; register router in backend/src/server.ts with auth middleware
- [ ] T021 [US1] Create integration tests for document API in backend/tests/api/documents.test.ts: POST upload file → 201 with correct metadata; POST oversized file → 400 FILE_TOO_LARGE; POST unsupported format → 400 UNSUPPORTED_FORMAT; GET list → 200 with documents array; GET single → 200; GET non-existent → 404; DELETE → 204; DELETE non-existent → 404; cross-thread access → 404; POST URL ingestion → 201; POST private IP URL → 403 SSRF_BLOCKED
- [ ] T022 [US1] Integrate RAG into message flow in backend/src/controllers/messageController.ts: before calling the agentic loop, check `documentService.hasReadyDocuments(threadId)`; if true, include `document_search` tool definition in the tools passed to the agentic loop and pass `{threadId, userId}` as `ToolExecutionContext`; in the existing `AgenticLoopCallbacks.onToolUseStart` callback, detect `document_search` calls and emit `document_search_start` SSE event; in `onToolUseResult`, emit `document_search_result` with sources or `document_search_empty` based on the result
- [ ] T023 [P] [US1] Add document API client functions in app/src/api.ts: `uploadDocument(threadId: string, file: File): Promise<Document>` using FormData POST; `listDocuments(threadId: string): Promise<Document[]>` via GET; `getDocument(threadId: string, documentId: string): Promise<Document>` via GET; `deleteDocument(threadId: string, documentId: string): Promise<void>` via DELETE
- [ ] T024 [US1] Create document upload component in app/src/components/DocumentUpload.tsx and app/src/components/DocumentUpload.module.css: upload button with hidden file input accepting `.pdf,.txt,.md`; on file select, call `api.uploadDocument(threadId, file)`; show upload progress indicator; display error for rejected files (size/format); accept `threadId` and `onUploadComplete` callback as props; ensure all interactive elements are keyboard-navigable with appropriate ARIA labels
- [ ] T025 [P] [US1] Create component tests for DocumentUpload in app/src/components/DocumentUpload.test.tsx: file input accepts only .pdf/.txt/.md; upload triggers API call with correct FormData; error state renders for rejected files; upload progress indicator visible during upload; upload button is keyboard-accessible
- [ ] T026 [US1] Integrate upload into ChatContainer in app/src/components/ChatContainer.tsx: import DocumentUpload; render upload button near the chat input area; pass active thread ID and a refresh callback; manage document list state `documents: Document[]` with `listDocuments` fetch on thread change

---

## Phase 4: US2 — URL Ingestion

**Goal**: Users can submit a URL to ingest a web page as a document. Reuses the entire processing pipeline from US1.

**Independent test**: `POST /api/v1/threads/:id/documents` with JSON body `{"url": "https://example.com"}` → 201. Document status transitions to `ready`. Content from the page is searchable via document_search tool.

- [ ] T027 [US2] Add URL text extraction in backend/src/services/textExtractor.ts: export `extractFromUrl(url: string): Promise<{text: string, title: string}>` reusing SSRF protection from existing `fetchUrl.ts` (block internal IPs, localhost, private ranges); fetch URL content; extract text using existing `html-to-text` package (already installed); throw `SsrfBlockedError` for private IPs and `FetchFailedError` for network errors
- [ ] T028 [US2] Add URL ingestion handler in backend/src/controllers/documentController.ts: `handleIngestUrl` — validate URL from JSON body, check SSRF protection, call `extractFromUrl`, create Document record with sourceType `url`, fire-and-forget `processDocument` with extracted text buffer, return 201; add `POST /` route branch in documentRoutes.ts that dispatches to file upload or URL ingestion based on Content-Type header
- [ ] T029 [US2] Add URL input to upload component in app/src/components/DocumentUpload.tsx: add text input field for pasting a URL; on submit, call `api.ingestUrl(threadId, url)` (add `ingestUrl` function to app/src/api.ts); validate URL format client-side before submission; show loading state during ingestion

---

## Phase 5: US3 — Document Management Panel

**Goal**: Users can see all documents in the current thread with their processing status, and delete individual documents. The panel provides visibility into what the AI can search.

**Independent test**: Upload 2 documents. The panel shows both with correct titles and status badges. Click delete on one → it disappears from the panel and is no longer returned by the list endpoint. A processing document shows "Indexing..." badge that transitions to "Ready" when complete.

- [ ] T030 [US3] Create document panel component in app/src/components/DocumentPanel.tsx and app/src/components/DocumentPanel.module.css: render list of documents for the active thread; each row shows title, status badge (`processing` → yellow "Indexing...", `ready` → green "Ready", `failed` → red with error message), file size (formatted), and a delete button; empty state: "No documents uploaded. Upload a file to ask questions about it."; ensure keyboard navigation and screen reader compatibility with ARIA status announcements for processing state changes
- [ ] T031 [US3] Add document panel to ChatContainer layout in app/src/components/ChatContainer.tsx: render DocumentPanel as a collapsible right sidebar or inline panel; pass `documents` state array, `onDelete` handler calling `api.deleteDocument` then refreshing list, and `threadId` as props
- [ ] T032 [US3] Implement status polling for processing documents in app/src/components/DocumentPanel.tsx: when any document has status `processing`, poll `api.listDocuments(threadId)` every 3 seconds; stop polling when all documents are `ready` or `failed`; use `useEffect` with cleanup to clear interval on unmount or thread change
- [ ] T033 [US3] Wire delete handler in document panel in app/src/components/DocumentPanel.tsx: on delete button click, call `api.deleteDocument(threadId, documentId)`; remove document from local state optimistically; show brief confirmation or undo option
- [ ] T034 [P] [US3] Create component tests for DocumentPanel in app/src/components/DocumentPanel.test.tsx: renders document titles and status badges correctly; processing document shows "Indexing..." badge; failed document shows error message from statusMessage; ready document shows "Ready" badge; delete button calls onDelete callback with correct documentId; empty state renders placeholder text

---

## Phase 6: US4 — Source Citations in Responses

**Goal**: When the AI uses document content to answer, the response shows which documents were referenced — making retrieval transparent and verifiable.

**Independent test**: Upload a document, wait for `ready`, ask a question about it. The message bubble shows a "Sources (N documents)" section below the response text listing the document titles and relevance indicators.

- [ ] T035 [US4] Handle document search SSE events in app/src/api.ts: parse `document_search_start`, `document_search_result`, and `document_search_empty` event types in the SSE streaming handler; store source citations from `document_search_result` events on the message object or pass via callback
- [ ] T036 [US4] Display source citations in message bubbles in app/src/components/MessageBubble.tsx and app/src/components/MessageBubble.module.css: when a message has associated document sources, render a collapsible "Sources used (N documents)" section below the message content; each citation shows document title and relevance score as a percentage; style with muted colors and smaller font to avoid competing with the response text

---

## Phase 7: US5 — Validation & Duplicate Handling

**Goal**: Invalid uploads are rejected with clear, actionable errors. Duplicate filenames trigger a confirmation prompt. Failed documents show specific error messages.

**Independent test**: Upload a 25 MB file → 400 error with "File exceeds 20 MB limit". Upload a `.zip` file → 400 with "Unsupported format". Upload a file with the same name as an existing document → confirmation dialog. Click proceed → both copies exist. Upload a password-protected PDF → document status shows "Failed: This PDF is password-protected and cannot be read."

- [ ] T037 [US5] Add duplicate filename check endpoint in backend/src/controllers/documentController.ts: `handleCheckDuplicate` — accept `filename` query param, call `documentService.checkDuplicateFilename(threadId, filename)`, return `{exists, existingDocumentId?, existingTitle?}`; add `GET /check-duplicate` route in documentRoutes.ts
- [ ] T038 [US5] Enhance upload middleware error responses in backend/src/middleware/upload.ts: return structured JSON errors `{code: "FILE_TOO_LARGE", message: "File exceeds the 20 MB limit"}` and `{code: "UNSUPPORTED_FORMAT", message: "Only PDF, TXT, and MD files are supported"}` with 400 status
- [ ] T039 [US5] Add duplicate confirmation dialog to upload component in app/src/components/DocumentUpload.tsx: before uploading, call `api.checkDuplicate(threadId, file.name)` (add `checkDuplicate` function to app/src/api.ts); if duplicate exists, show confirmation dialog "A document with this name already exists in this conversation. Upload anyway?"; proceed or cancel based on user choice; ensure dialog is keyboard-accessible and focus-trapped
- [ ] T040 [US5] Display actionable error messages for failed documents in app/src/components/DocumentPanel.tsx: when document status is `failed`, show `statusMessage` in red below the document title; messages are cause-specific: "This PDF is password-protected and cannot be read", "This file appears to be corrupt", "Indexing service unavailable — please re-upload shortly"

---

## Phase 8: Polish & Cross-Cutting Concerns

**Goal**: Verify cascade behavior, add optional UI enhancements, handle edge cases, and ensure security/correctness through verification tests.

- [ ] T041 Verify cascade deletion at all levels: thread deletion cascades to documents and chunks via Prisma `onDelete: Cascade`; user account deletion cascades through threads to documents and chunks; soft-deleted threads exclude documents from search (thread status check in retrieval query); add thread ID filter to retrieval SQL WHERE clause in backend/src/services/retrievalService.ts
- [ ] T042 Handle edge cases in document processor in backend/src/services/documentProcessor.ts: empty text after extraction → mark `failed` with "No readable text found in this document"; single sentence shorter than chunk size → create one chunk; extremely long documents → process all chunks (no artificial limit, 20 MB file cap is the guard)
- [ ] T043 Add drag-and-drop file support to upload component in app/src/components/DocumentUpload.tsx: add drop zone with visual indicator (border highlight on drag-over); accept same file types as the file picker; reuse existing upload flow after drop
- [ ] T044 Create security and correctness verification tests in backend/tests/api/documents.test.ts: SC-4 — user A uploads document in thread, user B queries same thread → 404 (cross-user isolation); user queries thread A, document in thread B not returned (cross-thread isolation); SC-5 — send message with uploaded finance docs asking unrelated question, verify response contains no `document_search_result` SSE event and no fabricated citations; SC-6 — send message that triggers document search, verify response includes source references in all cases
- [ ] T045 Update Postman collection in docs/postman/chat-thread-api.postman_collection.json: add requests for POST upload document (multipart), POST ingest URL (JSON), GET list documents, GET single document, DELETE document, GET check-duplicate; include example responses matching contracts/api.md

---

## Dependencies

```
Phase 1 (Setup) ─────────────────────────────┐
                                              ▼
Phase 2 (Foundational) ──────────────────────┐
                                              ▼
Phase 3 (US1: Upload & Query) ───────────────┐
                     │                        │
                     ├──→ Phase 4 (US2: URL)  │ (can start once US1 backend is done)
                     ├──→ Phase 5 (US3: Panel)│ (can start once US1 is done)
                     └──→ Phase 6 (US4: Citations) (can start once US1 is done)
                                              │
Phase 7 (US5: Validation) ←──────────────────┘ (needs US1 upload + US3 panel)
                                              │
Phase 8 (Polish) ←────────────────────────────┘
```

**Story completion order**: US1 (required first) → US2, US3, US4 (parallel) → US5 → Polish

---

## Parallel Execution Opportunities

**Within Phase 1**: T001 and T002 are independent — run in parallel.

**Within Phase 2**: T005 (chunker), T006 (embedding), T007 (shared types) are independent — run in parallel. T008 (document service) depends on T003/T004 (schema). T009 and T010 (unit tests) can run in parallel once their respective services are written.

**Within Phase 3**: T011 (text extractor) and T012 (upload middleware) are independent — run in parallel. T014 and T016 (unit tests) can run in parallel once their services are done. T023 (API client) and T025 (upload tests) can run in parallel with later backend tasks.

**Across Phases 4–6**: US2, US3, US4 are independent of each other and can be developed in parallel once US1 is complete.

---

## Implementation Strategy

**MVP**: Phase 1 + Phase 2 + Phase 3 (US1). This delivers the core value — upload a document and ask questions about it — with full test coverage.

**Suggested order for a single developer**:
1. Setup + Foundational (Phases 1–2) — ~3 hours
2. US1: Upload & Query (Phase 3) — ~8 hours
3. US3: Document Panel (Phase 5) — ~3 hours (gives visibility before adding more features)
4. US4: Source Citations (Phase 6) — ~1 hour
5. US2: URL Ingestion (Phase 4) — ~2 hours
6. US5: Validation & Duplicates (Phase 7) — ~1.5 hours
7. Polish (Phase 8) — ~2 hours

**Total estimated effort**: ~20.5 hours

---

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 45 |
| Phase 1 (Setup) | 2 tasks |
| Phase 2 (Foundational) | 8 tasks (incl. 2 test tasks) |
| Phase 3 (US1 — Upload & Query) | 16 tasks (incl. 4 test tasks) |
| Phase 4 (US2 — URL Ingestion) | 3 tasks |
| Phase 5 (US3 — Document Panel) | 5 tasks (incl. 1 test task) |
| Phase 6 (US4 — Source Citations) | 2 tasks |
| Phase 7 (US5 — Validation & Duplicates) | 4 tasks |
| Phase 8 (Polish) | 5 tasks (incl. 1 verification test, 1 Postman update) |
| Test tasks | 8 (unit: 4, integration: 2, component: 2) |
| Parallelizable tasks | 14 (marked [P]) |
| New backend files | ~12 + ~6 test files |
| New frontend files | ~4 (+ CSS modules) + ~2 test files |
| Modified files | ~8 |
