const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

let onNewMessage = () => {};

export function setOnNewMessage(callback) {
  onNewMessage = callback;
}

export async function listenMessage(message) {
  try {
    const response = await fetch(`${API_URL}/content-completion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: message.text,
        image: message.image,
        model: message.model,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        onNewMessage({ text: '', sent: false, done: true });
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(5));
            if (data.error) {
              onNewMessage({ text: 'Error: ' + data.error, sent: false, done: true });
              return;
            }
            if (data.text) {
              onNewMessage({ text: data.text, sent: false, done: false });
            }
          } catch (e) {
            // skip malformed SSE chunks
          }
        }
      }
    }
  } catch (error) {
    onNewMessage({ text: 'Error: ' + error.message, sent: false, done: true });
  }
}
