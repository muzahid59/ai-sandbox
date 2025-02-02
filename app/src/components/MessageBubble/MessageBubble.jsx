import React from 'react';
import ReactMarkdown from 'react-markdown';
// import './Message.module.css';
import styles from './Message.module.css';


const MessageBubble = ({ message }) => {
  return (
    <div className={`${styles['message-container']} ${message.sent ? styles.sent : styles.received}`}>
      <div className={styles['message-bubble']}>
        <ReactMarkdown>{message.text}</ReactMarkdown>
      </div>
    </div>
  );
};

export default MessageBubble;
