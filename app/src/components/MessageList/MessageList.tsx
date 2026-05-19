import React, { useEffect, useRef } from 'react';
import MessageBubble from '../MessageBubble/MessageBubble';
import type { MessageListProps } from '../../types';
import styles from './MessageList.module.css';

const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div className={styles.chatbox} ref={chatboxRef}>
      <div className={styles.inner}>
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={chatEndRef} />
      </div>
    </div>
  );
};

export default MessageList;
