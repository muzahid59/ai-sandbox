# Feature Specification: RAG over Personal Documents

**Feature ID**: 007
**Short Name**: rag-personal-documents
**Status**: Draft
**Created**: 2026-07-29
**Author**: Muzahidul Islam

---

## Overview

Users can upload documents (PDFs, text files, and web pages) into a conversation thread and ask questions against them. The assistant retrieves the most relevant passages from those documents and uses them to answer the user's questions — rather than guessing or relying on general training knowledge. Documents are scoped to the thread they were uploaded in and are deleted automatically when that thread is deleted.

**Examples of what this unlocks:**
- "Summarise this contract and flag any unusual clauses."
- "What are the key dates and milestones in this project proposal?"
- "Based on these meeting notes, what actions were agreed for Alice?"

---

## Problem Statement

The assistant's knowledge is limited to its training data and live web searches. Users have a significant amount of private, personal, or professional knowledge locked in documents — contracts, reports, notes, research papers — that the assistant currently cannot access. Without RAG, users must manually copy and paste relevant sections into the chat, which is tedious and error-prone for long documents.

---

## Goals

1. Allow users to upload documents into a conversation thread for use within that thread.
2. Enable the assistant to search those documents automatically when answering questions.
3. Surface which parts of which documents informed an answer (citations/attribution).
4. Keep document storage and retrieval scoped to the current thread — no cross-thread or cross-user access.
5. Clean up all documents automatically when their thread is deleted — no orphaned data.

---

## Non-Goals

- A persistent, user-level document library that survives across threads.
- Cross-thread document reuse (uploading once and referencing in multiple threads).
- Real-time collaborative document editing or annotation.
- Fine-tuning or training the underlying AI model on user documents.
- Public document sharing between users.
- Video, audio, or image file support (text-extractable formats only in this phase).
- Automatic web crawling or RSS feed ingestion.

---

## User Scenarios & Testing

### Scenario 1: Upload a PDF and ask a question about it

**Given** the user is logged in and on the chat screen  
**When** they click "Upload Document", select a PDF, and the upload completes  
**Then** the document appears in the thread's document panel with its filename and upload date

**Given** the document is in the thread panel  
**When** the user asks "What are the payment terms in this contract?"  
**Then** the assistant's reply cites the relevant passage and names the source document

---

### Scenario 2: Ask a question that spans multiple documents

**Given** the user has uploaded several meeting-notes files  
**When** they ask "What did we decide about the marketing budget across all recent meetings?"  
**Then** the assistant synthesises information from multiple documents and names each source

---

### Scenario 3: Ask a question with no relevant documents

**Given** the user has uploaded documents about finance  
**When** they ask an unrelated question (e.g., "What's the weather like in Tokyo?")  
**Then** the assistant answers normally from its general knowledge, without hallucinating document content

---

### Scenario 4: Upload a URL

**Given** the user pastes a URL into the upload flow  
**When** they submit it  
**Then** the page content is fetched, extracted, and indexed — becoming searchable like an uploaded file

---

### Scenario 5: Documents deleted with thread

**Given** the user has uploaded documents into a thread  
**When** they delete the thread  
**Then** all documents attached to that thread are deleted along with it and are no longer searchable

**Given** the user wants to remove a single document mid-conversation  
**When** they delete it from the thread panel  
**Then** it is removed from search results immediately without affecting the rest of the thread

---

### Scenario 6: Upload size or format rejection

**Given** the user tries to upload a file that exceeds the size limit or is an unsupported format  
**When** the upload is submitted  
**Then** a clear error message is shown explaining what went wrong, and no partial data is stored

---

## Functional Requirements

### Document Management

**FR-1**: Users can upload files in PDF and plain-text formats into a conversation thread.
**FR-2**: Users can submit a URL to ingest a web page as a document within a thread. URL ingestion applies the same SSRF protection as the existing fetch tool — requests to internal IPs, localhost, and private network ranges are blocked with a descriptive error.
**FR-3**: Documents are scoped to the thread they were uploaded in. No other thread or user can access them.
**FR-4**: Users can view a list of documents attached to the current thread (filename/title, upload date, file size).
**FR-5**: Users can delete individual documents from a thread at any time; deletion removes them from search results immediately. All documents in a thread are deleted automatically when the thread is deleted. When a user account is deleted, all threads and their documents are deleted.
**FR-6**: Uploads are rejected with a descriptive error if the file exceeds 20 MB or is an unsupported format.
**FR-6c**: If an uploaded filename matches an existing document already in the current thread, a confirmation prompt is shown ("A document with this name already exists in this conversation. Upload anyway?"). The user may proceed or cancel; both copies are retained if they proceed.
**FR-6d**: If an uploaded file's content fingerprint matches an existing document in the current thread (regardless of filename), a non-blocking notice is shown ("This content matches an existing document: [name]"). The upload proceeds without requiring confirmation.

