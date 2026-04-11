# Frontend Thread Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing frontend UI to the new `/api/v1/threads` backend API — real thread list in sidebar, persistent messages, thread creation/switching/deletion.

**Architecture:** New `api.js` module handles all HTTP + SSE calls. Thread state (`threads[]`, `activeThreadId`) lifted to App.js. Sidebar receives real threads as props. ChatContainer loads messages from API and streams via the new SSE format.

**Tech Stack:** React 18, existing CSS Modules, no new libraries

---

## File Structure

### New Files
- `app/src/api.js` — API client (REST + SSE streaming)

### Modified Files
- `app/src/App.js` — Thread state owner, passes props to Sidebar + ChatContainer
- `app/src/components/Sidebar/Sidebar.jsx` — Real thread list, new chat, delete
- `app/src/components/Sidebar/Sidebar.module.css` — Active thread, delete button, empty state styles
- `app/src/components/ChatContainer/ChatContainer.js` — Thread-aware messaging with new SSE format

### Unchanged
- `app/src/components/ChatInput/ChatInput.jsx`
- `app/src/components/MessageBubble/MessageBubble.jsx`
- `app/src/components/MessageList/MessageList.jsx`
- `app/src/fetch_message.js` (kept for legacy, no longer used)
- All other CSS modules, `index.js`, `index.css`

---

## Task 1: API Client

**Files:**
- Create: `app/src/api.js`

- [ ] **Step 1: Create api.js**

```javascript
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

export async function fetchThreads() {
  const res = await fetch(`${API_URL}/api/v1/threads`);
  if (!res.ok) throw new Error(`Failed to fetch threads: ${res.status}`);
  return res.json();
}

export async function createThread(model) {
  const res = await fetch(`${API_URL}/api/v1/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new Error(`Failed to create thread: ${res.status}`);
  return res.json();
}

export async function fetchThread(threadId) {
  const res = await fetch(`${API_URL}/api/v1/threads/${threadId}`);
  if (!res.ok) throw new Error(`Failed to fetch thread: ${res.status}`);
  return res.json();
}

export async function deleteThread(threadId) {
  const res = await fetch(`${API_URL}/api/v1/threads/${threadId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete thread: ${res.status}`);
  return res.json();
}

