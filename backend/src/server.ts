import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

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

app.get('/', (_req, res) => {
  res.send('Hi there! This is the AI sandbox server');
});

// New /api/v1 routes will be added in later tasks

export { app };

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
  });
}
