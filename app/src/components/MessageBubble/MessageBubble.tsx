import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { MessageBubbleProps } from '../../types';
import styles from './Message.module.css';

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const sources = message.documentSources;
  const uniqueDocs = sources ? Array.from(new Map(sources.map(s => [s.documentId, s])).values()) : [];

  return (
    <div
      className={`${styles['message-container']} ${message.sent ? styles.sent : styles.received} ${message.isError ? styles.error : ''}`}
    >
      <div className={styles['message-bubble']}>
        <ReactMarkdown>{message.text}</ReactMarkdown>
      </div>
      {!message.sent && uniqueDocs.length > 0 && (
        <div className={styles.sources}>
          <button
            className={styles.sourcesToggle}
            onClick={() => setSourcesExpanded(!sourcesExpanded)}
            aria-expanded={sourcesExpanded}
          >
            Sources used ({uniqueDocs.length} document{uniqueDocs.length !== 1 ? 's' : ''})
            <span className={styles.sourcesChevron}>{sourcesExpanded ? '▾' : '▸'}</span>
          </button>
          {sourcesExpanded && (
            <ul className={styles.sourcesList}>
              {sources!.map((s, i) => (
                <li key={`${s.documentId}-${s.chunkIndex}-${i}`} className={styles.sourceItem}>
                  <span className={styles.sourceTitle}>{s.documentTitle}</span>
                  <span className={styles.sourceScore}>{Math.round(s.relevanceScore * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default MessageBubble;
