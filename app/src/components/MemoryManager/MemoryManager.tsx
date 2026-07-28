import React, { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from '../../services/authService';
import type { Memory } from '@shared/types';
import styles from './MemoryManager.module.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

interface MemoryManagerProps {
  version: number;
  onClose: () => void;
}

const MemoryManager: React.FC<MemoryManagerProps> = ({ version, onClose }) => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addContent, setAddContent] = useState('');
  const [addError, setAddError] = useState('');
  const [saveError, setSaveError] = useState('');

  const fetchMemories = useCallback(async () => {
    setError('');
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/memories`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setMemories(data.memories ?? []);
    } catch {
      setError('Failed to load memories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  useEffect(() => {
    if (version > 0) fetchMemories();
  }, [version, fetchMemories]);

  const handleEdit = (m: Memory) => {
    setEditingId(m.id);
    setEditContent(m.content);
    setSaveError('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent('');
    setSaveError('');
  };

  const handleSave = async (id: string) => {
    setSaveError('');
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/memories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data?.error?.message ?? 'Failed to save');
        return;
      }
      const updated: Memory = await res.json();
      setMemories((prev) => prev.map((m) => (m.id === id ? updated : m)));
      setEditingId(null);
    } catch {
      setSaveError('Failed to save');
    }
  };

  const handleDeleteClick = (id: string) => {
    setDeletingId(id);
  };

  const handleDeleteConfirm = async (id: string) => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/memories/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      setMemories((prev) => prev.filter((m) => m.id !== id));
      if (deletingId === id) setDeletingId(null);
    } catch {
      // silent — user can retry
    }
  };

  const handleAdd = async () => {
    if (!addContent.trim()) return;
    setAddError('');
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: addContent.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAddError(data?.error?.message ?? 'Failed to add memory');
        return;
      }
      const memory: Memory = await res.json();
      setMemories((prev) => [memory, ...prev]);
      setAddContent('');
    } catch {
      setAddError('Failed to add memory');
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Memories</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className={styles.addForm}>
          <input
            className={styles.addInput}
            type="text"
            value={addContent}
            onChange={(e) => setAddContent(e.target.value)}
            placeholder="Add a memory..."
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
          />
          <button className={styles.addBtn} onClick={handleAdd} disabled={!addContent.trim()}>
            Add
          </button>
        </div>
        {addError && <div className={styles.addError}>{addError}</div>}

        <div className={styles.list}>
          {loading && <div className={styles.loading}>Loading...</div>}
          {!loading && error && <div className={styles.error}>{error}</div>}
          {!loading && !error && memories.length === 0 && (
            <div className={styles.empty}>
              No memories yet. Start a conversation and the AI will start learning about you.
            </div>
          )}
          {memories.map((m) => (
            <div key={m.id} className={styles.item}>
              {editingId === m.id ? (
                <div className={styles.editMode}>
                  <textarea
                    className={styles.editTextarea}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    maxLength={500}
                    rows={3}
                    autoFocus
                  />
                  {saveError && <div className={styles.saveError}>{saveError}</div>}
                  <div className={styles.editActions}>
                    <button className={styles.saveEditBtn} onClick={() => handleSave(m.id)}>
                      Save
                    </button>
                    <button className={styles.cancelBtn} onClick={handleCancelEdit}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : deletingId === m.id ? (
                <div className={styles.deleteConfirm}>
                  <span className={styles.deleteMsg}>Delete this memory?</span>
                  <button
                    className={styles.confirmDeleteBtn}
                    onClick={() => handleDeleteConfirm(m.id)}
                  >
                    Confirm
                  </button>
                  <button className={styles.cancelBtn} onClick={() => setDeletingId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <div className={styles.itemContent}>
                    <span className={styles.content}>{m.content}</span>
                    <span
                      className={`${styles.badge} ${m.source === 'extracted' ? styles.badgeAI : styles.badgeManual}`}
                    >
                      {m.source === 'extracted' ? 'AI' : 'manual'}
                    </span>
                  </div>
                  <div className={styles.itemMeta}>
                    <span className={styles.date}>{formatDate(m.createdAt)}</span>
                    <div className={styles.itemActions}>
                      <button className={styles.actionBtn} onClick={() => handleEdit(m)}>
                        Edit
                      </button>
                      <button className={styles.actionBtn} onClick={() => handleDeleteClick(m.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MemoryManager;
