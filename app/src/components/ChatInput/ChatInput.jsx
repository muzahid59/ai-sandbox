import React from 'react';
import styles from './ChatInput.module.css';

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
    <form onSubmit={handleSubmit} className={styles['chat-input']}>
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
        className={`${styles['attach-button']} ${imageData ? styles.attached : ''}`}
        type="button"
        onClick={() => fileInputRef.current.click()}
      />
      <button
        className={`${styles['microphone-button']} ${isListening ? styles.listening : ''}`}
        type="button"
        onClick={isListening ? stopListening : startListening}
      />
      <button type="submit" className={`${styles['submit-button']}`} disabled={isLoading}>
        Send
      </button>
    </form>
  );
};

export default ChatInput;
