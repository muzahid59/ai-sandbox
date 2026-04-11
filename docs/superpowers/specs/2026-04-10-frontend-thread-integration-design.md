# Frontend Thread Integration Design

## Goal

Wire the existing frontend UI to the new `/api/v1/threads` backend API — real thread list in sidebar, persistent messages, thread creation/switching/deletion.

## Architecture

Lift thread state (`threads[]`, `activeThreadId`) to App.js. New `api.js` module handles all HTTP calls. ChatContainer receives `activeThreadId` and loads messages from the API. Sidebar displays real threads fetched from the backend.

No new libraries. No new components. No CSS changes. This is a wiring exercise.

## State Architecture

```
App.js (threads[], activeThreadId, thread CRUD handlers)
  ├── Sidebar (threads, activeThreadId, onSelectThread, onNewChat, onDeleteThread)
  └── ChatContainer (activeThreadId, model from active thread)
        ├── MessageList (messages)
        ├── MessageBubble (message)
        └── ChatInput (inputValue, model, handlers)
```

### App.js — Thread State Owner

- `threads`: array of thread objects from API
- `activeThreadId`: UUID of currently viewed thread (null = welcome screen)
- On mount: fetch threads via `GET /api/v1/threads`
- Handlers passed down:
  - `handleNewChat()` — POST /api/v1/threads with selected model, set as active
  - `handleSelectThread(id)` — set activeThreadId
  - `handleDeleteThread(id)` — DELETE /api/v1/threads/:id, remove from list, clear active if deleted

### Sidebar — Real Thread List

- Replace hardcoded `recentChats` array with `threads` prop
- Each thread shows `thread.title || "New chat"` with text overflow ellipsis
- Active thread highlighted
- "New chat" button calls `onNewChat()`
- Delete action on threads (hover button or similar)
- Collapsed sidebar: unchanged (icon-only, no thread titles)

### ChatContainer — Thread-Aware

- Receives `activeThreadId` prop
- When `activeThreadId` changes: fetch thread + messages via `GET /api/v1/threads/:id`, populate messages state
- When `activeThreadId` is null: show welcome screen
- On send message: call `sendMessage(activeThreadId, content)` which POSTs to `/api/v1/threads/:id/messages`
- If no active thread exists on send: auto-create thread first, then send message
- Model selection: use `thread.model` from active thread; on new chat, use currently selected model

### fetch_message.js → api.js (New File)

Replace `fetch_message.js` with `api.js` that handles both REST calls and SSE streaming.

```
api.js exports:
  - fetchThreads() → GET /api/v1/threads → Thread[]
  - createThread(model) → POST /api/v1/threads → Thread
  - fetchThread(id) → GET /api/v1/threads/:id → { thread, messages }
  - updateThread(id, data) → PATCH /api/v1/threads/:id → Thread
  - deleteThread(id) → DELETE /api/v1/threads/:id → Thread
  - sendMessage(threadId, content, onDelta, onDone, onError) → POST /api/v1/threads/:id/messages (SSE)
```

### SSE Format Change

Old format from `/content-completion`:
```
data: {"text": "chunk"}
(stream ends → done)
```

New format from `/api/v1/threads/:id/messages`:
```
data: {"type": "message_created", "user_msg_id": "...", "assistant_msg_id": "..."}
data: {"type": "delta", "text": "chunk", "msg_id": "..."}
data: {"type": "done", "msg_id": "...", "stop_reason": "end_turn"}
data: {"type": "error", "code": "...", "message": "...", "retryable": true}
```

### Message Format Mapping

Backend messages have `{ id, role, content: [{type: "text", text: "..."}], status }`.
Frontend messages have `{ id, text, sent, done }`.

Convert on fetch:
- `sent: role === 'user'`
- `text: content[0].text`
- `done: status === 'complete'`

Convert on send:
- `content: [{ type: "text", text: inputValue }]`

## Files Changed

| File | Change |
|------|--------|
| `app/src/api.js` | **New** — API client (REST + SSE) |
| `app/src/App.js` | Add thread state, fetch threads on mount, pass handlers to Sidebar + ChatContainer |
| `app/src/components/Sidebar/Sidebar.jsx` | Replace hardcoded recents with `threads` prop, wire New Chat + delete |
| `app/src/components/ChatContainer/ChatContainer.js` | Accept `activeThreadId`, load messages from API, use `sendMessage()` for SSE |
| `app/src/fetch_message.js` | **Kept** for legacy `/content-completion` compatibility, but no longer used by ChatContainer |

## Files Unchanged

- `ChatInput.jsx` — no changes (still emits text + model + image)
- `MessageBubble.jsx` — no changes
- `MessageList.jsx` — no changes
- All CSS modules — no changes
- `index.js`, `index.css` — no changes

## Future TODOs

- Draft preservation when switching threads
- Search/filter threads
- Infinite scroll pagination for thread list
- Inline thread rename (click title to edit)
- Optimistic UI updates (show message before API confirms)
- Thread model indicator in sidebar
