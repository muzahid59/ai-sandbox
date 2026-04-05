import React, { useState } from 'react';
import styles from './Sidebar.module.css';

const NewChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const CollapseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(false);

  const recentChats = [
    'React redesign project',
    'API integration help',
    'CSS variables guide',
    'Streaming architecture',
  ];

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.header}>
        {!collapsed && <span className={styles.logo}>AI Sandbox</span>}
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <MenuIcon /> : <CollapseIcon />}
        </button>
      </div>

      {!collapsed && (
        <>
          <nav className={styles.nav}>
            <button className={styles.navItem}>
              <span className={styles.navIcon}><NewChatIcon /></span>
              New chat
            </button>
            <button className={styles.navItem}>
              <span className={styles.navIcon}><SearchIcon /></span>
              Search
            </button>
          </nav>

          <div className={styles.divider} />

          <div className={styles.recents}>
            <span className={styles.sectionLabel}>Recents</span>
            {recentChats.map((chat, i) => (
              <div key={i} className={styles.recentItem}>
                <span className={styles.recentIcon}><ChatIcon /></span>
                {chat}
              </div>
            ))}
          </div>

          <div className={styles.userProfile}>
            <div className={styles.avatar}>U</div>
            <span className={styles.username}>User</span>
          </div>
        </>
      )}
    </aside>
  );
};

export default Sidebar;
