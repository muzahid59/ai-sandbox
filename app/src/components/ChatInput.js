import React, { useRef } from 'react';
import './ChatInput.css';

const ChatInput = ({
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
}) => {
  return (
    <form onSubmit={handleSubmit} className="chat-input">
      <input
        type="text"
        value={inputValue}
        placeholder={isListening ? 'Listening...' : 'Type a message'}
        onChange={(e) => setInputValue(e.target.value)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageChange}
        style={{ display: 'none' }}
      />
      <button
        className={`attach-button ${imageData ? 'attached' : ''}`}
        type="button"
        onClick={() => fileInputRef.current.click()}
      />
      <button
        className={`microphone-button ${isListening ? 'listening' : ''}`}
        type="button"
        onClick={isListening ? stopListening : startListening}
      />
      <button type="submit" className="submit-button" disabled={isLoading}>
        Send
      </button>
    </form>
  );
};

export default ChatInput;
