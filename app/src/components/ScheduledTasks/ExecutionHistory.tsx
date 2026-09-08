import React, { useState, useEffect, useCallback } from 'react';
import { fetchTaskExecutions } from '../../api';
import type { TaskExecution } from '../../types';
import styles from './ExecutionHistory.module.css';

interface ExecutionHistoryProps {
  taskId: string;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const statusLabel: Record<string, string> = {
  success: 'Success',
  failed: 'Failed',
  timeout: 'Timeout',
  skipped: 'Skipped',
};

const ExecutionHistory: React.FC<ExecutionHistoryProps> = ({ taskId }) => {
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      try {
        const result = await fetchTaskExecutions(taskId, 20, cursor);
        if (cursor) {
          setExecutions((prev) => [...prev, ...result.executions]);
        } else {
          setExecutions(result.executions);
        }
        setNextCursor(result.nextCursor);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    },
    [taskId]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.container} role="region" aria-label="Execution history">
      <h4 className={styles.heading}>Execution History</h4>
      {executions.length === 0 && !loading && (
        <div className={styles.empty}>No executions yet</div>
      )}
      {executions.map((exec) => (
        <div key={exec.id} className={styles.item}>
          <span
            className={`${styles.badge} ${styles[exec.status] || ''}`}
          >
            {statusLabel[exec.status] || exec.status}
          </span>
          <span className={styles.time}>{formatTime(exec.startedAt)}</span>
          <span className={styles.duration}>{formatDuration(exec.durationMs)}</span>
        </div>
      ))}
      {nextCursor && (
        <button
          className={styles.loadMore}
          onClick={() => load(nextCursor)}
          disabled={loading}
          aria-label="Load more execution history"
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
};

export default ExecutionHistory;
