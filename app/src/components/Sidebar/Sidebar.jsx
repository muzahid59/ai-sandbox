import React, { useState } from 'react';
import styles from './Sidebar.module.css';

const NewChatIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SearchIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ChatIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ProjectsIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
  </svg>
);

const ArtifactsIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

const CodeIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const SidebarToggleIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const Sidebar = ({ threads = [], activeThreadId, onSelectThread, onNewChat, onDeleteThread }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      {collapsed ? (
        <div className={styles.collapsedContent}>
          <button
            className={styles.iconBtn}
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >
            <SidebarToggleIcon />
          </button>
          <div className={styles.collapsedNav}>
            <button className={styles.iconBtn} title="New chat" onClick={onNewChat}>
              <NewChatIcon />
            </button>
            <button className={styles.iconBtn} title="Search">
              <SearchIcon />
            </button>
            <button className={styles.iconBtn} title="Projects">
              <ProjectsIcon />
            </button>
            <button className={styles.iconBtn} title="Chats">
              <ChatIcon />
            </button>
            <button className={styles.iconBtn} title="Artifacts">
              <ArtifactsIcon />
            </button>
            <button className={styles.iconBtn} title="Code">
              <CodeIcon />
            </button>
          </div>
          <div className={styles.collapsedBottom}>
            <div className={styles.avatar}>M</div>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.header}>
            <span className={styles.logo}>AI Sandbox</span>
            <button
              className={styles.collapseBtn}
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
            >
              <SidebarToggleIcon />
            </button>
          </div>

          <nav className={styles.nav}>
            <button className={styles.navItem} onClick={onNewChat}>
              <span className={styles.navIcon}>
                <NewChatIcon />
              </span>
              New chat
            </button>
            <button className={styles.navItem}>
              <span className={styles.navIcon}>
                <SearchIcon />
              </span>
              Search
            </button>
          </nav>

          <div className={styles.divider} />

          <div className={styles.recents}>
            <span className={styles.sectionLabel}>Recents</span>
            {threads.map((thread) => (
              <div
                key={thread.id}
                className={`${styles.recentItem} ${thread.id === activeThreadId ? styles.active : ''}`}
                onClick={() => onSelectThread(thread.id)}
              >
                <span className={styles.recentIcon}>
                  <ChatIcon />
                </span>
                <span className={styles.recentTitle}>
                  {thread.title || 'New chat'}
                </span>
                <button
                  className={styles.deleteBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteThread(thread.id);
                  }}
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            ))}
            {threads.length === 0 && (
              <div className={styles.emptyRecents}>No conversations yet</div>
            )}
          </div>

          <div className={styles.userProfile}>
            <div className={styles.avatar}>M</div>
            <span className={styles.username}>User</span>
          </div>
        </>
      )}
    </aside>
  );
};

export default Sidebar;
