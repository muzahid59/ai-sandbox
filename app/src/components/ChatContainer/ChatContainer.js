import React, { useState, useEffect, useRef, useCallback } from 'react';
import { setOnNewMessage, listenMessage } from '../../fetch_message';
import MessageList from '../MessageList/MessageList';
import ChatInput from '../ChatInput/ChatInput';
import styles from './ChatContainer.module.css';

let nextMessageId = 1;

function ChatContainer() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [imageData, setImageData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const recognition = useRef(null);
  const fileInputRef = useRef();
  const [selectedModel, setSelectedModel] = useState('lama');
  const streamingIndexRef = useRef(null);

  useEffect(() => {
    setOnNewMessage((message) => {
      const isError = message.done && message.text && message.text.startsWith('Error:');

      if (isError) {
        setError(message.text);
        streamingIndexRef.current = null;
        setIsLoading(false);
        return;
      }

      if (message.text) {
        setMessages((prev) => {
          const updated = [...prev];
          const idx = streamingIndexRef.current;
          if (idx !== null && updated[idx]) {
            updated[idx] = {
              ...updated[idx],
              text: updated[idx].text + message.text,
            };
          } else {
            const newMsg = { ...message, id: nextMessageId++ };
            updated.push(newMsg);
            streamingIndexRef.current = updated.length - 1;
          }
          return updated;
        });
      }

      if (message.done) {
        streamingIndexRef.current = null;
        setIsLoading(false);
      }
    });

    return () => setOnNewMessage(() => {});
  }, []);

  const dispatchMessage = useCallback((message) => {
    try {
      setIsLoading(true);
      setError(null);
      streamingIndexRef.current = null;
      const msgWithId = { ...message, id: nextMessageId++ };
      setMessages((prev) => [...prev, msgWithId]);
      setInputValue('');
      listenMessage(message);
      setImageData(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  }, []);

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
          <div className={styles.welcomeIcon}>✦</div>
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