### Document Processing

**FR-7**: Uploaded documents are processed asynchronously — the user receives confirmation of upload before processing completes.  
**FR-8**: Processed documents are split into overlapping segments to preserve context across chunk boundaries.  
**FR-9**: Each segment is indexed for semantic similarity search so that queries can retrieve the most relevant passages. The retrieval pipeline uses both semantic (vector) and keyword search, merging and re-ranking results to maximise relevance before passing them to the assistant.  
**FR-10**: Processing status is visible to the user and progresses through granular stages: "Extracting…", "Chunking…", "Embedding…", and finally "Ready". If processing fails, the status reflects the stage that failed (e.g., "Extraction Failed", "Embedding Failed") so the user and support can identify the cause at a glance. Raw file bytes are discarded immediately after text extraction — only the indexed chunks are persisted. If the embedding step errors, the system retries up to 3 times with backoff before marking the document failed. When failed, the error message is specific to the cause: "This PDF is password-protected and cannot be read", "This file appears to be corrupt", or "Indexing service unavailable — please re-upload shortly". A document may also be cancelled by the user during processing — the user clicks a cancel button on the document's status badge in the thread panel, which removes the document and any partial data entirely (as if it was never uploaded). No retry from stored data is possible.

### Retrieval & Assistant Integration

**FR-11**: When a user sends a message, the assistant automatically searches documents attached to the current thread for relevant passages — no explicit user command is needed. Only documents in "Ready" status are searched; documents still indexing are excluded silently (the status badge in the thread panel is the signal to the user). Retrieval returns up to 10 chunks per query, ranked by relevance, to balance context coverage against token cost.
**FR-12**: The retrieved passages and their source documents are provided to the assistant as context for the response.
**FR-13**: The assistant's response includes attribution — it names which document(s) it drew from.
**FR-14**: If no relevant passages are found, the assistant answers from general knowledge without fabricating document content.
**FR-15**: Document search is constrained to documents in the current thread only — no cross-thread retrieval.

### Observability

**FR-16**: The system tracks key performance indicators for each stage of the document lifecycle — upload duration, text extraction duration, embedding duration, retrieval latency, number of chunks retrieved per query, and embedding failures. These metrics are available for monitoring and troubleshooting without requiring direct database inspection.

---

## Success Criteria

1. **Retrieval accuracy**: When a user asks a question directly answerable from an uploaded document, the correct answer is surfaced at least 85% of the time in manual spot-checks.
2. **Upload throughput**: Documents up to 20 MB complete the upload step within 5 seconds on a standard connection.
3. **Indexing time**: A 50-page PDF is fully indexed and searchable within 60 seconds of upload.
4. **No cross-user or cross-thread leakage**: Zero cases where a user can retrieve passages from another user's documents, or from their own documents in a different thread (verified via automated test suite).
5. **Graceful degradation**: When no relevant documents exist, the assistant answers normally — zero cases of fabricated document citations verified in the test suite.
6. **Attribution present**: 100% of responses that use document content include a named source reference.
7. **Operational visibility**: Key processing and retrieval metrics (upload, extraction, embedding, and query latency; chunk counts; failure rates) are captured and available for monitoring from day one.
8. **Query-time responsiveness**: When a user sends a message in a thread with documents, the full response (retrieval + generation) begins streaming within 3 seconds.

---

## Key Entities

| Entity | Description |
|--------|-------------|
| **Document** | A file or URL uploaded within a thread. Has a title, source type (file/URL), status, content fingerprint (SHA-256 hash of the raw content), and upload metadata. The fingerprint enables the system to detect when identical content is uploaded again. Belongs to one thread; deleted when the thread is deleted. |
| **DocumentChunk** | A segment of a Document's text content, with its position in the original document. Carries a semantic embedding used for similarity search and records which embedding model version produced it — enabling future model upgrades without re-processing all existing chunks at once. Deleted when its parent Document is deleted. |
| **Thread** | The conversation container. Owns Documents; deleting a Thread cascades to all its Documents and chunks. Already exists from prior phases. |
| **User** | The authenticated owner of Threads (and therefore Documents, transitively). Already exists from Phase 1. |

---

## Dependencies

- **Phase 1 (Real Auth)** — user identity is required; documents must be scoped per user. ✅ Done.
- **Vector similarity search infrastructure** — a vector store or Postgres extension capable of cosine similarity queries must be available. This is the primary new infrastructure introduced by this feature.
- **Embedding provider** — a model or API capable of producing semantic embeddings for both document chunks and user queries.

