import React, { useRef, useState, useCallback, useEffect } from 'react';
import { uploadDocument, ingestUrl, checkDuplicate } from '../api';
import styles from './DocumentUpload.module.css';

interface DocumentUploadProps {
  threadId: string;
  onUploadComplete: () => void;
}

const DocumentUpload: React.FC<DocumentUploadProps> = ({ threadId, onUploadComplete }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [confirmDuplicate, setConfirmDuplicate] = useState<{ filename: string; file: File } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);

  const doUpload = useCallback(async (file: File) => {
    setError(null);
    setIsUploading(true);
    try {
      const result = await uploadDocument(threadId, file);
      if (result.duplicateNotice) {
        setNotice(result.duplicateNotice.message);
      }
      onUploadComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setError(message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [threadId, onUploadComplete]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const dup = await checkDuplicate(threadId, file.name);
        if (dup.filenameMatch.exists) {
          setConfirmDuplicate({ filename: file.name, file });
          return;
        }
      } catch { /* proceed with upload if check fails */ }

      doUpload(file);
    },
    [threadId, doUpload],
  );

  const handleUrlSubmit = useCallback(async () => {
    if (!urlValue.trim()) return;
    try { new URL(urlValue); } catch { setError('Invalid URL'); return; }
    setError(null);
    setIsUploading(true);
    try {
      const result = await ingestUrl(threadId, urlValue);
      if (result.duplicateNotice) setNotice(result.duplicateNotice.message);
      setUrlValue('');
      setShowUrlInput(false);
      onUploadComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'URL ingestion failed.');
    } finally {
      setIsUploading(false);
    }
  }, [threadId, urlValue, onUploadComplete]);

  const handleButtonClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleButtonClick();
      }
    },
    [handleButtonClick],
  );

  return (
    <div className={styles.wrapper}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md"
        onChange={handleFileChange}
        className={styles.hiddenInput}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className={`${styles.uploadBtn} ${isUploading ? styles.uploading : ''}`}
        onClick={handleButtonClick}
        onKeyDown={handleKeyDown}
        disabled={isUploading}
        title="Upload document"
        aria-label="Upload document"
      >
        {isUploading ? (
          <span className={styles.loadingText}>Uploading...</span>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={styles.urlToggleBtn}
        onClick={() => setShowUrlInput(!showUrlInput)}
        disabled={isUploading}
        title="Ingest URL"
        aria-label="Ingest URL"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </button>
      {showUrlInput && (
        <div className={styles.urlRow}>
          <input
            type="url"
            className={styles.urlInput}
            placeholder="Paste a URL..."
            value={urlValue}
            onChange={e => setUrlValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleUrlSubmit(); }}
            disabled={isUploading}
            aria-label="URL to ingest"
          />
          <button type="button" className={styles.urlSubmitBtn} onClick={handleUrlSubmit} disabled={isUploading || !urlValue.trim()}>
            Go
          </button>
        </div>
      )}
      {confirmDuplicate && (
        <div className={styles.confirmOverlay} role="dialog" aria-label="Duplicate filename">
          <p>A document named &quot;{confirmDuplicate.filename}&quot; already exists. Upload anyway?</p>
          <div className={styles.confirmActions}>
            <button onClick={() => { doUpload(confirmDuplicate.file); setConfirmDuplicate(null); }}>Upload</button>
            <button onClick={() => { setConfirmDuplicate(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>Cancel</button>
          </div>
        </div>
      )}
      {error && (
        <span className={styles.errorText} role="alert">
          {error}
        </span>
      )}
      {notice && (
        <span className={styles.noticeText} role="status">
          {notice}
        </span>
      )}
    </div>
  );
};

export default DocumentUpload;
