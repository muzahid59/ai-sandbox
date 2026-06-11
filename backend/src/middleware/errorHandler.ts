import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors';
import logger from '../config/logger';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.id || (req as any).id;
  const log = req.log || logger;

  if (err instanceof AppError) {
    log.error({ err, statusCode: err.status, requestId }, err.message);
    res.status(err.status).json(err.toJSON());
    return;
  }

  log.error({ err, statusCode: 500, requestId }, 'Unhandled error');
  res.status(500).json({
    error: {
      type: 'internal_error',
      message: 'An unexpected error occurred',
    },
  });
}
