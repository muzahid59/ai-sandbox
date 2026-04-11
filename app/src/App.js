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
    [activeThreadId]
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
        prev.map((t) => (t.id === threadId ? { ...t, title: thread.title } : t))
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
