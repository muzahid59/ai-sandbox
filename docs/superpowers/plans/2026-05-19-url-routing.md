# URL Routing for Chat Threads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side URL routing so `/chat/new` shows a fresh chat and `/chat/:threadId` loads an existing thread.

**Architecture:** Install `react-router-dom` v6. Replace `activeThreadId` state with URL-derived params via `useParams`. Introduce a `ChatLayout` component that reads route params and renders Sidebar + ChatContainer. All navigation uses `useNavigate()`.

**Tech Stack:** react-router-dom v6, React 18, TypeScript

---

## File Structure

| File | Role |
|------|------|
| `app/src/index.tsx` | Wrap `<App>` in `<BrowserRouter>` |
| `app/src/App.tsx` | Define `<Routes>`, remove `activeThreadId` state, move layout into `ChatLayout` |
| `app/src/components/ChatLayout/ChatLayout.tsx` | New thin layout: reads `useParams`, wires navigation callbacks, renders Sidebar + ChatContainer |
| `app/src/components/ChatContainer/ChatContainer.tsx` | Accept `threadId: string | undefined` prop, add 404 handling with timed redirect |
| `app/src/components/ChatContainer/ChatContainer.module.css` | Add error screen styles |
| `app/src/components/Sidebar/Sidebar.tsx` | No changes needed (already receives callbacks as props) |
| `app/src/types/index.ts` | Update `ChatContainerProps` and `SidebarProps` interfaces |

---

### Task 1: Install react-router-dom

**Files:**
- Modify: `app/package.json`

- [ ] **Step 1: Install the dependency**

```bash
cd app && npm install react-router-dom
```

- [ ] **Step 2: Verify installation**

```bash
cd app && node -e "console.log(require('react-router-dom/package.json').version)"
```

Expected: Version 6.x or 7.x printed.

- [ ] **Step 3: Commit**

```bash
git add app/package.json app/package-lock.json
git commit -m "feat: add react-router-dom dependency"
```

---

### Task 2: Update type interfaces

**Files:**
- Modify: `app/src/types/index.ts`

- [ ] **Step 1: Update ChatContainerProps and SidebarProps**

Replace the existing `ChatContainerProps` and `SidebarProps` interfaces:

```typescript
// Replace this:
export interface ChatContainerProps {
  activeThreadId: string | null;
  onThreadCreated?: (thread: Thread) => void;
  onThreadUpdated?: (threadId: string) => void;
}
// With this:
export interface ChatContainerProps {
  threadId: string | undefined;
  onThreadCreated?: (thread: Thread) => void;
  onThreadUpdated?: (threadId: string) => void;
}
```

```typescript
// Replace this:
export interface SidebarProps {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  onDeleteThread: (threadId: string) => void;
}
// With this:
export interface SidebarProps {
  threads: Thread[];
  activeThreadId: string | undefined;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  onDeleteThread: (threadId: string) => void;
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd app && npx tsc --noEmit 2>&1 | head -30
```

