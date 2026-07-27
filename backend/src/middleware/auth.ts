import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/authService';
import logger from '../config/logger';

const log = logger.child({ service: 'authMiddleware' });

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({
      error: { type: 'unauthorized', message: 'Authentication required' },
    });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch (err) {
    log.debug({ err }, 'Token verification failed');
    res.status(401).json({
      error: { type: 'unauthorized', message: 'Authentication required' },
    });
  }
}