export async function sendMessage(threadId, content, { onCreated, onDelta, onDone, onError }) {
  try {
    const res = await fetch(`${API_URL}/api/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(5));
            switch (data.type) {
              case 'message_created':
                onCreated?.(data);
                break;
              case 'delta':
                onDelta?.(data);
                break;
              case 'done':
                onDone?.(data);
                break;
              case 'error':
                onError?.(data);
                break;
              default:
                break;
            }
          } catch (e) {
            // skip malformed SSE chunks
          }
        }
      }
    }
  } catch (error) {
    onError?.({ message: error.message });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/api.js
git commit -m "feat: add API client for threads and messages"
```

---

## Task 2: Sidebar — Real Thread List

**Files:**
- Modify: `app/src/components/Sidebar/Sidebar.jsx`
- Modify: `app/src/components/Sidebar/Sidebar.module.css`

- [ ] **Step 1: Add CSS classes for active thread, delete button, empty state**

Append to end of `app/src/components/Sidebar/Sidebar.module.css`:

```css
.recentItem.active {
  background-color: var(--sidebar-hover);
  color: var(--sidebar-text-active);
}

.recentTitle {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.deleteBtn {
  display: none;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
}

.deleteBtn:hover {
  color: var(--text-100);
  background-color: var(--sidebar-hover);
}

.recentItem:hover .deleteBtn {
  display: block;
}

.emptyRecents {
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px 10px;
}
```

- [ ] **Step 2: Update Sidebar component**

Replace the component function (line 115 onwards). Keep all SVG icon components unchanged (lines 1–113).

```jsx
const Sidebar = ({ threads = [], activeThreadId, onSelectThread, onNewChat, onDeleteThread }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {collapsed ? (
        <div className={styles.collapsedContent}>
          <button
            className={styles.iconBtn}
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >
            <SidebarToggleIcon />
          </button>
          <div className={styles.collapsedNav}>
            <button className={styles.iconBtn} title="New chat" onClick={onNewChat}>
              <NewChatIcon />
            </button>
            <button className={styles.iconBtn} title="Search">
              <SearchIcon />
            </button>
            <button className={styles.iconBtn} title="Projects">
              <ProjectsIcon />
            </button>
            <button className={styles.iconBtn} title="Chats">
              <ChatIcon />
            </button>
            <button className={styles.iconBtn} title="Artifacts">
              <ArtifactsIcon />
            </button>
            <button className={styles.iconBtn} title="Code">
              <CodeIcon />
            </button>
          </div>
          <div className={styles.collapsedBottom}>
            <div className={styles.avatar}>M</div>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.header}>
            <span className={styles.logo}>AI Sandbox</span>
            <button
              className={styles.collapseBtn}
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
            >
              <SidebarToggleIcon />
            </button>
          </div>

          <nav className={styles.nav}>
            <button className={styles.navItem} onClick={onNewChat}>
              <span className={styles.navIcon}>
                <NewChatIcon />
              </span>
              New chat
            </button>
            <button className={styles.navItem}>
              <span className={styles.navIcon}>
                <SearchIcon />
              </span>
              Search
            </button>
          </nav>

          <div className={styles.divider} />

          <div className={styles.recents}>
            <span className={styles.sectionLabel}>Recents</span>
            {threads.map((thread) => (
              <div
                key={thread.id}
                className={`${styles.recentItem} ${thread.id === activeThreadId ? styles.active : ''}`}
                onClick={() => onSelectThread(thread.id)}
              >
                <span className={styles.recentIcon}>
                  <ChatIcon />
                </span>
                <span className={styles.recentTitle}>
                  {thread.title || 'New chat'}
                </span>
                <button
                  className={styles.deleteBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteThread(thread.id);
                  }}
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            ))}
            {threads.length === 0 && (
              <div className={styles.emptyRecents}>No conversations yet</div>
            )}
          </div>

          <div className={styles.userProfile}>
            <div className={styles.avatar}>M</div>
            <span className={styles.username}>User</span>
          </div>
        </>
      )}
    </aside>
  );
};

export default Sidebar;
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/Sidebar/Sidebar.jsx app/src/components/Sidebar/Sidebar.module.css
git commit -m "feat: wire sidebar to real thread list with delete support"
```

---

## Task 3: ChatContainer — Thread-Aware Messaging

**Files:**
- Modify: `app/src/components/ChatContainer/ChatContainer.js`

- [ ] **Step 1: Rewrite ChatContainer**

Replace the entire file content. Key changes from the original:
- Accepts `activeThreadId`, `onThreadCreated`, `onThreadUpdated` props
- Loads messages from API when `activeThreadId` changes
- Uses `sendMessage()` from `api.js` instead of `listenMessage()` from `fetch_message.js`
- Auto-creates thread on first message if no active thread
- Converts between backend message format (content blocks) and frontend format (text string)

```javascript
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchThread, createThread, sendMessage } from '../../api';
import MessageList from '../MessageList/MessageList';
import ChatInput from '../ChatInput/ChatInput';
import styles from './ChatContainer.module.css';

function ChatContainer({
  activeThreadId,
  onThreadCreated,
  onThreadUpdated,
}) {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [imageData, setImageData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [selectedModel, setSelectedModel] = useState('lama');
  const recognition = useRef(null);
  const fileInputRef = useRef();

  // Load thread messages when activeThreadId changes
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      setError(null);
      return;
    }

    let cancelled = false;

    fetchThread(activeThreadId)
      .then(({ thread, messages: threadMessages }) => {
        if (cancelled) return;
        setSelectedModel(thread.model);
        setMessages(
          threadMessages.map((m) => ({
            id: m.id,
            text: Array.isArray(m.content)
              ? m.content
                  .filter((b) => b.type === 'text')
                  .map((b) => b.text)
                  .join(' ')
              : '',
            sent: m.role === 'user',
            done: true,
          })),
        );
      })
      .catch((err) => {
        if (!cancelled) setError('Failed to load messages: ' + err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  // Speech recognition setup (unchanged from original)
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition ||
      window.mozSpeechRecognition ||
      window.msSpeechRecognition;

    if (!SpeechRecognition) return;

    recognition.current = new SpeechRecognition();
    recognition.current.lang = 'en-US';
    recognition.current.interimResults = true;
    recognition.current.continuous = true;

    recognition.current.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');
      setInputValue(transcript);
    };

    recognition.current.onend = () => {
      setIsListening(false);
    };

    return () => {
      if (recognition.current) {
        recognition.current.abort();
      }
    };
  }, []);

  const startListening = () => {
    setIsListening(true);
    if (recognition.current) {
      recognition.current.start();
    }
  };

  const stopListening = () => {
    if (recognition.current) {
      recognition.current.stop();
    }
    setIsListening(false);
  };

  const dispatchMessage = useCallback(
    async (message) => {
      try {
        setIsLoading(true);
        setError(null);

        // Add user message to UI immediately (optimistic)
        const tempUserId = 'temp-user-' + Date.now();
        const tempAssistantId = 'temp-assistant-' + Date.now();

        setMessages((prev) => [
          ...prev,
          { id: tempUserId, text: message.text, sent: true, done: true },
        ]);
        setInputValue('');
        setImageData(null);
        if (fileInputRef.current) fileInputRef.current.value = '';

        // Create thread if needed (first message on welcome screen)
        let threadId = activeThreadId;
        if (!threadId) {
          const thread = await createThread(selectedModel);
          threadId = thread.id;
          onThreadCreated?.(thread);
        }

        // Build content blocks for API
        const content = [{ type: 'text', text: message.text }];
        if (message.image) {
          content.push({ type: 'image_url', url: message.image });
        }

        // Add assistant placeholder
        setMessages((prev) => [
          ...prev,
          { id: tempAssistantId, text: '', sent: false, done: false },
        ]);

        // Stream response via SSE
        await sendMessage(threadId, content, {
          onCreated: (data) => {
            // Replace temp IDs with real IDs from server
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id === tempUserId) return { ...m, id: data.user_msg_id };
                if (m.id === tempAssistantId) return { ...m, id: data.assistant_msg_id };
                return m;
              }),
            );
          },
          onDelta: (data) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === data.msg_id || (!m.sent && !m.done)
                  ? { ...m, text: m.text + data.text }
                  : m,
              ),
            );
          },
          onDone: (data) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === data.msg_id ? { ...m, done: true } : m)),
            );
            setIsLoading(false);
            // Trigger title refresh in App
            onThreadUpdated?.(threadId);
          },
          onError: (data) => {
            setError(data.message || 'Something went wrong');
            setIsLoading(false);
          },
        });
      } catch (err) {
        setError(err.message);
        setIsLoading(false);
      }
    },
    [activeThreadId, selectedModel, onThreadCreated, onThreadUpdated],
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!inputValue) return;

    if (isListening) {
      stopListening();
    }

    dispatchMessage({
      text: inputValue,
      image: imageData,
      sent: true,
      model: selectedModel,
    });
  };

  const handleImageChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageData(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const inputProps = {
    inputValue,
    setInputValue,
    handleSubmit,
    handleImageChange,
    startListening,
    stopListening,
    isListening,
    isLoading,
    fileInputRef,
    imageData,
    selectedModel,
    onModelChange: setSelectedModel,
  };

  return (
    <div className={styles.container}>
      {messages.length === 0 ? (
        <div className={styles.welcomeScreen}>
          <div className={styles.welcomeIcon}>&#10022;</div>
          <h1 className={styles.welcomeHeading}>How can I help you today?</h1>
          <ChatInput {...inputProps} />
        </div>
      ) : (
        <>
          <MessageList messages={messages} />
          {error && <div className={styles.error}>{error}</div>}
          <ChatInput {...inputProps} />
        </>
      )}
    </div>
  );
}

export default ChatContainer;
```

- [ ] **Step 2: Commit**

```bash
git add app/src/components/ChatContainer/ChatContainer.js
git commit -m "feat: rewrite ChatContainer for thread-based messaging"
```

---

## Task 4: App.js — Wire Everything Together

**Files:**
- Modify: `app/src/App.js`

- [ ] **Step 1: Update App.js with thread state management**

Replace the entire file. SVG icons stay the same. Key additions:
- `threads` state + fetch on mount
- `activeThreadId` state
- Handler functions passed as props to Sidebar and ChatContainer

```javascript
import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import ChatContainer from './components/ChatContainer/ChatContainer';
import Sidebar from './components/Sidebar/Sidebar';
import { fetchThreads, fetchThread, deleteThread } from './api';

const SunIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'light';
  });
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Fetch threads on mount
  useEffect(() => {
    fetchThreads()
      .then(setThreads)
      .catch((err) => console.error('Failed to load threads:', err));
  }, []);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const handleNewChat = useCallback(() => {
    setActiveThreadId(null);
  }, []);

  const handleSelectThread = useCallback((threadId) => {
    setActiveThreadId(threadId);
  }, []);

  const handleDeleteThread = useCallback(
    async (threadId) => {
      try {
        await deleteThread(threadId);
        setThreads((prev) => prev.filter((t) => t.id !== threadId));
        if (activeThreadId === threadId) {
          setActiveThreadId(null);
        }
      } catch (err) {
        console.error('Failed to delete thread:', err);
      }
    },
    [activeThreadId],
  );

  // Called by ChatContainer when a new thread is created (first message)
  const handleThreadCreated = useCallback((thread) => {
    setThreads((prev) => [thread, ...prev]);
    setActiveThreadId(thread.id);
  }, []);

  // Called by ChatContainer after a message completes — refresh thread title
  const handleThreadUpdated = useCallback(async (threadId) => {
    try {
      const { thread } = await fetchThread(threadId);
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, title: thread.title } : t)),
      );
    } catch (err) {
      // silent — title refresh is not critical
    }
  }, []);

  return (
    <div className="App">
      <Sidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewChat={handleNewChat}
        onDeleteThread={handleDeleteThread}
      />
      <div className="mainContent">
        <button
          className="themeToggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? <MoonIcon /> : <SunIcon />}
        </button>
        <ChatContainer
          activeThreadId={activeThreadId}
          onThreadCreated={handleThreadCreated}
          onThreadUpdated={handleThreadUpdated}
        />
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Commit**

```bash
git add app/src/App.js
git commit -m "feat: wire App.js with thread state management"
```

---

## Task 5: Manual Testing

No file changes — verify the full flow works end-to-end.

- [ ] **Step 1: Start backend**

```bash
docker-compose up -d postgres
cd backend && npm start
```

- [ ] **Step 2: Start frontend**

```bash
cd app && npm start
```

- [ ] **Step 3: Test the flow**

1. App loads → sidebar shows "No conversations yet" (empty thread list)
2. Type a message on welcome screen → thread auto-created, message streams
3. Sidebar shows new thread with title (first 60 chars of user message)
4. Click "New chat" → welcome screen appears, sidebar thread stays
5. Send another message → second thread created
6. Click first thread in sidebar → its messages load
7. Click second thread → switches to that conversation
8. Hover a thread → delete button (×) appears
9. Click delete → thread removed from sidebar
10. Toggle dark/light mode → everything still works
11. Refresh page → threads persist, sidebar shows them

- [ ] **Step 4: Verify legacy endpoint still works**

```bash
curl -N -X POST http://localhost:5001/content-completion \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello", "model": "lama"}'
```

Expected: SSE stream response (old format, unchanged).

---

## Future TODOs

- Draft preservation when switching threads
- Search/filter threads in sidebar
- Infinite scroll pagination for thread list
- Inline thread rename (click title to edit)
- Optimistic UI updates
- Thread model indicator in sidebar
- React component tests (set up React Testing Library)
