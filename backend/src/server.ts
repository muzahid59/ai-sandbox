import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { authMiddleware } from './middleware/auth';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { threadRoutes } from './routes/threadRoutes';
import { messageRoutes } from './routes/messageRoutes';
import { googleAuthRoutes } from './routes/googleAuthRoutes';
import { authRoutes } from './routes/authRoutes';
import { memoryRoutes } from './routes/memoryRoutes';
import { preferencesRoutes } from './routes/preferencesRoutes';
import { documentRoutes } from './routes/documentRoutes';
import { actionRoutes } from './routes/actionRoutes';
import { scheduledTaskRoutes } from './routes/scheduledTaskRoutes';
import { registerAllTools } from './tools';
import { toolRegistry } from './services/toolRegistry';
import { expireOverdue } from './services/pendingActionService';
import { initScheduler, loadAllTasks, registerWorker, stopScheduler } from './services/taskScheduler';
import { registerProviders } from './providers';
import logger from './config/logger';

dotenv.config();

registerProviders();
registerAllTools();
logger.info({ tools: toolRegistry.getDefinitions().map(t => t.name) }, 'Tools registered');

const app = express();
const port = process.env.PORT || 5001;

app.use(cors({
  origin: process.env.BASE_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());
app.use(requestLogger);

// Auth routes (no authMiddleware — they issue tokens)
app.use('/api/v1/auth', authRoutes);

// Google OAuth routes (callback must be accessible without auth)
app.use('/api/v1', googleAuthRoutes);

// Protected API v1 routes
app.use('/api/v1', authMiddleware);
app.use('/api/v1', threadRoutes);
app.use('/api/v1', messageRoutes);
app.use('/api/v1', memoryRoutes);
app.use('/api/v1', preferencesRoutes);
app.use('/api/v1/threads/:threadId/documents', documentRoutes);
app.use('/api/v1', actionRoutes);
app.use('/api/v1', scheduledTaskRoutes);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.send('Hi there! This is the AI sandbox server');
});

// Centralized error handler (must be after all routes)
app.use(errorHandler);

export { app };

const EXPIRY_INTERVAL_MS = 60_000;
setInterval(async () => {
  try {
    const count = await expireOverdue();
    if (count > 0) {
      logger.info({ expiredCount: count }, 'Expired overdue pending actions');
    }
  } catch (err) {
    logger.error({ err }, 'Pending action expiry check failed');
  }
}, EXPIRY_INTERVAL_MS);

if (require.main === module) {
  app.listen(port, async () => {
    logger.info({ port }, 'Server running');
    try {
      await initScheduler(process.env.DATABASE_URL!);
      await loadAllTasks();
      await registerWorker();
      logger.info('Scheduled task scheduler initialized');
    } catch (err) {
      logger.error({ err }, 'Failed to initialize scheduler — scheduled tasks will be unavailable');
    }
  });

  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    await stopScheduler();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
