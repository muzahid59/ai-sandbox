import { Request, Response, NextFunction } from 'express';
import '../types';

// TODO: Replace with real JWT auth (access + refresh tokens, per TDD section 07)
const HARDCODED_USER = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'dev@localhost',
};

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.user = HARDCODED_USER;
  next();
}