---

## Assumptions

1. The embedding provider is the same AI provider already integrated (e.g., OpenAI's embedding endpoint), keeping the provider count stable.
2. Local Ollama embedding models are supported as an alternative for users who prefer on-device processing.
3. Raw file bytes are not persisted. Text is extracted from the upload in-memory, chunked, and embedded — only the resulting chunks and embeddings are stored in the database. Cloud object storage (S3, GCS) is out of scope.
4. The maximum file size is 20 MB per upload. There is no cap on the number of documents per thread.
5. Supported input formats: PDF and plain text (`.txt`, `.md`). HTML (from URL ingestion) is also supported via the existing fetch-URL infrastructure.
6. Chunk size defaults to approximately 500 tokens with a 50-token overlap — a widely used starting point that can be tuned later.
7. All documents are thread-scoped. There is no persistent user-level document library. Deleting a thread deletes all its documents.
8. Once pgvector infrastructure exists, it can also be used to upgrade the memory injection in Phase 2.1 from full injection to semantic retrieval — this is an explicit secondary benefit of this feature.
9. Retrieval combines semantic (vector) similarity and keyword search — a hybrid approach — followed by a re-ranking step to maximise relevance before the results reach the assistant. The exact ranking weights can be tuned after launch.
10. Each document's raw content is fingerprinted with a SHA-256 hash at upload time. The fingerprint is informational (e.g., surfacing "you've uploaded this before") and does not block duplicate uploads.
11. Each document chunk records the embedding model version that produced its vector. This allows a future model upgrade to proceed incrementally rather than requiring a bulk re-embed of all existing chunks.
12. Observability data is captured via the existing structured logging infrastructure and does not require a separate metrics backend in this phase.

---

## Clarifications

### Session 2026-07-30

- Q: Should there be a query-time performance target for retrieval + response generation? → A: Yes — users should see document-informed answers within 3 seconds of sending a message (end-to-end, including retrieval and LLM generation start).
- Q: How many chunks should retrieval return per query? → A: Up to 10 chunks per query, ranked by relevance — balances multi-document synthesis against token cost.
- Q: How does processing cancellation work? → A: Cancel button on the document's status badge; clicking it removes the document and any partial data entirely (as if never uploaded).
- Q: Should the SHA-256 content fingerprint trigger a duplicate warning when the same content is uploaded under a different filename? → A: Show a non-blocking informational notice ("This content matches an existing document: [name]") — upload proceeds without confirmation.

### Session 2026-07-29 (continued)

- Q: Should still-indexing documents be included in search, excluded silently, or should the assistant warn the user? → A: Exclude silently — only "Ready" documents are searched; the status badge is the user-facing signal.
- Q: When document indexing fails, what is the recovery mechanism? → A: Show "Failed" status with a message instructing re-upload. Raw files are discarded after extraction so retry from stored data is not possible.
- Q: Should there be a maximum number of documents per user? → A: No cap — documents are thread-scoped and deleted with the thread; no persistent library to manage.
- Q: Should uploading a duplicate filename be blocked, warned, or allowed silently? → A: Warn with a confirmation prompt (scoped to the current thread); user may proceed or cancel; both copies retained if they proceed.
- Q: What is the data retention policy for documents? → A: Thread-scoped; documents are deleted automatically when their thread is deleted. No time-based expiry. Account deletion cascades to all threads and documents.
- Q: Should all documents be temporary (thread-scoped) or split into personal vs one-shot categories? → A: All documents are thread-scoped — no distinction between personal and one-shot; no persistent user-level library.
- Q: Is there a thread size limit? → A: No explicit limit. The 20 MB per-file cap is the only guard; RAG retrieves top-K chunks so document volume does not directly affect the AI context window.
- Q: Should URL ingestion apply SSRF protection? → A: Yes — reuse the same SSRF protection as the existing fetch_url tool; block internal IPs, localhost, and private network ranges.
- Q: When the embedding API errors during indexing, fail immediately or retry? → A: Retry up to 3 times with backoff internally; show "Failed" only if all 3 attempts fail.
- Q: Should "Failed" status show a generic or cause-specific error message? → A: Specific per cause — password-protected file, corrupt file, and service unavailable each get a distinct actionable message.

---

## Out of Scope for This Spec

- A persistent, user-level document library (documents live only within threads)
- Cross-thread document reuse (re-upload into each thread as needed)
- Shared or team document libraries
- Document versioning or update (delete + re-upload is the workflow)
- OCR for scanned image-based PDFs
- Streaming partial results during document indexing
- A/B testing different chunk sizes or overlap strategies
- Per-thread or per-user storage quotas beyond the 20 MB per-file limit
