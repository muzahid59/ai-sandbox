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
  const [isListening, setIsListening] = useState(false);
  const [selectedModel, setSelectedModel] = useState('lama');
  const recognition = useRef(null);
  const fileInputRef = useRef();
  const skipNextFetchRef = useRef(false);

  // Load thread messages when activeThreadId changes
  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }

    // Skip fetch when thread was just created — we're mid-stream
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
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
        if (!cancelled) {
          console.error('Failed to load messages:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeThreadId]);

  // Speech recognition setup
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
          skipNextFetchRef.current = true;
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
                !m.sent && !m.done ? { ...m, text: m.text + data.text } : m,
              ),
            );
          },
          onDone: () => {
            setMessages((prev) =>
              prev.map((m) => (!m.sent && !m.done ? { ...m, done: true } : m)),
            );
            setIsLoading(false);
            // Trigger title refresh in App
            onThreadUpdated?.(threadId);
          },
          onError: (data) => {
            // Show error as assistant message instead of inline error
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId
                  ? { ...m, text: `❌ Error: ${data.message || 'Something went wrong'}`, done: true, isError: true }
                  : m,
              ),
            );
            setIsLoading(false);
          },
        });
      } catch (err) {
        // Show error as assistant message instead of inline error
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAssistantId
              ? { ...m, text: `❌ Error: ${err.message || 'Failed to send message'}`, done: true, isError: true }
              : m,
          ),
        );
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
          <ChatInput {...inputProps} />
        </>
      )}
    </div>
  );
}

export default ChatContainer;
