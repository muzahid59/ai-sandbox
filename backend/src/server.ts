import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authMiddleware } from './middleware/auth';
import { requestLogger } from './middleware/requestLogger';
import { threadRoutes } from './routes/threadRoutes';
import { messageRoutes } from './routes/messageRoutes';
import { registerAllTools } from './tools';
import { toolRegistry } from './services/toolRegistry';
import logger from './config/logger';

dotenv.config();

// Register all available tools
registerAllTools();
logger.info({ tools: toolRegistry.getDefinitions().map(t => t.name) }, 'Tools registered');

// Legacy routes (existing JS — kept working via allowJs)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const legacyRoutes = require('../routes');

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(requestLogger);

// Legacy routes at root (backward compatible)
app.use(legacyRoutes);

// New API v1 routes (with auth)
app.use('/api/v1', authMiddleware);
app.use('/api/v1', threadRoutes);
app.use('/api/v1', messageRoutes);

app.get('/', (_req, res) => {
  res.send('Hi there! This is the AI sandbox server');
});

export { app };

if (require.main === module) {
  app.listen(port, () => {
    logger.info({ port }, 'Server running');
  });
}
