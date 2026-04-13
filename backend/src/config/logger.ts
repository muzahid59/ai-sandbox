import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),

  // Redact sensitive fields from logs
  redact: {
    paths: ['apiKey', 'req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },

  // Dev: human-readable with pino-pretty
  // Prod: raw JSON to stdout (for CloudWatch, Datadog, ELK, etc.)
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export default logger;
