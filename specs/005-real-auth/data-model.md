# Data Model: Real JWT Authentication

## Database Changes

### User (modified)

Adds `passwordHash` and the `refreshTokens` relation to the existing `User` model from feature 004.

```prisma
model User {
  id               String            @id @default(uuid())
  email            String            @unique
  displayName      String?           @map("display_name")
  passwordHash     String?           @map("password_hash")
  createdAt        DateTime          @default(now()) @map("created_at")
  updatedAt        DateTime          @updatedAt @map("updated_at")
  googleOAuthToken GoogleOAuthToken?
  refreshTokens    RefreshToken[]

  @@map("users")
}
```

**Migration note**: `passwordHash` is nullable to allow migration against existing rows from the 004 seed. Run `npx prisma migrate reset` (fresh start) before using auth in development.

### RefreshToken (new)

```prisma
model RefreshToken {
  id        String    @id @default(uuid())
  token     String    @unique
  userId    String    @map("user_id")
  expiresAt DateTime  @map("expires_at")
  revokedAt DateTime? @map("revoked_at")
  createdAt DateTime  @default(now()) @map("created_at")
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([token])
  @@index([userId])
  @@map("refresh_tokens")
}
```

---

## Token Design

### Access Token (JWT)

| Property | Value |
|----------|-------|
| Format | JSON Web Token (JWT) |
| Algorithm | HS256 |
| Secret | `JWT_ACCESS_SECRET` env var |
| Expiry | 15 minutes |
| Transport | `Authorization: Bearer <token>` header |
| Frontend storage | In-memory module variable (never localStorage) |

**Payload**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "iat": 1753622400,
  "exp": 1753623300
}
```

### Refresh Token

| Property | Value |
|----------|-------|
| Format | Opaque hex string (64 chars = 32 random bytes) |
| Generation | `crypto.randomBytes(32).toString('hex')` |
| Expiry | 30 days from issuance |
| Transport | `httpOnly` cookie (`refreshToken`) |
| Frontend storage | httpOnly cookie (not accessible to JavaScript) |
| Revocation | `revokedAt` timestamp set on logout |

---

## AuthService Interface

```typescript
interface AuthService {
  // Password
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;

  // Access token
  generateAccessToken(userId: string, email: string): string;
  verifyAccessToken(token: string): { id: string; email: string };

  // Refresh token
  generateRefreshToken(): string;
  createRefreshTokenRecord(userId: string, token: string): Promise<RefreshToken>;
  findValidRefreshToken(token: string): Promise<RefreshToken | null>;
  revokeRefreshToken(token: string): Promise<void>;
}
```

---

## Frontend Auth State

```typescript
// authService.ts — module-level (not React state)
let accessToken: string | null = null;

// AuthUser mirrors backend's AuthUser interface
interface AuthUser {
  id: string;
  email: string;
}

// App-level auth state (passed as props per existing prop-drilling pattern)
interface AuthState {
  user: AuthUser | null;       // null = not authenticated
  isLoading: boolean;          // true during initial silent refresh attempt
}
```

**Bootstrap flow**: On app load, `App.tsx` calls `authService.tryRestoreSession()` which attempts `POST /auth/refresh` using the stored httpOnly cookie. If it succeeds, the access token is stored in memory and the app renders normally. If it fails (no cookie, expired, revoked), the user is redirected to `/login`.

---

## Validation Rules

| Field | Rule |
|-------|------|
| `email` | Must match email format; normalised to lowercase before storage |
| `password` | 8–1024 characters; validated client-side before server submission |
| `passwordHash` | bcryptjs hash, cost factor 12 |
