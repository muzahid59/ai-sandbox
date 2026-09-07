# Data Model: Human-in-the-Loop Approval Workflow (008)

## Entity Relationship Diagram

```
User 1──* Thread 1──* PendingAction
                  1──* Message 1──? PendingAction
```

Each `PendingAction` belongs to a `Thread` and a `Message` (the assistant message that triggered the tool call). A message has at most one pending action (the loop suspends on the first approval-required tool). A thread has at most one `pending` action at a time (enforced at the service layer).

---

## New Entities

### PendingAction

Represents a tool call that the AI wants to make but which requires user approval before execution.

| Field        | Type              | Constraints                       | Description                                                    |
|--------------|-------------------|-----------------------------------|----------------------------------------------------------------|
| `id`         | UUID              | PK, auto-generated                | Unique pending action identifier                               |
| `threadId`   | String            | FK → Thread.id, NOT NULL, Cascade | Owning thread                                                  |
| `userId`     | String            | FK → User.id, NOT NULL, Cascade   | Owning user (for authorization)                                |
| `messageId`  | String            | FK → Message.id, NOT NULL, Cascade | Assistant message whose content blocks include the tool_use block |
| `toolName`   | String            | NOT NULL, max 100                 | Tool name (e.g. `send_email`)                                  |
| `toolCallId` | String            | NOT NULL, max 100                 | Tool call ID from the AI provider (used to inject tool_result) |
| `arguments`  | Json              | NOT NULL                          | Exact arguments the AI supplied                                |
| `status`     | PendingActionStatus | NOT NULL, default `pending`     | Current lifecycle state                                        |
| `expiresAt`  | DateTime          | NOT NULL                          | When the action auto-expires if not acted on                   |
| `resolvedAt` | DateTime?         | nullable                          | When the action was approved, rejected, or expired             |
| `createdAt`  | DateTime          | auto, NOT NULL                    | Creation timestamp                                             |

**Status enum values:** `pending`, `approved`, `rejected`, `expired`

**State transitions:**
```
              ┌─────────┐
              │ pending  │
              └────┬────┘
                   │
       ┌───────────┼──────────────┐
       ▼           ▼              ▼
 ┌──────────┐ ┌──────────┐ ┌─────────┐
 │ approved │ │ rejected │ │ expired │
 └──────────┘ └──────────┘ └─────────┘
```

All terminal states are final. Attempts to transition from a terminal state return an error (FR8 idempotency).

**Indexes:**
- `@@index([threadId, status])` — find pending actions for a thread (used by per-thread lock check)
- `@@index([userId])` — authorization checks
- `@@index([expiresAt, status])` — background expiry scan

**Cascade behavior:**
- Thread deleted → PendingAction deleted (DB-level cascade)
- Message deleted → PendingAction deleted (DB-level cascade)
- User deleted → PendingAction deleted (DB-level cascade)

---

## Modified Entities

### ToolDefinition (TypeScript interface — not a DB model)

Add `requiresApproval?: boolean` to the existing `ToolDefinition` interface in `backend/src/types/index.ts`. Defaults to `false` when absent.

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JSONSchema;
  requiresApproval?: boolean;   // ← new field
}
```

### Thread (response shape — not a schema change)

`GET /api/v1/threads/:id` response gains a `pendingAction` field (nullable). No Prisma schema change needed — this is computed at query time.

---

## New Enum

```prisma
enum PendingActionStatus {
  pending
  approved
  rejected
  expired
}
```

---

## Prisma Schema Addition

```prisma
enum PendingActionStatus {
  pending
  approved
  rejected
  expired
}

model PendingAction {
  id          String               @id @default(uuid())
  threadId    String               @map("thread_id")
  userId      String               @map("user_id")
  messageId   String               @map("message_id")
  toolName    String               @map("tool_name") @db.VarChar(100)
  toolCallId  String               @map("tool_call_id") @db.VarChar(100)
  arguments   Json
  status      PendingActionStatus  @default(pending)
  expiresAt   DateTime             @map("expires_at")
  resolvedAt  DateTime?            @map("resolved_at")
  createdAt   DateTime             @default(now()) @map("created_at")
  thread      Thread               @relation(fields: [threadId], references: [id], onDelete: Cascade)
  user        User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  message     Message              @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([threadId, status])
  @@index([userId])
  @@index([expiresAt, status])
  @@map("pending_actions")
}
```

Add relations to existing models:

```prisma
// In Thread model, add:
pendingActions  PendingAction[]

// In Message model, add:
pendingAction   PendingAction?

// In User model, add:
pendingActions  PendingAction[]
```

---

## Migration Notes

1. Create the `PendingActionStatus` enum.
2. Create the `pending_actions` table with all indexes.
3. Add FK relations to `threads`, `messages`, and `users` tables.
4. No data backfill required — new table starts empty.

Run:
```bash
cd backend
npx prisma migrate dev --name add-pending-actions
npx prisma generate
```
