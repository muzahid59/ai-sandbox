import React, { useEffect, useRef } from 'react';
import MessageBubble from '../MessageBubble/MessageBubble';
import styles from './MessageList.module.css'; 

const MessageList = ({ messages }) => {
  const chatEndRef = useRef(null);
  const chatboxRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div className={styles.chatbox} ref={chatboxRef}>
      {messages.map((message, index) => (
        <MessageBubble key={index} message={message} />
      ))}
      <div ref={chatEndRef} />
    </div>
  );
};

export default MessageList;
