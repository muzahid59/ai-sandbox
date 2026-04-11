import request from 'supertest';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth';

const app = express();
app.use(authMiddleware);
app.get('/test', (req, res) => {
  res.json({ user: req.user });
});

describe('authMiddleware', () => {
  it('injects a hardcoded user into req.user', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'dev@localhost',
    });
  });
});
