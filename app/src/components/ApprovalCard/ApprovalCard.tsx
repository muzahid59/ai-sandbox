import React, { useEffect, useRef } from 'react';
import type { PendingAction } from '../../types';
import { getAction } from '../../api';
import { formatToolName, formatArguments } from './formatArguments';
import styles from './ApprovalCard.module.css';

interface ApprovalCardProps {
  pendingAction: PendingAction;
  onApprove: () => void;
  onReject: () => void;
  isLoading: boolean;
  onStatusChange?: (status: string) => void;
}

const BADGE_CLASS: Record<string, string> = {
  pending: styles.badgePending,
  approved: styles.badgeApproved,
  rejected: styles.badgeRejected,
  expired: styles.badgeExpired,
};

const POLL_INTERVAL_MS = 30_000;

const ApprovalCard: React.FC<ApprovalCardProps> = ({
  pendingAction,
  onApprove,
  onReject,
  isLoading,
  onStatusChange,
}) => {
  const isPending = pendingAction.status === 'pending';
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isPending) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(async () => {
      try {
        const data = await getAction(pendingAction.id);
        if (data.status !== 'pending') {
          onStatusChange?.(data.status as string);
        }
      } catch {
        // polling failure is non-critical
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPending, pendingAction.id, onStatusChange]);
  const args = formatArguments(pendingAction.arguments);
  const badgeLabel =
    pendingAction.status.charAt(0).toUpperCase() + pendingAction.status.slice(1);

  return (
    <div className={styles.card} role="region" aria-label="Action approval required">
      <div className={styles.header}>
        <span className={styles.toolName}>{formatToolName(pendingAction.toolName)}</span>
        <span className={`${styles.badge} ${BADGE_CLASS[pendingAction.status] || ''}`}>
          {badgeLabel}
        </span>
      </div>

      {args.length > 0 && (
        <div className={styles.arguments}>
          {args.map((arg) => (
            <div key={arg.label} className={styles.argRow}>
              <span className={styles.argLabel}>{arg.label}:</span>
              <span className={styles.argValue}>{arg.value}</span>
            </div>
          ))}
        </div>
      )}

      {isPending && (
        <div className={styles.actions}>
          <button
            className={styles.approveBtn}
            onClick={onApprove}
            disabled={isLoading}
            aria-label="Approve action"
          >
            {isLoading ? <span className={styles.loader} /> : null}
            Approve
          </button>
          <button
            className={styles.rejectBtn}
            onClick={onReject}
            disabled={isLoading}
            aria-label="Reject action"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
};

export default ApprovalCard;
