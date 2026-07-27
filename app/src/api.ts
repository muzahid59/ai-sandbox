import type { Thread } from './types';
import { fetchWithAuth, getAccessToken, AuthExpiredError } from './services/authService';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

export type GoogleConnectionStatus =
  | { connected: true; email: string; scopes: string[]; connectedAt: string }
  | { connected: false; authorizeUrl: string };

interface ContentBlock {
  type: string;
  text?: string;
  url?: string;
}

interface SSECallbacks {
  onCreated?: (data: Record<string, unknown>) => void;
  onDelta?: (data: { text: string }) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (data: { message: string }) => void;
  onToolUseStart?: (data: Record<string, unknown>) => void;
  onToolUseResult?: (data: Record<string, unknown>) => void;
  onAuthExpired?: () => void;
}

interface FetchThreadsResponse {
  id: string;
  title: string;
  status: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

interface FetchThreadResponse {
  thread: Thread;
  messages: Array<{
    id: string;
    role: string;
    content: ContentBlock[];
  }>;
}

export async function fetchThreads(): Promise<FetchThreadsResponse[]> {
  const res = await fetchWithAuth(`${API_URL}/api/v1/threads`);
  if (!res.ok) throw new Error(`Failed to fetch threads: ${res.status}`);
  return res.json();
}

export async function createThread(model: string): Promise<Thread> {
  const res = await fetchWithAuth(`${API_URL}/api/v1/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new Error(`Failed to create thread: ${res.status}`);
  return res.json();
}

export async function fetchThread(threadId: string): Promise<FetchThreadResponse> {
  const res = await fetchWithAuth(`${API_URL}/api/v1/threads/${threadId}`);
  if (!res.ok) throw new Error(`Failed to fetch thread: ${res.status}`);
  return res.json();
}

export async function deleteThread(threadId: string): Promise<{ success: boolean }> {
  const res = await fetchWithAuth(`${API_URL}/api/v1/threads/${threadId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete thread: ${res.status}`);
  return res.json();
}

export async function getGoogleConnectionStatus(): Promise<GoogleConnectionStatus> {
  const res = await fetchWithAuth(`${API_URL}/api/v1/auth/google/status`);
  if (!res.ok) throw new Error(`Failed to get Google connection status: ${res.status}`);
  return res.json();
}

export async function disconnectGoogle(): Promise<void> {
  const res = await fetchWithAuth(`${API_URL}/api/v1/auth/google`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to disconnect Google: ${res.status}`);
}

export async function sendMessage(
  threadId: string,
  content: ContentBlock[],
  tools: string[],
  callbacks: SSECallbacks
): Promise<void> {
  const { onCreated, onDelta, onDone, onError, onToolUseStart, onToolUseResult, onAuthExpired } =
    callbacks;
  try {
    const token = getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_URL}/api/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ content, tools }),
    });

    if (res.status === 401) {
      onAuthExpired?.();
      return;
    }

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // eslint-disable-next-line no-constant-condition
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
              case 'message_start':
                onCreated?.(data);
                break;
              case 'content_block_delta':
                onDelta?.({ text: data.delta?.text || '' });
                break;
              case 'content_block_start':
                onToolUseStart?.(data.content_block);
                break;
              case 'content_block_stop':
                onToolUseResult?.(data.tool_result);
                break;
              case 'message_stop':
                onDone?.(data);
                break;
              case 'error':
                onError?.(data.error || data);
                break;
              default:
                break;
            }
          } catch {
            // skip malformed SSE chunks
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof AuthExpiredError) {
      onAuthExpired?.();
      return;
    }
    const msg = error instanceof Error ? error.message : 'Unknown error';
    onError?.({ message: msg });
  }
}
