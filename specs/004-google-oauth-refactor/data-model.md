# Data Model: Google OAuth Refactor

## Overview

This feature adds two database models (`User` and `GoogleOAuthToken`) and introduces the `ToolExecutionContext` TypeScript interface for propagating authenticated user identity through the agentic tool loop. It removes the flat file (`backend/.gmail-tokens.json`) and the `GOOGLE_REFRESH_TOKEN` env var as token storage mechanisms.

---

## Database Models (Prisma)

### 1. User

New model representing an application user. Seed with the hardcoded dev user on first migration.

```prisma
model User {
  id              String            @id @default(uuid())
  email           String            @unique
  displayName     String?           @map("display_name")
  createdAt       DateTime          @default(now()) @map("created_at")
  updatedAt       DateTime          @updatedAt @map("updated_at")
  googleOAuthToken GoogleOAuthToken?

  @@map("users")
}
```

**Seeded record**:
- `id`: `'00000000-0000-0000-0000-000000000001'`
- `email`: `'dev@localhost'`
- `displayName`: `'Dev User'`

**Notes**:
- `Thread.userId` remains a plain string (no FK change in this feature — that's a separate auth refactor).
- `GoogleOAuthToken` has a 1:1 relationship with `User` (one Google connection per user).

---

### 2. GoogleOAuthToken

Stores per-user Google OAuth2 tokens, encrypted at rest.

```prisma
model GoogleOAuthToken {
  id              String   @id @default(uuid())
  userId          String   @unique @map("user_id")
  accessToken     String   @map("access_token")     // AES-256-GCM encrypted
  refreshToken    String   @map("refresh_token")    // AES-256-GCM encrypted
  expiryTimestamp DateTime @map("expiry_timestamp")
  scopes          String[] // e.g. ['gmail.readonly', 'gmail.compose', 'calendar.readonly']
  googleEmail     String   @map("google_email")     // User's connected Gmail address
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("google_oauth_tokens")
}
```

**Field details**:

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | PK, auto-generated |
| `userId` | String | FK → `User.id`, unique (one per user) |
| `accessToken` | String | `iv:ciphertext:authTag` base64, AES-256-GCM encrypted |
| `refreshToken` | String | `iv:ciphertext:authTag` base64, AES-256-GCM encrypted |
| `expiryTimestamp` | DateTime | When the access token expires (from Google's `expiry_date`) |
| `scopes` | String[] | Granted OAuth scopes (stored for incremental consent detection) |
| `googleEmail` | String | Connected Google account email (plaintext, not sensitive) |
| `createdAt` | DateTime | First OAuth connection timestamp |
| `updatedAt` | DateTime | Last token refresh timestamp |

**Lifecycle**:
1. **Created**: On OAuth callback success (`POST /api/v1/auth/google/callback` internal processing).
2. **Updated**: On every automatic token refresh (new `accessToken`, `expiryTimestamp`, `updatedAt`).
3. **Deleted**: On user-initiated disconnect (`DELETE /api/v1/auth/google`) after Google token revocation.

**Validation**:
- `accessToken` and `refreshToken` are required non-empty strings.
- `expiryTimestamp` must be a valid future datetime (checked before use, triggers refresh if past).
- `scopes` must be a non-empty array.

---

## TypeScript Interfaces

### 3. ToolExecutionContext

Carries per-request user identity through the agentic tool loop. Defined in `backend/src/types/context.ts`.

```typescript
export interface ToolExecutionContext {
  userId: string;
}
```

**Used by**:
- `ToolRegistry.execute(name, input, context: ToolExecutionContext)` → passes to tool handler
- `RunnableTool.run(input, context?: ToolExecutionContext)` → tools that need userId call `context?.userId`
- `runAgenticLoop(provider, messages, tools, callbacks, context: ToolExecutionContext)` → threads through loop
- `chatService.processMessage(thread, content, selectedTools, callbacks, userId: string)` → builds context
- `messageController.handleSendMessage` → extracts `req.user!.id`, passes to `processMessage`

**Tools that read userId from context**:
- `googleCalendar.ts` (currently reads from env var `GOOGLE_REFRESH_TOKEN`)
- `readEmails.ts`, `searchEmails.ts`, `draftEmail.ts`, `replyEmail.ts`, `summarizeEmails.ts` (currently hardcode `'00000000-0000-0000-0000-000000000001'`)

**Tools that ignore context**:
- `calculator.ts`, `web_search.ts`, `fetchUrl.ts`, `getCurrentDate.ts`

---

### 4. GoogleConnectionStatus

API response type for `GET /api/v1/auth/google/status`. Defined in `backend/src/types/google.ts`.

```typescript
export interface GoogleConnectionStatus {
  connected: true;
  email: string;       // Connected Google email address
  scopes: string[];    // Granted OAuth scopes
  connectedAt: string; // ISO 8601 timestamp of initial connection
} | {
  connected: false;
  authorizeUrl: string; // URL to initiate OAuth flow
}
```

---

### 5. TokenRecord (internal — not exposed via API)

Internal type used by `GoogleAuthService` to represent a decrypted token record from the database.

```typescript
interface TokenRecord {
  accessToken: string;
  refreshToken: string;
  expiryTimestamp: Date;
  scopes: string[];
  googleEmail: string;
}
```

---

## State Transitions

### OAuth Token Lifecycle

```
[No Token in DB]
    │
    ▼ User clicks "Connect Google" → GET /api/v1/auth/google
[Redirected to Google Consent]
    │
    ▼ User grants consent → GET /api/v1/auth/google/callback
[Token stored encrypted in DB] ──→ GoogleOAuthToken row created
    │
    ├──→ Access token expires (1 hour)
    │        │
    │        ▼ Tool is invoked
    │    [Auto-refresh] → accessToken + expiryTimestamp updated in DB
    │        │
    │        ├── Refresh succeeds → Tool continues ✅
    │        └── Refresh fails (revoked) → DB record deleted, ToolError returned
    │
    └──→ User clicks "Disconnect" → DELETE /api/v1/auth/google
             │
             ▼ Google token revoked + DB record deleted
         [No Token in DB]
```

### ToolExecutionContext Data Flow

```
HTTP Request (req.user.id)
    │
    ▼
messageController.handleSendMessage(req, res)
    │  userId = req.user!.id
    ▼
chatService.processMessage(thread, content, selectedTools, callbacks, userId)
    │  context = { userId }
    ▼
runAgenticLoop(provider, messages, tools, callbacks, context)
    │  context threaded through loop iterations
    ▼
toolRegistry.execute(toolCall.name, toolCall.arguments, context)
    │  context passed to tool handler
    ▼
tool.run(validatedInput, context)
    │  context.userId used to retrieve tokens
    ▼
googleAuthService.getAuthClient(context.userId)
    │
    ▼
Gmail API / Calendar API (user's own tokens)
```

## Removed Storage Mechanisms

| Legacy Storage | Replacement |
|----------------|-------------|
| `backend/.gmail-tokens.json` (file) | `google_oauth_tokens` table (encrypted, per-user) |
| `GOOGLE_REFRESH_TOKEN` env var (Calendar) | `google_oauth_tokens` table (encrypted, per-user) |

Both are removed entirely. Users re-authorize through the new UI after deploying this feature.
