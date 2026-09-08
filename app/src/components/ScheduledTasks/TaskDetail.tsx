import React, { useState } from 'react';
import cronstrue from 'cronstrue';
import type { ScheduledTask, UpdateScheduledTaskRequest } from '../../types';
import TaskForm from './TaskForm';
import ExecutionHistory from './ExecutionHistory';
import styles from './TaskDetail.module.css';

interface TaskDetailProps {
  task: ScheduledTask;
  onUpdate: (id: string, data: UpdateScheduledTaskRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBack: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getCronDescription(cron: string): string {
  try {
    return cronstrue.toString(cron);
  } catch {
    return cron;
  }
}

const TaskDetail: React.FC<TaskDetailProps> = ({ task, onUpdate, onDelete, onBack }) => {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  async function handleToggle() {
    setError('');
    try {
      await onUpdate(task.id, { enabled: !task.enabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    }
  }

  async function handleDelete() {
    setError('');
    try {
      await onDelete(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
      setConfirmDelete(false);
    }
  }

  if (editing) {
    return (
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => setEditing(false)} aria-label="Cancel editing">
          &larr; Back
        </button>
        <TaskForm
          initialData={task}
          onSubmit={async (data) => {
            await onUpdate(task.id, data);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack} aria-label="Back to task list">
        &larr; Back
      </button>

      <h3 className={styles.name}>{task.name}</h3>

      <div className={styles.prompt}>{task.prompt}</div>

      <div className={styles.meta}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Schedule</span>
          <span className={styles.rowValue}>{getCronDescription(task.cronExpression)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Model</span>
          <span className={styles.rowValue}>{task.model}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Timezone</span>
          <span className={styles.rowValue}>{task.timezone}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Next run</span>
          <span className={styles.rowValue}>{formatDate(task.nextRunAt)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Last run</span>
          <span className={styles.rowValue}>{formatDate(task.lastRunAt)}</span>
        </div>
      </div>

      <div className={styles.toggleRow}>
        <label className={styles.toggle}>
          <input
            className={styles.toggleInput}
            type="checkbox"
            checked={task.enabled}
            onChange={handleToggle}
            aria-label="Enable or disable task"
          />
          <span className={styles.toggleSlider} />
        </label>
        {task.enabled ? 'Enabled' : 'Disabled'}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <button className={styles.editBtn} onClick={() => setEditing(true)} aria-label="Edit task">
          Edit
        </button>
        {!confirmDelete ? (
          <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)} aria-label="Delete task">
            Delete
          </button>
        ) : (
          <div className={styles.deleteConfirm}>
            <span className={styles.deleteMsg}>Delete this task?</span>
            <button className={styles.confirmDeleteBtn} onClick={handleDelete}>
              Yes, delete
            </button>
            <button className={styles.cancelDeleteBtn} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className={styles.divider} />

      <ExecutionHistory taskId={task.id} />
    </div>
  );
};

export default TaskDetail;
