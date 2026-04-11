import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authMiddleware } from './middleware/auth';
import { threadRoutes } from './routes/threadRoutes';
import { messageRoutes } from './routes/messageRoutes';

dotenv.config();

// Legacy routes (existing JS — kept working via allowJs)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const legacyRoutes = require('../routes');

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

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
    console.log(`Server running at http://localhost:${port}/`);
  });
}
