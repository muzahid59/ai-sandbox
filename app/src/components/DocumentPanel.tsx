import React, { useEffect, useRef } from 'react';
import type { Document, DocumentStatus } from '@shared/types/document';
import styles from './DocumentPanel.module.css';

interface DocumentPanelProps {
  threadId: string;
  documents: Document[];
  onDelete: (documentId: string) => void;
  onCancel: (documentId: string) => void;
  onRefresh: () => void;
}

const PROCESSING_STATUSES: DocumentStatus[] = ['processing', 'extracting', 'chunking', 'embedding'];
const TERMINAL_STATUSES: DocumentStatus[] = ['ready', 'failed', 'cancelled'];

function isProcessing(status: DocumentStatus): boolean {
  return PROCESSING_STATUSES.includes(status);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'processing':
      return 'Processing...';
    case 'extracting':
      return 'Extracting...';
    case 'chunking':
      return 'Chunking...';
    case 'embedding':
      return 'Embedding...';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function getStatusClassName(status: DocumentStatus): string {
  switch (status) {
    case 'processing':
    case 'extracting':
    case 'chunking':
    case 'embedding':
      return styles.statusProcessing;
    case 'ready':
      return styles.statusReady;
    case 'failed':
      return styles.statusFailed;
    case 'cancelled':
      return styles.statusCancelled;
    default:
      return '';
  }
}

const DocumentPanel: React.FC<DocumentPanelProps> = ({
  threadId,
  documents,
  onDelete,
  onCancel,
  onRefresh,
}) => {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const hasProcessing = documents.some((doc) => isProcessing(doc.status));

    if (hasProcessing) {
      intervalRef.current = setInterval(() => {
        onRefresh();
      }, 3000);
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [documents, onRefresh]);

  if (documents.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.sectionLabel}>Documents</div>
        <div className={styles.emptyState}>
          No documents uploaded. Upload a file to ask questions about it.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.sectionLabel}>Documents</div>
      <ul className={styles.list}>
        {documents.map((doc) => (
          <li key={doc.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.title} title={doc.title}>
                {doc.title}
              </span>
              <div className={styles.meta}>
                <span className={`${styles.statusBadge} ${getStatusClassName(doc.status)}`}>
                  {doc.status === 'failed' && doc.statusMessage
                    ? doc.statusMessage
                    : getStatusLabel(doc.status)}
                </span>
                <span className={styles.fileSize}>{formatFileSize(doc.fileSize)}</span>
              </div>
            </div>
            <div className={styles.actions}>
              {isProcessing(doc.status) && (
                <button
                  className={styles.cancelBtn}
                  onClick={() => onCancel(doc.id)}
                  title="Cancel processing"
                  aria-label={`Cancel processing ${doc.title}`}
                >
                  Cancel
                </button>
              )}
              <button
                className={styles.deleteBtn}
                onClick={() => onDelete(doc.id)}
                title="Delete document"
                aria-label={`Delete ${doc.title}`}
              >
                &times;
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DocumentPanel;
