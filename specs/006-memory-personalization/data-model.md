# Data Model: Memory & Personalization

## New Entities

### Memory

Represents a single remembered fact about a user.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK, auto-generated | |
| `userId` | UUID | FK → User, NOT NULL | Cascades on User delete |
| `content` | String | VARCHAR(500), NOT NULL | The remembered fact |
| `source` | MemorySource enum | NOT NULL | `manual` or `extracted` |
| `sourceThreadId` | UUID | FK → Thread, nullable | Set when `source = extracted`; SetNull on Thread delete |
| `createdAt` | DateTime | NOT NULL, default now() | |
| `updatedAt` | DateTime | NOT NULL, auto-updated | Used for recency-based injection ordering |

**Business rules**:
- A user may have at most 200 active memories (enforced at service layer, not DB)
- Content must be 1–500 characters (enforced at API validation + DB VARCHAR)
- Deletion is permanent (no soft-delete)
- Duplicate detection runs before insert (Jaccard similarity ≥ 0.75 → skip)

**Indexes**:
- `(userId, updatedAt DESC)` — primary query for injection (all memories sorted by recency)
- `userId` alone covered by the compound index above

---

### UserPreferences

One-to-one extension of User for personalization settings.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | UUID | PK, auto-generated | |
| `userId` | UUID | Unique FK → User, NOT NULL | Cascades on User delete; unique enforces one-to-one |
| `defaultModel` | String | nullable, max 50 chars | Validated enum at API layer: `openai`, `google`, `deepseek`, `lama` |
| `customInstructions` | String | VARCHAR(2000), nullable | Prepended to every system prompt |
| `createdAt` | DateTime | NOT NULL, default now() | |
| `updatedAt` | DateTime | NOT NULL, auto-updated | |

**Business rules**:
- Created atomically with User on registration (always exists)
- `defaultModel` null → fall back to `"openai"` on thread creation
- `customInstructions` null or empty → no instructions block in system prompt
- `customInstructions` max 2,000 characters enforced at API + DB VARCHAR
- Display name preference is stored in `User.displayName` (already exists in schema)

---

## Schema Changes

### New enum

```prisma
enum MemorySource {
  manual
  extracted
}
```

### New model: Memory

```prisma
model Memory {
  id             String       @id @default(uuid())
  userId         String       @map("user_id")
  content        String       @db.VarChar(500)
  source         MemorySource
  sourceThreadId String?      @map("source_thread_id")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  sourceThread   Thread?      @relation("MemorySourceThread", fields: [sourceThreadId], references: [id], onDelete: SetNull)

  @@index([userId, updatedAt(sort: Desc)])
  @@map("memories")
}
```

### New model: UserPreferences

```prisma
model UserPreferences {
  id                 String   @id @default(uuid())
  userId             String   @unique @map("user_id")
  defaultModel       String?  @map("default_model")
  customInstructions String?  @db.VarChar(2000) @map("custom_instructions")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```

### Modified model: User

Add two new relations (no new columns):

```prisma
model User {
  // ... existing fields unchanged ...
  memories        Memory[]
  preferences     UserPreferences?
}
```

### Modified model: Thread

Add back-relation for Memory (Prisma requires this when Memory references Thread):

```prisma
model Thread {
  // ... existing fields unchanged ...
  extractedMemories Memory[] @relation("MemorySourceThread")
}
```

---

## Migration

```bash
cd backend
npx prisma migrate dev --name add-memory-and-user-preferences
npx prisma generate
```

No existing data is affected: new tables only, no changes to existing columns on `User` or `Thread`.

---

## Entity Relationships

```
User (1) ──────────── (1) UserPreferences
User (1) ──────────── (*) Memory
Thread (1) ─────────── (*) Memory  [sourceThread → nullable]
```

---

## TypeScript Types (shared/types additions)

```typescript
// shared/types/memory.ts

export type MemorySource = 'manual' | 'extracted';

export interface Memory {
  id: string;
  userId: string;
  content: string;
  source: MemorySource;
  sourceThreadId: string | null;
  createdAt: string;  // ISO 8601
  updatedAt: string;
}

export interface UserPreferences {
  id: string;
  userId: string;
  displayName: string | null;  // reads from User.displayName
  defaultModel: string | null;
  customInstructions: string | null;
  updatedAt: string;
}
```
