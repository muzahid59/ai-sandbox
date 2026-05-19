import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { MessageBubbleProps } from '../../types';
import styles from './Message.module.css';

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  return (
    <div
      className={`${styles['message-container']} ${message.sent ? styles.sent : styles.received} ${message.isError ? styles.error : ''}`}
    >
      <div className={styles['message-bubble']}>
        <ReactMarkdown>{message.text}</ReactMarkdown>
      </div>
    </div>
  );
};

export default MessageBubble;
