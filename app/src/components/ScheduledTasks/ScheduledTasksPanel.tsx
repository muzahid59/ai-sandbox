import React, { useState } from 'react';
import type { ScheduledTask, CreateScheduledTaskRequest, UpdateScheduledTaskRequest } from '../../types';
import TaskForm from './TaskForm';
import TaskDetail from './TaskDetail';
import styles from './ScheduledTasksPanel.module.css';

interface ScheduledTasksPanelProps {
  onClose: () => void;
  tasks: ScheduledTask[];
  loading: boolean;
  onCreateTask: (data: CreateScheduledTaskRequest) => Promise<void>;
  onUpdateTask: (id: string, data: UpdateScheduledTaskRequest) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
}

function formatNextRun(iso: string | null): string {
  if (!iso) return 'Paused';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type View = { type: 'list' } | { type: 'create' } | { type: 'detail'; taskId: string };

const ScheduledTasksPanel: React.FC<ScheduledTasksPanelProps> = ({
  onClose,
  tasks,
  loading,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
}) => {
  const [view, setView] = useState<View>({ type: 'list' });

  const selectedTask = view.type === 'detail' ? tasks.find((t) => t.id === view.taskId) : null;

  function renderBody() {
    if (view.type === 'create') {
      return (
        <TaskForm
          onSubmit={async (data) => {
            await onCreateTask(data);
            setView({ type: 'list' });
          }}
          onCancel={() => setView({ type: 'list' })}
        />
      );
    }

    if (view.type === 'detail' && selectedTask) {
      return (
        <TaskDetail
          task={selectedTask}
          onUpdate={async (id, data) => {
            await onUpdateTask(id, data);
          }}
          onDelete={async (id) => {
            await onDeleteTask(id);
            setView({ type: 'list' });
          }}
          onBack={() => setView({ type: 'list' })}
        />
      );
    }

    if (loading) {
      return <div className={styles.loading}>Loading tasks...</div>;
    }

    if (tasks.length === 0) {
      return <div className={styles.empty}>No scheduled tasks yet. Click + to create one.</div>;
    }

    return (
      <div className={styles.list}>
        {tasks.map((task) => (
          <div
            key={task.id}
            className={styles.taskItem}
            onClick={() => setView({ type: 'detail', taskId: task.id })}
            role="button"
            tabIndex={0}
            aria-label={`View task ${task.name}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setView({ type: 'detail', taskId: task.id });
              }
            }}
          >
            <span className={styles.taskName}>{task.name}</span>
            <span className={styles.taskMeta}>{formatNextRun(task.nextRunAt)}</span>
            <span className={`${styles.badge} ${task.enabled ? styles.badgeEnabled : styles.badgeDisabled}`}>
              {task.enabled ? 'Active' : 'Off'}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-label="Scheduled Tasks">
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>Scheduled Tasks</h2>
            {view.type === 'list' && (
              <button
                className={styles.addBtn}
                onClick={() => setView({ type: 'create' })}
                title="Create new task"
                aria-label="Create new scheduled task"
              >
                +
              </button>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close" aria-label="Close panel">
            &times;
          </button>
        </div>
        <div className={styles.body}>{renderBody()}</div>
      </div>
    </div>
  );
};

export default ScheduledTasksPanel;
