import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import './App.css';
import ChatLayout from './components/ChatLayout/ChatLayout';
import GoogleConnection from './components/GoogleConnection/GoogleConnection';
import { RequireAuth } from './components/RequireAuth/RequireAuth';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import MemoryManager from './components/MemoryManager/MemoryManager';
import SettingsPanel from './components/SettingsPanel/SettingsPanel';
import { fetchThreads, deleteThread } from './api';
import * as authService from './services/authService';
import type { AuthUser } from './services/authService';
import type { Thread } from './types';
import type { UserPreferences } from '@shared/types';
import { AuthExpiredError } from './services/authService';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

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
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'light';
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [googleToast, setGoogleToast] = useState<string | null>(null);
  const [memoriesVersion, setMemoriesVersion] = useState(0);
  const [showMemories, setShowMemories] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    authService.tryRestoreSession().then(async (restoredUser) => {
      setUser(restoredUser);
      setAuthLoading(false);
      if (restoredUser) {
        try {
          const res = await authService.fetchWithAuth(`${API_URL}/api/v1/preferences`);
          if (res.ok) setPreferences(await res.json());
        } catch {
          // preferences load failure is non-critical
        }
      }
    });
  }, []);

  const handleLogin = useCallback(
    (loggedInUser: AuthUser) => {
      setUser(loggedInUser);
      navigate('/');
    },
    [navigate]
  );

  const handleLogout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    setThreads([]);
    navigate('/login');
  }, [navigate]);

  useEffect(() => {
    if (!user) return;
    fetchThreads()
      .then((data) => setThreads(data as Thread[]))
      .catch((err: unknown) => {
        if (err instanceof AuthExpiredError) handleLogout();
        else console.error('Failed to load threads:', err);
      });
  }, [user, handleLogout]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'connected') {
      setGoogleToast('Google account connected successfully!');
      params.delete('google');
      const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
      window.history.replaceState({}, '', newUrl);
      setTimeout(() => setGoogleToast(null), 4000);
    }
  }, []);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const handleDeleteThread = useCallback(
    async (threadId: string) => {
      try {
        await deleteThread(threadId);
        setThreads((prev) => prev.filter((t) => t.id !== threadId));
      } catch (err) {
        if (err instanceof AuthExpiredError) handleLogout();
        else console.error('Failed to delete thread:', err);
      }
    },
    [handleLogout]
  );

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
    onLogout: handleLogout,
    themeToggle,
    googleConnection: <GoogleConnection />,
    onOpenMemories: () => setShowMemories(true),
    onOpenSettings: () => setShowSettings(true),
    onMessageComplete: () => setMemoriesVersion((v) => v + 1),
    displayName: preferences?.displayName ?? null,
  };

  return (
    <div className="App">
      {googleToast && (
        <div className="googleToast" role="status">
          {googleToast}
        </div>
      )}
      {showMemories && (
        <MemoryManager version={memoriesVersion} onClose={() => setShowMemories(false)} />
      )}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          initialPreferences={preferences}
          onPreferencesChange={setPreferences}
        />
      )}
      <Routes>
        <Route
          path="/login"
          element={
            user && !authLoading ? <Navigate to="/" replace /> : <LoginPage onLogin={handleLogin} />
          }
        />
        <Route
          path="/register"
          element={
            user && !authLoading ? (
              <Navigate to="/" replace />
            ) : (
              <RegisterPage onLogin={handleLogin} />
            )
          }
        />
        <Route
          path="/*"
          element={
            <RequireAuth user={user} isLoading={authLoading}>
              <Routes>
                <Route path="/" element={<Navigate to="/chat/new" replace />} />
                <Route path="/chat/new" element={<ChatLayout {...layoutProps} />} />
                <Route path="/chat/:threadId" element={<ChatLayout {...layoutProps} />} />
                <Route path="*" element={<Navigate to="/chat/new" replace />} />
              </Routes>
            </RequireAuth>
          }
        />
      </Routes>
    </div>
  );
}

export default App;
