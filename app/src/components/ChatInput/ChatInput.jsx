import React, { useRef, useCallback } from 'react';
import styles from './ChatInput.module.css';

const MODELS = [
  { id: 'openai', name: 'OpenAI GPT' },
  { id: 'google', name: 'Google Gemini' },
  { id: 'lama', name: 'Llama 3.2' },
  { id: 'deepseek', name: 'DeepSeek-r1' },
];

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
  selectedModel,
  onModelChange,
}) => {
  const textareaRef = useRef(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className={styles.inputWrapper}>
      <form onSubmit={handleSubmit} className={styles.inputContainer}>
        <textarea
          ref={textareaRef}
          value={inputValue}
          placeholder={isListening ? 'Listening...' : 'Reply...'}
          onChange={(e) => {
            setInputValue(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          className={styles.textInput}
          disabled={isLoading}
          rows={1}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          style={{ display: 'none' }}
        />
        <div className={styles.toolbar}>
          <button
            type="button"
            className={`${styles.toolBtn} ${imageData ? styles.attached : ''}`}
            onClick={() => fileInputRef.current.click()}
            title="Attach image"
          >
            +
          </button>
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            className={styles.modelSelect}
          >
            {MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          <div className={styles.toolbarRight}>
            <button
              type="button"
              className={`${styles.toolBtn} ${isListening ? styles.listening : ''}`}
              onClick={isListening ? stopListening : startListening}
              title={isListening ? 'Stop listening' : 'Voice input'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
            {isLoading ? (
              <div className={styles.loader} />
            ) : (
              <button
                type="submit"
                className={styles.sendBtn}
                disabled={!inputValue}
                title="Send message"
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </form>
      <p className={styles.disclaimer}>AI can make mistakes. Please double-check responses.</p>
    </div>
  );
};

export default ChatInput;
