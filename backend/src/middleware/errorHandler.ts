import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors';
import logger from '../config/logger';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json(err.toJSON());
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      type: 'internal_error',
      message: 'An unexpected error occurred',
    },
  });
}
