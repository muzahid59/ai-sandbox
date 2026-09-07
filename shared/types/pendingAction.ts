export type PendingActionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface PendingAction {
  id: string;
  threadId: string;
  userId: string;
  messageId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: PendingActionStatus;
  expiresAt: string;
  resolvedAt: string | null;
  createdAt: string;
}
