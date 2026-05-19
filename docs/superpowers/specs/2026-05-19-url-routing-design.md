# URL Routing for Chat Threads

## Summary

Add client-side URL routing so the browser URL reflects the current chat state: `/chat/new` for a fresh conversation, `/chat/:threadId` for an existing thread. Uses `react-router-dom` v6.

## Routes

| Path | Behavior |
|------|----------|
| `/` | Redirect to `/chat/new` |
| `/chat/new` | Show empty ChatContainer (welcome screen) |
| `/chat/:threadId` | Load and display the thread |
| `*` (catch-all) | Redirect to `/chat/new` |

## Architecture Changes

### State: URL replaces `activeThreadId`

`activeThreadId` state in `App.tsx` is removed. The active thread is derived from the URL via `useParams().threadId`. When the path is `/chat/new`, there is no `threadId` param — this is equivalent to the current `activeThreadId === null`.

The `threads[]` array remains as state in `App.tsx` for the sidebar list.

### Component Tree

```
index.tsx
  BrowserRouter
    App.tsx (threads[], thread CRUD handlers)
      Routes
        / → Navigate to /chat/new
        /chat/new → ChatLayout
        /chat/:threadId → ChatLayout
        * → Navigate to /chat/new
      
ChatLayout (new wrapper, rendered inside App)
  Sidebar (threads, navigation via useNavigate)
  ChatContainer (threadId from useParams)
```

`ChatLayout` is a thin layout component that reads `useParams` and renders Sidebar + ChatContainer. This keeps routing logic out of both Sidebar and ChatContainer.

### Navigation

All navigation changes from state setters to `useNavigate()` calls:

- **"New chat" button** (Sidebar): `navigate('/chat/new')`
- **Thread click** (Sidebar): `navigate('/chat/{threadId}')`
- **Thread created** (ChatContainer, after first message): `navigate('/chat/{newId}', { replace: true })` — uses `replace` so back button goes to the page before the new chat, not to `/chat/new` with an empty screen
- **Thread deleted** (Sidebar): if deleted thread is active, `navigate('/chat/new')`

### Invalid Thread Handling

When `ChatContainer` mounts with a `threadId` from the URL and `fetchThread` returns a 404:

1. Display an inline error message: "Thread not found"
2. After 3 seconds, redirect to `/chat/new`
3. No toast system needed — the error replaces the chat area content temporarily

### Files Changed

| File | Change |
|------|--------|
| `app/package.json` | Add `react-router-dom` dependency |
| `app/src/index.tsx` | Wrap `App` in `BrowserRouter` |
| `app/src/App.tsx` | Remove `activeThreadId` state, add `Routes`, extract layout to `ChatLayout` |
| `app/src/components/ChatContainer/ChatContainer.tsx` | Accept `threadId` as prop (string or undefined) instead of `activeThreadId`. Add 404 handling with timed redirect |
| `app/src/components/Sidebar/Sidebar.tsx` | Navigation callbacks change signature (still receive callbacks from parent, no direct router dependency) |
| `app/src/types/index.ts` | Update prop interfaces (`ChatContainerProps`, `SidebarProps`) |

### What Stays the Same

- Thread CRUD logic (create, delete, fetch) — unchanged
- SSE streaming — unchanged
- Message display — unchanged
- Sidebar visual appearance — unchanged
- Theme toggle — unchanged

## Testing

- Navigate to `/` — should redirect to `/chat/new`
- Click "New chat" — URL changes to `/chat/new`, welcome screen shown
- Send a message — thread created, URL changes to `/chat/{newId}`
- Click a thread in sidebar — URL changes to `/chat/{threadId}`, messages load
- Navigate directly to `/chat/{validId}` — thread loads
- Navigate directly to `/chat/invalid-id` — error shown, redirects to `/chat/new` after 3s
- Browser back/forward — navigates between threads correctly
- Delete active thread — redirects to `/chat/new`
- Navigate to `/random/path` — redirects to `/chat/new`
