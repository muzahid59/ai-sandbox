export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  model: string;
  threadId: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  messageId: string | null;
  status: 'success' | 'failed' | 'timeout' | 'skipped';
  error: string | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface CreateScheduledTaskRequest {
  name: string;
  prompt: string;
  cronExpression: string;
  timezone: string;
  model: string;
  threadId?: string;
}

export interface UpdateScheduledTaskRequest {
  name?: string;
  prompt?: string;
  cronExpression?: string;
  timezone?: string;
  model?: string;
  enabled?: boolean;
}
