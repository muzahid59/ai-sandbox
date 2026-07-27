import React from 'react';
import { Navigate } from 'react-router-dom';
import type { AuthUser } from '../../services/authService';

interface RequireAuthProps {
  user: AuthUser | null;
  isLoading: boolean;
  children: React.ReactNode;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ user, isLoading, children }) => {
  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}
      >
        Loading…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};