Expected: Type errors in `App.tsx` and `ChatContainer.tsx` (expected — those files haven't been updated yet). No errors in `types/index.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add app/src/types/index.ts
git commit -m "feat: update prop interfaces for URL routing"
```

---

### Task 3: Wrap App in BrowserRouter

**Files:**
- Modify: `app/src/index.tsx`

- [ ] **Step 1: Add BrowserRouter to index.tsx**

Replace the entire content of `app/src/index.tsx`:

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

reportWebVitals();
```

- [ ] **Step 2: Commit**

```bash
git add app/src/index.tsx
git commit -m "feat: wrap App in BrowserRouter"
```

---

### Task 4: Create ChatLayout component

**Files:**
- Create: `app/src/components/ChatLayout/ChatLayout.tsx`

- [ ] **Step 1: Create the ChatLayout component**

This component reads `useParams` and `useNavigate`, then renders Sidebar + ChatContainer with the correct props. It also contains the theme toggle.

Create `app/src/components/ChatLayout/ChatLayout.tsx`:

```typescript
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Sidebar from '../Sidebar/Sidebar';
import ChatContainer from '../ChatContainer/ChatContainer';
import type { Thread } from '../../types';

interface ChatLayoutProps {
  threads: Thread[];
  onThreadCreated: (thread: Thread) => void;
  onThreadUpdated: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  themeToggle: React.ReactNode;
}

const ChatLayout: React.FC<ChatLayoutProps> = ({
  threads,
  onThreadCreated,
  onThreadUpdated,
  onDeleteThread,
  themeToggle,
}) => {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();

  const handleNewChat = () => {
    navigate('/chat/new');
  };

  const handleSelectThread = (id: string) => {
    navigate(`/chat/${id}`);
  };

  const handleDeleteThread = (id: string) => {
    onDeleteThread(id);
    if (threadId === id) {
      navigate('/chat/new');
    }
  };

  const handleThreadCreated = (thread: Thread) => {
    onThreadCreated(thread);
    navigate(`/chat/${thread.id}`, { replace: true });
  };

  return (
    <>
      <Sidebar
        threads={threads}
        activeThreadId={threadId}
        onSelectThread={handleSelectThread}
        onNewChat={handleNewChat}
        onDeleteThread={handleDeleteThread}
      />
      <div className="mainContent">
        {themeToggle}
        <ChatContainer
          threadId={threadId}
          onThreadCreated={handleThreadCreated}
          onThreadUpdated={onThreadUpdated}
        />
      </div>
    </>
  );
};

export default ChatLayout;
```

- [ ] **Step 2: Commit**

```bash
git add app/src/components/ChatLayout/ChatLayout.tsx
git commit -m "feat: create ChatLayout component for routing"
```

---

### Task 5: Refactor App.tsx to use Routes

**Files:**
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Replace App.tsx with route-based version**

Replace the entire content of `app/src/App.tsx`:

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import ChatLayout from './components/ChatLayout/ChatLayout';
import { fetchThreads, deleteThread } from './api';
import type { Thread } from './types';

const SunIcon: React.FC = () => (
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

const MoonIcon: React.FC = () => (
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
  const [threads, setThreads] = useState<Thread[]>([]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    fetchThreads()
      .then((data) => setThreads(data as Thread[]))
      .catch((err: unknown) => console.error('Failed to load threads:', err));
  }, []);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const handleDeleteThread = useCallback(async (threadId: string) => {
    try {
      await deleteThread(threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
    } catch (err) {
      console.error('Failed to delete thread:', err);
    }
  }, []);

  const handleThreadCreated = useCallback((thread: Thread) => {
    setThreads((prev) => [thread, ...prev]);
  }, []);

  const handleThreadUpdated = useCallback(async (threadId: string) => {
    try {
      const { fetchThread } = await import('./api');
      const { thread } = await fetchThread(threadId);
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, title: thread.title } : t))
      );
    } catch {
      // silent — title refresh is not critical
    }
  }, []);

  const themeToggle = (
    <button
      className="themeToggle"
      onClick={toggleTheme}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );

  const layoutProps = {
    threads,
    onThreadCreated: handleThreadCreated,
    onThreadUpdated: handleThreadUpdated,
    onDeleteThread: handleDeleteThread,
    themeToggle,
  };

  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<Navigate to="/chat/new" replace />} />
        <Route path="/chat/new" element={<ChatLayout {...layoutProps} />} />
        <Route path="/chat/:threadId" element={<ChatLayout {...layoutProps} />} />
        <Route path="*" element={<Navigate to="/chat/new" replace />} />
      </Routes>
    </div>
  );
}

export default App;
```

Key changes from the original:
- Removed `activeThreadId` state entirely
- Removed `handleNewChat`, `handleSelectThread` (moved to ChatLayout)
- `handleDeleteThread` no longer checks `activeThreadId` (ChatLayout handles redirect)
- `handleThreadCreated` no longer calls `setActiveThreadId` (ChatLayout handles navigation)
- `handleThreadUpdated` uses dynamic import for `fetchThread` to avoid importing it at top level alongside the re-exported `fetchThread` from `./api` (which is already used via `fetchThreads`)
- Theme toggle passed as a ReactNode prop to ChatLayout

- [ ] **Step 2: Verify types compile**

```bash
cd app && npx tsc --noEmit 2>&1 | head -30
```

Expected: Errors only in `ChatContainer.tsx` (still using `activeThreadId` prop). All other files should be clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/App.tsx
git commit -m "feat: refactor App.tsx to use react-router Routes"
```

