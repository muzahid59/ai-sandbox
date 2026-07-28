import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Sidebar from '../Sidebar/Sidebar';
import ChatContainer from '../ChatContainer/ChatContainer';
import type { Thread } from '../../types';

interface ChatLayoutProps {
  threads: Thread[];
  onThreadCreated: (thread: Thread) => void;
  onThreadUpdated: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onLogout?: () => void;
  themeToggle: React.ReactNode;
  googleConnection?: React.ReactNode;
  onOpenMemories?: () => void;
  onOpenSettings?: () => void;
  onMessageComplete?: () => void;
  displayName?: string | null;
}

const ChatLayout: React.FC<ChatLayoutProps> = ({
  threads,
  onThreadCreated,
  onThreadUpdated,
  onDeleteThread,
  onLogout,
  themeToggle,
  googleConnection,
  onOpenMemories,
  onOpenSettings,
  onMessageComplete,
  displayName,
}) => {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();

  const handleNewChat = () => {
    navigate('/chat/new');
  };

  const handleSelectThread = (id: string) => {
    navigate(`/chat/${id}`);
  };

  const handleDeleteThread = (id: string) => {
    onDeleteThread(id);
    if (threadId === id) {
      navigate('/chat/new');
    }
  };

  const handleThreadCreated = (thread: Thread) => {
    onThreadCreated(thread);
    navigate(`/chat/${thread.id}`, { replace: true });
  };

  return (
    <>
      <Sidebar
        threads={threads}
        activeThreadId={threadId}
        onSelectThread={handleSelectThread}
        onNewChat={handleNewChat}
        onDeleteThread={handleDeleteThread}
        onLogout={onLogout}
        onOpenMemories={onOpenMemories}
        onOpenSettings={onOpenSettings}
        displayName={displayName}
      />
      <div className="mainContent">
        {themeToggle}
        <ChatContainer
          threadId={threadId}
          onThreadCreated={handleThreadCreated}
          onThreadUpdated={onThreadUpdated}
          onMessageComplete={onMessageComplete}
        />
      </div>
      {googleConnection && <div className="googleConnectionPanel">{googleConnection}</div>}
    </>
  );
};

export default ChatLayout;
