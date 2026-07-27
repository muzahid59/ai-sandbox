import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../../src/middleware/auth';

const TEST_SECRET = 'test-secret-middleware';

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = TEST_SECRET;
});

const app = express();
app.use(authMiddleware);
app.get('/test', (req, res) => {
  res.json({ user: req.user });
});

function makeToken(payload: object, secret = TEST_SECRET, options?: jwt.SignOptions) {
  return jwt.sign(payload, secret, options);
}

describe('authMiddleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('unauthorized');
  });

  it('returns 401 when Authorization header is malformed (no Bearer prefix)', async () => {
    const res = await request(app).get('/test').set('Authorization', 'Token abc');
    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('unauthorized');
  });

  it('returns 401 when token is expired', async () => {
    const token = makeToken({ id: 'u-1', email: 'a@b.com' }, TEST_SECRET, { expiresIn: '0s' });
    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when token signature is tampered', async () => {
    const token = makeToken({ id: 'u-1', email: 'a@b.com' });
    const tampered = token.slice(0, -4) + 'xxxx';
    const res = await request(app).get('/test').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it('injects req.user and returns 200 when token is valid', async () => {
    const token = makeToken({ id: 'user-123', email: 'test@example.com' });
    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('user-123');
    expect(res.body.user.email).toBe('test@example.com');
  });
});
