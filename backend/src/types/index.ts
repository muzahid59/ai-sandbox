export * from './content';
export * from './messages';
export * from './events';

export type {
  Thread,
  CreateThreadRequest,
  UpdateThreadRequest,
} from '@shared/types';
export type { Message as SharedMessage } from '@shared/types';
export type {
  SSEEvent,
  MessageCreatedEvent,
  DeltaEvent,
  ToolUseStartEvent as SharedToolUseStartEvent,
  ToolUseResultEvent as SharedToolUseResultEvent,
  DoneEvent,
  ErrorEvent as SharedErrorEvent,
} from '@shared/types';

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

