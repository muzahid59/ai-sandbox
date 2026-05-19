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
