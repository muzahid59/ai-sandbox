import React, { useState, useEffect } from 'react';
import { fetchWithAuth } from '../../services/authService';
import type { UserPreferences } from '@shared/types';
import styles from './SettingsPanel.module.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

const MODEL_OPTIONS = [
  { value: 'openai', label: 'OpenAI GPT' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'lama', label: 'Llama (Ollama)' },
];

interface SettingsPanelProps {
  onClose: () => void;
  initialPreferences?: UserPreferences | null;
  onPreferencesChange?: (prefs: UserPreferences) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  onClose,
  initialPreferences,
  onPreferencesChange,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initialPreferences);

  useEffect(() => {
    if (initialPreferences) {
      setDisplayName(initialPreferences.displayName ?? '');
      setDefaultModel(initialPreferences.defaultModel ?? '');
      setCustomInstructions(initialPreferences.customInstructions ?? '');
      setLoading(false);
      return;
    }
    fetchWithAuth(`${API_URL}/api/v1/preferences`)
      .then((r) => r.json())
      .then((prefs: UserPreferences) => {
        setDisplayName(prefs.displayName ?? '');
        setDefaultModel(prefs.defaultModel ?? '');
        setCustomInstructions(prefs.customInstructions ?? '');
      })
      .catch(() => setError('Failed to load preferences'))
      .finally(() => setLoading(false));
  }, [initialPreferences]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      const body: Record<string, string | null> = {
        displayName: displayName.trim() || null,
        defaultModel: defaultModel || null,
        customInstructions: customInstructions.trim() || null,
      };
      const res = await fetchWithAuth(`${API_URL}/api/v1/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? 'Failed to save preferences');
        return;
      }
      const updated: UserPreferences = await res.json();
      onPreferencesChange?.(updated);
      setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(''), 2000);
    } catch {
      setError('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleClearInstructions = async () => {
    setCustomInstructions('');
    setSaving(true);
    setError('');
    try {
      const res = await fetchWithAuth(`${API_URL}/api/v1/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customInstructions: null }),
      });
      if (!res.ok) {
        setError('Failed to clear instructions');
        return;
      }
      const updated: UserPreferences = await res.json();
      onPreferencesChange?.(updated);
      setSavedMsg('Cleared');
      setTimeout(() => setSavedMsg(''), 2000);
    } catch {
      setError('Failed to clear instructions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading...</div>
        ) : (
          <div className={styles.body}>
            <div className={styles.field}>
              <label className={styles.label}>Display Name</label>
              <input
                className={styles.input}
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={100}
                placeholder="Your name"
              />
              <span className={styles.counter}>{displayName.length}/100</span>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Default Model</label>
              <select
                className={styles.select}
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              >
                <option value="">— Use default (OpenAI) —</option>
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label className={styles.label}>Custom Instructions</label>
                {customInstructions && (
                  <button className={styles.clearLink} onClick={handleClearInstructions}>
                    Clear
                  </button>
                )}
              </div>
              <textarea
                className={styles.textarea}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                maxLength={2000}
                placeholder="Instructions prepended to every AI prompt (e.g. 'Always respond concisely')"
                rows={5}
              />
              <span className={styles.counter}>{customInstructions.length}/2000</span>
            </div>

            {error && <div className={styles.error}>{error}</div>}
            {savedMsg && <div className={styles.success}>{savedMsg} ✓</div>}

            <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPanel;
