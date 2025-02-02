import React from 'react';
import ReactMarkdown from 'react-markdown';
import './Message.css';

const Message = ({ message }) => {
  return (
    <div className={`message ${message.sent ? 'sent' : 'received'}`}>
      <ReactMarkdown>{message.text}</ReactMarkdown>
    </div>
  );
};

export default Message;
