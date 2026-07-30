# Quickstart: RAG over Personal Documents (007)

## Prerequisites

- Docker and docker-compose installed
- OpenAI API key with access to `text-embedding-3-small`
- Node.js 18+

## Setup

### 1. Docker — swap PostgreSQL image for pgvector

In `docker-compose.yml`, change the postgres service image:

```yaml
# Before
image: postgres:16-alpine

# After
image: pgvector/pgvector:pg16
```

### 2. Add new dependencies

```bash
cd backend
npm install pdf-parse pgvector multer
npm install -D @types/multer
```

### 3. Run database migration

```bash
cd backend
npx prisma migrate dev --name add-documents-and-chunks
```

This creates the `documents` and `document_chunks` tables with the pgvector extension enabled.

### 4. Verify pgvector is working

```bash
docker-compose exec postgres psql -U ai_sandbox -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
```

Expected output: `vector` in the result set.

### 5. Start the stack

```bash
docker-compose up --build
```

## Testing the feature

### Upload a document

```bash
curl -X POST http://localhost:5001/api/v1/threads/{threadId}/documents \
  -H "Authorization: Bearer {token}" \
  -F "file=@/path/to/document.pdf"
```

### Check document status

```bash
curl http://localhost:5001/api/v1/threads/{threadId}/documents \
  -H "Authorization: Bearer {token}"
```

Wait for `"status": "ready"` before querying.

### Ask a question

Send a normal message — document search happens automatically:

```bash
curl -X POST http://localhost:5001/api/v1/threads/{threadId}/messages \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"content": "What are the payment terms in this contract?"}'
```

The SSE stream will include `document_search_result` events with source citations.

### Ingest a URL

```bash
curl -X POST http://localhost:5001/api/v1/threads/{threadId}/documents \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article"}'
```

### Delete a document

```bash
curl -X DELETE http://localhost:5001/api/v1/threads/{threadId}/documents/{documentId} \
  -H "Authorization: Bearer {token}"
```

## Key files to know

| File | Purpose |
|------|---------|
| `backend/prisma/schema.prisma` | Document + DocumentChunk models |
| `backend/src/services/documentService.ts` | Upload, process, delete operations |
| `backend/src/services/embeddingService.ts` | OpenAI embedding API client |
| `backend/src/services/retrievalService.ts` | Vector similarity search |
| `backend/src/tools/documentSearch.ts` | RAG tool definition + handler |
| `backend/src/controllers/documentController.ts` | REST endpoint handlers |
| `backend/src/routes/documentRoutes.ts` | Express route definitions |
| `app/src/components/DocumentPanel.tsx` | Frontend document list UI |
| `app/src/components/DocumentUpload.tsx` | Upload button + drag-and-drop |

## Environment variables

Add to `backend/.env`:

```
# Already present — used for embeddings
OPENAI_API_KEY=sk-...

# No new env vars needed — embedding model is hardcoded to text-embedding-3-small
```
