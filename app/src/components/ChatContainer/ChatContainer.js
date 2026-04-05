import React, { useState, useEffect, useRef } from 'react';
import { setOnNewMessage, listenMessage } from '../../fetch_message';
import MessageList from '../MessageList/MessageList';
import ChatInput from '../ChatInput/ChatInput';
import styles from './ChatContainer.module.css';

function ChatContainer() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState([]);
  const [imageData, setImageData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognition = useRef(null);
  const fileInputRef = useRef();
  const messagesRef = useRef(messages);
  const [selectedModel, setSelectedModel] = useState('lama');
  const [streamingMessageIndex, setStreamingMessageIndex] = useState(null);

  setOnNewMessage((message) => {
    setMessages((prevMessages) => {
      const newMessages = [...prevMessages];
      if (streamingMessageIndex !== null) {
        newMessages[streamingMessageIndex] = {
          ...newMessages[streamingMessageIndex],
          text: newMessages[streamingMessageIndex].text + message.text,
        };
      } else {
        newMessages.push(message);
        setStreamingMessageIndex(newMessages.length - 1);
      }
      return newMessages;
    });

    if (message.done) {
      setStreamingMessageIndex(null);
      setIsLoading(false);
    }
  });

  async function dispatchMessage(message) {
    try {
      setIsLoading(true);
      setStreamingMessageIndex(null);
      const newMessages = [...messagesRef.current, message];
      setMessages(newMessages);
      setInputValue('');
      listenMessage(message);
      setImageData(null);
      fileInputRef.current.value = '';
    } catch (error) {
      console.error('Error:', error);
      setIsLoading(false);
    }
  }

  const handleModelChange = (model) => {
    setSelectedModel(model);
  };

  useEffect(() => {
    recognition.current = new (window.SpeechRecognition ||
      window.webkitSpeechRecognition ||
      window.mozSpeechRecognition ||
      window.msSpeechRecognition)();
    if (recognition.current) {
      console.log('Speech recognition supported');
      recognition.lang = 'en-US';
      recognition.current.interimResults = true;
      recognition.current.continuous = true;
      recognition.current.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0])
          .map((result) => result.transcript)
          .join('');

        console.log('recognition result', transcript);
        setInputValue(transcript);
      };

      recognition.current.onend = () => {
        setIsListening(false);
      };
    } else {
      console.log('Speech recognition not supported');
    }
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const startListening = () => {
    console.log('start listening');
    setIsListening(true);
    if (recognition.current) {
      console.log('start listening');
      recognition.current.start();
    }
  };

  const stopListening = () => {
    if (recognition.current) {
      recognition.current.stop();
    }
    setIsListening(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!inputValue) {
      return;
    }

    if (isListening) {
      stopListening();
    }

    dispatchMessage({ text: inputValue, image: imageData, sent: true, model: selectedModel });
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
    onModelChange: handleModelChange,
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
          <ChatInput {...inputProps} />
        </>
      )}
    </div>
  );
}

export default ChatContainer;
