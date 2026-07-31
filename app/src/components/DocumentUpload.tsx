import React, { useRef, useState, useCallback, useEffect } from 'react';
import { uploadDocument, ingestUrl, checkDuplicate } from '../api';
import styles from './DocumentUpload.module.css';

interface DocumentUploadProps {
  threadId: string;
  onUploadComplete: () => void;
}

const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md'];
const ACCEPTED_MIMES = ['application/pdf', 'text/plain', 'text/markdown'];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeBadge(name: string): string {
  const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.pdf') return 'PDF';
  if (ext === '.md') return 'MD';
  return 'TXT';
}

const DocumentUpload: React.FC<DocumentUploadProps> = ({ threadId, onUploadComplete }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attached, setAttached] = useState<{ name: string; size: number } | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState<{ filename: string; file: File } | null>(null);

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setShowUrlInput(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  const doUpload = useCallback(async (file: File) => {
    setError(null);
    setIsUploading(true);
    setAttached({ name: file.name, size: file.size });
    try {
      const result = await uploadDocument(threadId, file);
      if (result.duplicateNotice) setNotice(result.duplicateNotice.message);
      setAttached(null);
      onUploadComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setAttached(null);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [threadId, onUploadComplete]);

  const handleFileSelect = useCallback(async (file: File) => {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext) && !ACCEPTED_MIMES.includes(file.type)) {
      setError(`Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`);
      return;
    }
    setShowMenu(false);

    try {
      const dup = await checkDuplicate(threadId, file.name);
      if (dup.filenameMatch.exists) {
        setAttached({ name: file.name, size: file.size });
        setConfirmDuplicate({ filename: file.name, file });
        return;
      }
    } catch { /* proceed */ }

    doUpload(file);
  }, [threadId, doUpload]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleUrlSubmit = useCallback(async () => {
    if (!urlValue.trim()) return;
    try { new URL(urlValue); } catch { setError('Invalid URL'); return; }
    setError(null);
    setIsUploading(true);
    setShowUrlInput(false);
    setShowMenu(false);
    try {
      const result = await ingestUrl(threadId, urlValue);
      if (result.duplicateNotice) setNotice(result.duplicateNotice.message);
      setUrlValue('');
      onUploadComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'URL ingestion failed.');
    } finally {
      setIsUploading(false);
    }
  }, [threadId, urlValue, onUploadComplete]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const removeAttached = useCallback(() => {
    setAttached(null);
    setConfirmDuplicate(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  return (
    <>
      {attached && (
        <div className={styles.filePreview}>
          <div className={styles.fileCard}>
            <div className={styles.fileBadge}>{getFileTypeBadge(attached.name)}</div>
            <div className={styles.fileInfo}>
              <span className={styles.fileName}>{attached.name}</span>
              <span className={styles.fileSize}>{formatSize(attached.size)}</span>
            </div>
            {isUploading ? (
              <div className={styles.fileLoader} />
            ) : (
              <button className={styles.fileRemove} onClick={removeAttached} aria-label="Remove file">×</button>
            )}
          </div>
        </div>
      )}

      {confirmDuplicate && (
        <div className={styles.confirmOverlay} role="dialog" aria-label="Duplicate filename">
          <p>A document named &quot;{confirmDuplicate.filename}&quot; already exists. Upload anyway?</p>
          <div className={styles.confirmActions}>
            <button onClick={() => { doUpload(confirmDuplicate.file); setConfirmDuplicate(null); }}>Upload</button>
            <button onClick={() => { setConfirmDuplicate(null); removeAttached(); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className={styles.menuAnchor} ref={menuRef} onDragOver={handleDragOver} onDrop={handleDrop}>
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
          className={styles.plusBtn}
          onClick={() => { setShowMenu(!showMenu); setShowUrlInput(false); }}
          disabled={isUploading}
          title="Add file or URL"
          aria-label="Add file or URL"
          aria-expanded={showMenu}
        >
          +
        </button>

        {showMenu && (
          <div className={styles.menu}>
            <button className={styles.menuItem} onClick={() => { fileInputRef.current?.click(); setShowMenu(false); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              Upload file
            </button>
            <button className={styles.menuItem} onClick={() => setShowUrlInput(!showUrlInput)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              Ingest URL
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
                  autoFocus
                  aria-label="URL to ingest"
                />
                <button className={styles.urlGo} onClick={handleUrlSubmit} disabled={!urlValue.trim()}>Go</button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <span className={styles.errorText} role="alert">{error}</span>}
      {notice && <span className={styles.noticeText} role="status">{notice}</span>}
    </>
  );
};

export default DocumentUpload;
