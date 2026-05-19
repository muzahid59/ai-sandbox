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
