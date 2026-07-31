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
import { registerAllTools } from './tools';
import { toolRegistry } from './services/toolRegistry';
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

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.send('Hi there! This is the AI sandbox server');
});

// Centralized error handler (must be after all routes)
app.use(errorHandler);

export { app };

if (require.main === module) {
  app.listen(port, () => {
    logger.info({ port }, 'Server running');
  });
}
