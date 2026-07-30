# Data Model: RAG over Personal Documents (007)

## Entity Relationship Diagram

```
User 1──* Thread 1──* Document 1──* DocumentChunk
                  1──* Message
```

## New Entities

### Document

Represents an uploaded file or ingested URL attached to a thread.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, auto-generated | Unique document identifier |
| `threadId` | UUID | FK → Thread.id, NOT NULL | Owning thread; cascade delete |
| `userId` | UUID | FK → User.id, NOT NULL | Uploading user; cascade delete |
| `title` | String | NOT NULL, max 255 | Original filename or page title |
| `sourceType` | Enum(`file`, `url`) | NOT NULL | How the document was ingested |
| `sourceUrl` | String? | nullable, max 2048 | Original URL if sourceType is `url` |
| `mimeType` | String | NOT NULL, max 127 | MIME type (e.g., `application/pdf`, `text/plain`) |
| `fileSize` | Int | NOT NULL | Original file size in bytes |
| `status` | Enum | NOT NULL, default `processing` | Processing state |
| `statusMessage` | String? | nullable, max 500 | Human-readable status detail (error messages) |
| `chunkCount` | Int | default 0 | Number of chunks created |
| `createdAt` | DateTime | auto, NOT NULL | Upload timestamp |
| `updatedAt` | DateTime | auto-update | Last status change |

**Status enum values:** `processing`, `ready`, `failed`

**Indexes:**
- `@@index([threadId, status])` — filter documents by thread and status for retrieval queries
- `@@index([userId])` — support user-level cascading

**Cascade behavior:**
- Thread deleted → Document deleted (DB-level cascade)
- User deleted → Document deleted (DB-level cascade)
- Document deleted → all DocumentChunks deleted (DB-level cascade)

### DocumentChunk

A segment of a document's extracted text, with its vector embedding.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, auto-generated | Unique chunk identifier |
| `documentId` | UUID | FK → Document.id, NOT NULL | Parent document; cascade delete |
| `chunkIndex` | Int | NOT NULL | Position in the original document (0-based) |
| `content` | Text | NOT NULL | Plain text content of this chunk |
| `tokenCount` | Int | NOT NULL | Approximate token count |
| `embedding` | vector(1536) | NOT NULL | Semantic embedding from OpenAI |
| `createdAt` | DateTime | auto, NOT NULL | Creation timestamp |

**Indexes:**
- `@@index([documentId])` — retrieve all chunks for a document
- HNSW index on `embedding` with cosine distance — vector similarity search

**Notes:**
- The `embedding` column uses pgvector's `vector(1536)` type
- Prisma models it as `Unsupported("vector(1536)")` — all vector ops use raw SQL
- The HNSW index is created via a raw SQL migration, not Prisma's `@@index`

## New Enums

### DocumentSourceType
```prisma
enum DocumentSourceType {
  file
  url
}
```

### DocumentStatus
```prisma
enum DocumentStatus {
  processing
  ready
  failed
}
```

## Prisma Schema Additions

```prisma
model Document {
  id            String             @id @default(uuid())
  threadId      String             @map("thread_id")
  userId        String             @map("user_id")
  title         String             @db.VarChar(255)
  sourceType    DocumentSourceType @map("source_type")
  sourceUrl     String?            @map("source_url") @db.VarChar(2048)
  mimeType      String             @map("mime_type") @db.VarChar(127)
  fileSize      Int                @map("file_size")
  status        DocumentStatus     @default(processing)
  statusMessage String?            @map("status_message") @db.VarChar(500)
  chunkCount    Int                @default(0) @map("chunk_count")
  createdAt     DateTime           @default(now()) @map("created_at")
  updatedAt     DateTime           @updatedAt @map("updated_at")
  thread        Thread             @relation(fields: [threadId], references: [id], onDelete: Cascade)
  user          User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  chunks        DocumentChunk[]

  @@index([threadId, status])
  @@index([userId])
  @@map("documents")
}

model DocumentChunk {
  id         String                          @id @default(uuid())
  documentId String                          @map("document_id")
  chunkIndex Int                             @map("chunk_index")
  content    String                          @db.Text
  tokenCount Int                             @map("token_count")
  embedding  Unsupported("vector(1536)")?
  createdAt  DateTime                        @default(now()) @map("created_at")
  document   Document                        @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@map("document_chunks")
}
```

## Migration Notes

1. **Enable pgvector extension** — Add `CREATE EXTENSION IF NOT EXISTS vector;` as the first statement in the migration.
2. **HNSW index** — Add via raw SQL in the migration:
   ```sql
   CREATE INDEX idx_document_chunks_embedding
   ON document_chunks
   USING hnsw (embedding vector_cosine_ops)
   WITH (m = 16, ef_construction = 64);
   ```
3. **Docker image swap** — Change `postgres:16-alpine` to `pgvector/pgvector:pg16` in `docker-compose.yml`.
4. **Thread model update** — Add `documents Document[]` relation to the existing Thread model.
5. **User model update** — Add `documents Document[]` relation to the existing User model.

## State Transitions

```
Document lifecycle:
  ┌──────────────┐     success     ┌─────────┐
  │  processing  │ ──────────────→ │  ready   │
  └──────────────┘                 └─────────┘
         │
         │ failure (after 3 retries)
         ▼
    ┌──────────┐
    │  failed   │
    └──────────┘
```

Failed documents cannot be retried from stored data (raw bytes are discarded). The user must re-upload.
