# API Contracts: RAG over Personal Documents (007)

All endpoints are under `/api/v1` and require authentication (JWT Bearer token).

---

## Document Management Endpoints

### POST `/api/v1/threads/:threadId/documents`

Upload a file or ingest a URL as a document in the thread.

**Content-Type:** `multipart/form-data` (file upload) or `application/json` (URL ingestion)

**File upload request:**
```
POST /api/v1/threads/:threadId/documents
Content-Type: multipart/form-data

file: <binary file data>
```

**URL ingestion request:**
```json
POST /api/v1/threads/:threadId/documents
Content-Type: application/json

{
  "url": "https://example.com/article"
}
```

**Success response (201 Created):**
```json
{
  "id": "uuid",
  "threadId": "uuid",
  "title": "contract.pdf",
  "sourceType": "file",
  "mimeType": "application/pdf",
  "fileSize": 524288,
  "contentFingerprint": "a1b2c3d4e5f6...",
  "status": "processing",
  "statusMessage": null,
  "chunkCount": 0,
  "createdAt": "2026-07-29T12:00:00.000Z",
  "duplicateNotice": null
}
```

**Error responses:**
| Status | Code | Condition |
|--------|------|-----------|
| 400 | `UNSUPPORTED_FORMAT` | File is not PDF, TXT, or MD |
| 400 | `FILE_TOO_LARGE` | File exceeds 20 MB |
| 400 | `INVALID_URL` | URL is malformed |
| 403 | `SSRF_BLOCKED` | URL resolves to private/internal IP |
| 404 | `THREAD_NOT_FOUND` | Thread does not exist or is not owned by user |
| 422 | `FETCH_FAILED` | URL could not be fetched (timeout, DNS failure, etc.) |

---

### GET `/api/v1/threads/:threadId/documents`

List all documents attached to a thread.

**Success response (200 OK):**
```json
{
  "documents": [
    {
      "id": "uuid",
      "title": "contract.pdf",
      "sourceType": "file",
      "mimeType": "application/pdf",
      "fileSize": 524288,
      "contentFingerprint": "a1b2c3d4e5f6...",
      "status": "ready",
      "statusMessage": null,
      "chunkCount": 42,
      "createdAt": "2026-07-29T12:00:00.000Z"
    }
  ]
}
```

---

### GET `/api/v1/threads/:threadId/documents/:documentId`

Get a single document's metadata.

**Success response (200 OK):** Same shape as a single document object above.

**Error responses:**
| Status | Code | Condition |
|--------|------|-----------|
| 404 | `DOCUMENT_NOT_FOUND` | Document does not exist in this thread |

---

### DELETE `/api/v1/threads/:threadId/documents/:documentId`

Delete a document and all its chunks. Immediate effect on search results.

**Success response (204 No Content)**

**Error responses:**
| Status | Code | Condition |
|--------|------|-----------|
| 404 | `DOCUMENT_NOT_FOUND` | Document does not exist in this thread |

---

### POST `/api/v1/threads/:threadId/documents/:documentId/cancel`

Cancel a document that is still processing. Removes the document and any partial data.

**Precondition:** Document must be in a processing state (`processing`, `extracting`, `chunking`, `embedding`).

**Success response (200 OK):**
```json
{
  "id": "uuid",
  "status": "cancelled",
  "message": "Document processing cancelled and all data removed."
}
```

**Error responses:**
| Status | Code | Condition |
|--------|------|-----------|
| 404 | `DOCUMENT_NOT_FOUND` | Document does not exist in this thread |
| 409 | `DOCUMENT_NOT_PROCESSING` | Document is already in `ready`, `failed`, or `cancelled` state |

---

## SSE Event Extensions

The existing message SSE stream (`POST /api/v1/threads/:threadId/messages`) gains new event types for RAG context:

### `document_search_start`

Emitted when the system begins searching thread documents.

```json
{"type": "document_search_start", "msg_id": "uuid"}
```

### `document_search_result`

Emitted with the sources used to inform the response. Sent before the first `delta` event.

```json
{
  "type": "document_search_result",
  "msg_id": "uuid",
  "sources": [
    {
      "documentId": "uuid",
      "documentTitle": "contract.pdf",
      "chunkIndex": 3,
      "relevanceScore": 0.89,
      "snippet": "The payment terms require..."
    }
  ]
}
```

### `document_search_empty`

Emitted when no relevant documents were found (search ran but returned nothing above threshold).

```json
{"type": "document_search_empty", "msg_id": "uuid"}
```

---

## Internal Tool Definition

The RAG retrieval is implemented as an internal tool (not user-visible) that the agentic loop calls automatically.

### `document_search` tool

**Definition:**
```json
{
  "name": "document_search",
  "description": "Search documents uploaded to this conversation thread for relevant passages. Use this tool when the user asks about or references their uploaded documents.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "The search query — rephrase the user's question as a search query"
      }
    },
    "required": ["query"]
  }
}
```

**Tool result format:**
```json
{
  "success": true,
  "output": "Found 3 relevant passages:\n\n[Source: contract.pdf, chunk 3]\nThe payment terms require...\n\n[Source: contract.pdf, chunk 7]\nLate payments incur a...\n\n[Source: meeting-notes.md, chunk 1]\nWe agreed to extend the...",
  "metadata": {
    "sourcesUsed": ["uuid-1", "uuid-2"],
    "chunksSearched": 42
  }
}
```

---

## Duplicate Checks

### GET `/api/v1/threads/:threadId/documents/check-duplicate?filename=contract.pdf`

Check if a filename already exists in the thread (supports FR-6c confirmation prompt).

**Response (200 OK):**
```json
{
  "filenameMatch": {
    "exists": true,
    "existingDocumentId": "uuid",
    "existingTitle": "contract.pdf"
  }
}
```

### Content Fingerprint Duplicate Detection (FR-6d)

Content fingerprint matching is handled server-side during upload. After the file's SHA-256 hash is computed, the server checks for an existing document in the same thread with the same fingerprint. If a match is found, the upload proceeds normally but the response includes a `duplicateNotice` field:

```json
{
  "id": "uuid",
  "title": "contract-v2.pdf",
  "status": "processing",
  "duplicateNotice": {
    "matchedDocumentId": "uuid",
    "matchedDocumentTitle": "contract.pdf",
    "message": "This content matches an existing document: contract.pdf"
  }
}
```

The frontend displays this as a non-blocking informational toast. The upload is never blocked by content fingerprint matching.
```
