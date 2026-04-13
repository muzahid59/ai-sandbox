import pinoHttp from 'pino-http';
import crypto from 'crypto';
import logger from '../config/logger';

export const requestLogger = pinoHttp({
  logger,

  // Generate a short request ID for tracing
  genReqId: (req) => {
    const existing = req.headers['x-request-id'];
    if (existing) return existing as string;
    return crypto.randomUUID().slice(0, 8);
  },

  // Attach userId to every log line from this request
  customProps: (req) => ({
    userId: (req as any).user?.id,
  }),

  // Don't log health check / root endpoint noise
  autoLogging: {
    ignore: (req) => req.url === '/' || req.url === '/health',
  },

  // Customize the request log message
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },

  customErrorMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode} ERROR`;
  },

  // Reduce noise: only log essentials from req/res
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});
