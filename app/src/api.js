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

export async function sendMessage(threadId, content, tools, { onCreated, onDelta, onDone, onError, onToolUseStart, onToolUseResult }) {
  try {
    const res = await fetch(`${API_URL}/api/v1/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, tools }),
    });

    if (!res.ok) throw new Error(`Server error: ${res.status}`);

    const reader = res.body.getReader();
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
                // Tool use started (optional callback for UI indicators)
                onToolUseStart?.(data.content_block);
                break;
              case 'content_block_stop':
                // Tool use result (optional callback for UI indicators)
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