---

### Task 6: Update ChatContainer for URL-based threadId and 404 handling

**Files:**
- Modify: `app/src/components/ChatContainer/ChatContainer.tsx`
- Modify: `app/src/components/ChatContainer/ChatContainer.module.css`

- [ ] **Step 1: Add error screen styles**

Append to `app/src/components/ChatContainer/ChatContainer.module.css`:

```css
.errorScreen {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-bottom: 120px;
  gap: 12px;
}

.errorIcon {
  font-size: 40px;
  color: var(--text-300);
}

.errorHeading {
  font-size: 20px;
  font-weight: 400;
  color: var(--text-100);
  margin: 0;
}

.errorSubtext {
  font-size: 14px;
  color: var(--text-300);
  margin: 0;
}
```

- [ ] **Step 2: Update ChatContainer.tsx**

Replace the entire content of `app/src/components/ChatContainer/ChatContainer.tsx`:

```typescript
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchThread, createThread, sendMessage } from '../../api';
import MessageList from '../MessageList/MessageList';
import ChatInput from '../ChatInput/ChatInput';
import type { UIMessage, ChatContainerProps } from '../../types';
import styles from './ChatContainer.module.css';

interface DispatchPayload {
  text: string;
  image: string | null;
}

const ChatContainer: React.FC<ChatContainerProps> = ({
  threadId,
  onThreadCreated,
  onThreadUpdated,
}) => {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [imageData, setImageData] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedModel, setSelectedModel] = useState('lama');
  const [selectedTools, setSelectedTools] = useState(['calculator', 'web_search', 'fetch_url', 'google_calendar']);
  const [threadNotFound, setThreadNotFound] = useState(false);
  const recognition = useRef<SpeechRecognition | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextFetchRef = useRef(false);

  useEffect(() => {
    setThreadNotFound(false);

    if (!threadId) {
      setMessages([]);
      return;
    }

    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    let cancelled = false;

    fetchThread(threadId)
      .then(({ thread, messages: threadMessages }) => {
        if (cancelled) return;
        setSelectedModel(thread.model);
        setMessages(
          threadMessages.map((m) => ({
            id: m.id,
            text: Array.isArray(m.content)
              ? m.content
                  .filter((b) => b.type === 'text')
                  .map((b) => b.text ?? '')
                  .join(' ')
              : '',
            sent: m.role === 'user',
            done: true,
          })),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Failed to load thread:', err);
        setThreadNotFound(true);
        const timer = setTimeout(() => {
          if (!cancelled) {
            navigate('/chat/new', { replace: true });
          }
        }, 3000);
        return () => clearTimeout(timer);
      });

    return () => {
      cancelled = true;
    };
  }, [threadId, navigate]);

  useEffect(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition ||
      window.mozSpeechRecognition ||
      window.msSpeechRecognition;

    if (!SpeechRecognitionCtor) return;

    recognition.current = new SpeechRecognitionCtor();
    recognition.current.lang = 'en-US';
    recognition.current.interimResults = true;
    recognition.current.continuous = true;

    recognition.current.onresult = (event: SpeechRecognitionEvent) => {
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
    async (payload: DispatchPayload) => {
      const tempAssistantId = 'temp-assistant-' + Date.now();
      try {
        setIsLoading(true);

        const tempUserId = 'temp-user-' + Date.now();

        setMessages((prev) => [
          ...prev,
          { id: tempUserId, text: payload.text, sent: true, done: true },
        ]);
        setInputValue('');
        setImageData(null);
        if (fileInputRef.current) fileInputRef.current.value = '';

        let currentThreadId = threadId;
        if (!currentThreadId) {
          const thread = await createThread(selectedModel);
          currentThreadId = thread.id;
          skipNextFetchRef.current = true;
          onThreadCreated?.(thread);
        }

        const content: Array<{ type: string; text?: string; url?: string }> = [{ type: 'text', text: payload.text }];
        if (payload.image) {
          content.push({ type: 'image_url', url: payload.image });
        }

        setMessages((prev) => [
          ...prev,
          { id: tempAssistantId, text: '', sent: false, done: false },
        ]);

        await sendMessage(currentThreadId, content, selectedTools, {
          onCreated: (data) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id === tempUserId) return { ...m, id: (data as Record<string, string>).user_msg_id };
                if (m.id === tempAssistantId) return { ...m, id: (data as Record<string, string>).assistant_msg_id };
                return m;
              }),
            );
          },
          onDelta: (data) => {
            setMessages((prev) =>
              prev.map((m) =>
                !m.sent && !m.done ? { ...m, text: m.text + data.text } : m,
              ),
            );
          },
          onDone: () => {
            setMessages((prev) =>
              prev.map((m) => (!m.sent && !m.done ? { ...m, done: true } : m)),
            );
            setIsLoading(false);
            onThreadUpdated?.(currentThreadId!);
          },
          onError: (data) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId
                  ? { ...m, text: `Error: ${data.message || 'Something went wrong'}`, done: true, isError: true }
                  : m,
              ),
            );
            setIsLoading(false);
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to send message';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAssistantId
              ? { ...m, text: `Error: ${msg}`, done: true, isError: true }
              : m,
          ),
        );
        setIsLoading(false);
      }
    },
    [threadId, selectedModel, selectedTools, onThreadCreated, onThreadUpdated],
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!inputValue) return;

    if (isListening) {
      stopListening();
    }

    dispatchMessage({
      text: inputValue,
      image: imageData,
    });
  };

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageData(reader.result as string);
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
    selectedTools,
    onToolsChange: setSelectedTools,
  };

  if (threadNotFound) {
    return (
      <div className={styles.container}>
        <div className={styles.errorScreen}>
          <div className={styles.errorIcon}>&#9888;</div>
          <h1 className={styles.errorHeading}>Thread not found</h1>
          <p className={styles.errorSubtext}>Redirecting to a new chat...</p>
        </div>
      </div>
    );
  }

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
          <ChatInput {...inputProps} />
        </>
      )}
    </div>
  );
};

export default ChatContainer;
```

