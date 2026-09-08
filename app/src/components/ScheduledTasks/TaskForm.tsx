import React, { useState } from 'react';
import cronstrue from 'cronstrue';
import type { CreateScheduledTaskRequest, ScheduledTask } from '../../types';
import ScheduleBuilder from './ScheduleBuilder';
import styles from './TaskForm.module.css';

const MODELS = [
  { id: 'openai', name: 'OpenAI GPT' },
  { id: 'google', name: 'Google Gemini' },
  { id: 'lama', name: 'Llama 3.2' },
  { id: 'deepseek', name: 'DeepSeek-r1' },
  { id: 'gemma', name: 'Gemma 3 4B' },
  { id: 'qwen3.6', name: 'Qwen 3.6' },
  { id: 'ornith', name: 'Ornith' },
];

interface TaskFormProps {
  onSubmit: (data: CreateScheduledTaskRequest) => Promise<void>;
  onCancel: () => void;
  initialData?: Partial<ScheduledTask>;
}

const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const TaskForm: React.FC<TaskFormProps> = ({ onSubmit, onCancel, initialData }) => {
  const [name, setName] = useState(initialData?.name || '');
  const [prompt, setPrompt] = useState(initialData?.prompt || '');
  const [cronExpression, setCronExpression] = useState(initialData?.cronExpression || '0 9 * * *');
  const [model, setModel] = useState(initialData?.model || MODELS[0].id);
  const [timezone, setTimezone] = useState(initialData?.timezone || defaultTimezone);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Name is required';
    else if (name.length > 100) e.name = 'Name must be 100 characters or less';
    if (!prompt.trim()) e.prompt = 'Prompt is required';
    else if (prompt.length > 2000) e.prompt = 'Prompt must be 2000 characters or less';
    if (!cronExpression.trim()) e.cronExpression = 'Schedule is required';
    else {
      try { cronstrue.toString(cronExpression); } catch { e.cronExpression = 'Invalid schedule'; }
    }
    if (!model.trim()) e.model = 'Model is required';
    if (!timezone.trim()) e.timezone = 'Timezone is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError('');
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        prompt: prompt.trim(),
        cronExpression: cronExpression.trim(),
        model: model.trim(),
        timezone: timezone.trim(),
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  const isEdit = !!initialData?.id;

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label}>Name</label>
        <input
          className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="e.g. Morning email digest"
          aria-label="Task name"
        />
        <span className={styles.charCount}>{name.length}/100</span>
        {errors.name && <span className={styles.fieldError}>{errors.name}</span>}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Prompt</label>
        <textarea
          className={`${styles.textarea} ${errors.prompt ? styles.inputError : ''}`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={2000}
          placeholder="What should the AI do?"
          aria-label="Task prompt"
        />
        <span className={styles.charCount}>{prompt.length}/2000</span>
        {errors.prompt && <span className={styles.fieldError}>{errors.prompt}</span>}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Schedule</label>
        <ScheduleBuilder
          value={cronExpression}
          onChange={setCronExpression}
          error={errors.cronExpression}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Model</label>
        <select
          className={`${styles.select} ${errors.model ? styles.inputError : ''}`}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          aria-label="AI model"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {errors.model && <span className={styles.fieldError}>{errors.model}</span>}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Timezone</label>
        <input
          className={`${styles.input} ${errors.timezone ? styles.inputError : ''}`}
          type="text"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="e.g. Europe/London"
          aria-label="Timezone"
        />
        {errors.timezone && <span className={styles.fieldError}>{errors.timezone}</span>}
      </div>

      {formError && <div className={styles.formError}>{formError}</div>}

      <div className={styles.actions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={styles.submitBtn} disabled={submitting}>
          {submitting ? 'Saving...' : isEdit ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
};

export default TaskForm;
