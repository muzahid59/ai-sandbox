import React, { useState, useEffect, useCallback } from 'react';
import { getGoogleConnectionStatus, disconnectGoogle, GoogleConnectionStatus } from '../../api';
import styles from './GoogleConnection.module.css';

const GOOGLE_AUTH_URL = `${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/v1/auth/google`;

const GoogleConnection: React.FC = () => {
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getGoogleConnectionStatus();
      setStatus(result);
    } catch {
      setError('Failed to load Google connection status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleDisconnect = async () => {
    if (
      !window.confirm('Disconnect your Google account? Gmail and Calendar tools will stop working.')
    )
      return;
    setDisconnecting(true);
    try {
      await disconnectGoogle();
      await fetchStatus();
    } catch {
      setError('Failed to disconnect Google account.');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <span className={styles.spinner} aria-label="Loading..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <p className={styles.errorText}>{error}</p>
        <button className={styles.retryButton} onClick={fetchStatus}>
          Retry
        </button>
      </div>
    );
  }

  if (!status) return null;

  if (status.connected) {
    return (
      <div className={styles.container}>
        <div className={styles.connectedRow}>
          <span className={styles.connectedIcon}>●</span>
          <span className={styles.connectedEmail}>{status.email}</span>
        </div>
        <button
          className={styles.disconnectButton}
          onClick={handleDisconnect}
          disabled={disconnecting}
        >
          {disconnecting ? 'Disconnecting…' : 'Disconnect'}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <a href={GOOGLE_AUTH_URL} className={styles.connectButton}>
        Connect Google
      </a>
    </div>
  );
};

export default GoogleConnection;