Key changes from original:
- Prop renamed: `activeThreadId` → `threadId` (type `string | undefined` instead of `string | null`)
- Added `useNavigate` for 404 redirect
- Added `threadNotFound` state
- On `fetchThread` failure: sets `threadNotFound = true`, starts 3-second timer to redirect to `/chat/new`
- `dispatchMessage` uses local `currentThreadId` variable instead of `activeThreadId`
- Timer cleanup handled by the effect's `cancelled` flag

- [ ] **Step 3: Verify types compile**

```bash
cd app && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/ChatContainer/ChatContainer.tsx app/src/components/ChatContainer/ChatContainer.module.css
git commit -m "feat: update ChatContainer for URL-based routing with 404 handling"
```

---

### Task 7: Manual testing

- [ ] **Step 1: Start the app**

```bash
cd app && npm start
```

- [ ] **Step 2: Test all routes**

Run through each test case from the spec:

1. Navigate to `http://localhost:3000/` — should redirect to `/chat/new`
2. Click "New chat" in sidebar — URL changes to `/chat/new`, welcome screen shown
3. Send a message — thread created, URL changes to `/chat/{newId}`
4. Click a thread in sidebar — URL changes to `/chat/{threadId}`, messages load
5. Copy a valid thread URL and paste in a new tab — thread loads directly
6. Navigate to `http://localhost:3000/chat/invalid-id-12345` — "Thread not found" shown, redirects to `/chat/new` after 3s
7. Use browser back/forward buttons — navigates between threads
8. Delete the active thread — redirects to `/chat/new`
9. Navigate to `http://localhost:3000/random/path` — redirects to `/chat/new`

- [ ] **Step 3: Commit any fixes if needed**
