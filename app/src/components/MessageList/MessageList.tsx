import React, { useEffect, useRef } from 'react';
import MessageBubble from '../MessageBubble/MessageBubble';
import ApprovalCard from '../ApprovalCard/ApprovalCard';
import type { MessageListProps } from '../../types';
import styles from './MessageList.module.css';

const MessageList: React.FC<MessageListProps> = ({
  messages,
  pendingAction,
  onApproveAction,
  onRejectAction,
  isActionLoading,
  onActionStatusChange,
}) => {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, pendingAction]);

  return (
    <div className={styles.chatbox} ref={chatboxRef}>
      <div className={styles.inner}>
        {messages.map((message) => (
          <React.Fragment key={message.id}>
            <MessageBubble message={message} />
            {pendingAction && pendingAction.messageId === message.id && (
              <ApprovalCard
                pendingAction={pendingAction}
                onApprove={onApproveAction || (() => {})}
                onReject={onRejectAction || (() => {})}
                isLoading={isActionLoading || false}
                onStatusChange={onActionStatusChange}
              />
            )}
          </React.Fragment>
        ))}
        <div ref={chatEndRef} />
      </div>
    </div>
  );
};

export default MessageList;
