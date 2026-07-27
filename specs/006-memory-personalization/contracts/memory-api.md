# API Contracts: Memory & Personalization

All endpoints require `Authorization: Bearer {accessToken}` and operate on the authenticated user's data only.

Base path: `/api/v1`

---

## Memory Endpoints

### GET /api/v1/memories

List all memories for the authenticated user, most recently updated first.

**Query params**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer | 50 | Max records to return (1–200) |
| `before_id` | UUID | — | Cursor — return records updated before this memory |

**Response `200`**:

```json
{
  "memories": [
    {
      "id": "uuid",
      "content": "User is a senior backend engineer",
      "source": "extracted",
      "sourceThreadId": "uuid-or-null",
      "createdAt": "2026-07-27T10:00:00.000Z",
      "updatedAt": "2026-07-27T10:00:00.000Z"
    }
  ],
  "hasMore": false
}
```

**Errors**: `401` Unauthorized

---

### POST /api/v1/memories

Create a manual memory.

**Request body**:

```json
{
  "content": "My main project is called Orion and uses Prisma + PostgreSQL"
}
```

**Validation**:
- `content`: string, 1–500 characters, required

**Response `201`**:

```json
{
  "id": "uuid",
  "content": "My main project is called Orion and uses Prisma + PostgreSQL",
  "source": "manual",
  "sourceThreadId": null,
  "createdAt": "2026-07-27T10:00:00.000Z",
  "updatedAt": "2026-07-27T10:00:00.000Z"
}
```

**Errors**:

| Status | Code | Condition |
|--------|------|-----------|
| `400` | `validation_error` | Missing/empty content or content > 500 chars |
| `401` | `unauthorized` | No valid token |
| `409` | `duplicate_memory` | Content substantially identical to existing memory |
| `422` | `memory_limit_reached` | User already has 200 memories |

---

### PATCH /api/v1/memories/:id

Update the content of a memory.

**Request body**:

```json
{
  "content": "User is a principal backend engineer"
}
```

**Validation**:
- `content`: string, 1–500 characters, required

**Response `200`**: Updated Memory object (same shape as POST response)

**Errors**:

| Status | Code | Condition |
|--------|------|-----------|
| `400` | `validation_error` | Invalid content |
| `401` | `unauthorized` | No valid token |
| `404` | `not_found` | Memory does not exist or belongs to another user |
| `409` | `duplicate_memory` | Updated content substantially identical to another memory |

---

### DELETE /api/v1/memories/:id

Permanently delete a memory.

**Response `204`**: No body

**Errors**:

| Status | Code | Condition |
|--------|------|-----------|
| `401` | `unauthorized` | No valid token |
| `404` | `not_found` | Memory does not exist or belongs to another user |

---

## User Preferences Endpoints

### GET /api/v1/preferences

Get the authenticated user's preferences. Always returns a record (created with defaults on registration).

**Response `200`**:

```json
{
  "id": "uuid",
  "userId": "uuid",
  "displayName": "Alex",
  "defaultModel": "google",
  "customInstructions": "Always respond in bullet points.",
  "updatedAt": "2026-07-27T10:00:00.000Z"
}
```

`displayName` is read from `User.displayName`. `defaultModel` and `customInstructions` are null if not set.

**Errors**: `401` Unauthorized

---

### PATCH /api/v1/preferences

Update one or more preferences. All fields are optional; unspecified fields are unchanged.

**Request body** (all optional):

```json
{
  "displayName": "Alex",
  "defaultModel": "google",
  "customInstructions": "Always respond in bullet points."
}
```

Pass `null` explicitly to clear a field:

```json
{
  "customInstructions": null
}
```

**Validation**:

| Field | Rules |
|-------|-------|
| `displayName` | string, 1–100 chars, or `null` |
| `defaultModel` | one of `"openai"`, `"google"`, `"deepseek"`, `"lama"`, or `null` |
| `customInstructions` | string, 1–2000 chars, or `null` |

**Response `200`**: Updated preferences object (same shape as GET response)

**Errors**:

| Status | Code | Condition |
|--------|------|-----------|
| `400` | `validation_error` | Field fails validation |
| `401` | `unauthorized` | No valid token |

---

## Changed Behaviour: Thread Creation

`POST /api/v1/threads` now accepts `model` as **optional**.

**Updated request body**:

```json
{
  "model": "google"
}
```

If `model` is omitted, the system uses `UserPreferences.defaultModel` for the authenticated user. If that is also null, defaults to `"openai"`.

**Response**: unchanged (201 Thread object)

---

## Error Response Shape

All error responses follow the existing convention:

```json
{
  "error": {
    "type": "error_code",
    "message": "Human-readable description"
  }
}
```
