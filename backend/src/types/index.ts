export * from './content';
export * from './messages';
export * from './events';

// ─── Auth ───

export interface AuthUser {
  id: string;
  email: string;
}

// Augment Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

