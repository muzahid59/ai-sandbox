import request from 'supertest';
import { app } from '../src/server';

describe('Server', () => {
  it('responds to GET /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('AI sandbox server');
  });
});
