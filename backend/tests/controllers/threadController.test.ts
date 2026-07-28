const mockThreadService = {
  createThread: jest.fn(),
  listThreads: jest.fn(),
  getThreadById: jest.fn(),
  updateThread: jest.fn(),
  softDeleteThread: jest.fn(),
};

jest.mock('../../src/services/threadService', () => mockThreadService);

const mockMessageService = {
  getByThread: jest.fn(),
};

jest.mock('../../src/services/messageService', () => mockMessageService);

const mockPreferencesService = {
  getPreferences: jest.fn(),
};

jest.mock('../../src/services/preferencesService', () => mockPreferencesService);

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../../src/middleware/auth';
import { errorHandler } from '../../src/middleware/errorHandler';
import { threadRoutes } from '../../src/routes/threadRoutes';

const TEST_SECRET = 'test-secret-controller';
process.env.JWT_ACCESS_SECRET = TEST_SECRET;

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/v1', threadRoutes);
app.use(errorHandler);

const USER_ID = '00000000-0000-0000-0000-000000000001';
const USER_EMAIL = 'dev@localhost';
const authToken = jwt.sign({ id: USER_ID, email: USER_EMAIL }, TEST_SECRET, { expiresIn: '1h' });

describe('Thread API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/v1/threads', () => {
    it('creates a thread and returns 201', async () => {
      const thread = { id: 'tid-1', userId: USER_ID, model: 'lama', title: null };
      mockThreadService.createThread.mockResolvedValue(thread);

      const res = await request(app)
        .post('/api/v1/threads')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ model: 'lama' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(thread);
      expect(mockThreadService.createThread).toHaveBeenCalledWith(USER_ID, {
        model: 'lama',
        title: undefined,
        systemPrompt: undefined,
      });
    });

    it('uses preferences defaultModel when model is absent', async () => {
      mockPreferencesService.getPreferences.mockResolvedValue({ defaultModel: 'google', displayName: null });
      const thread = { id: 'tid-2', userId: USER_ID, model: 'google', title: null };
      mockThreadService.createThread.mockResolvedValue(thread);

      const res = await request(app)
        .post('/api/v1/threads')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(mockThreadService.createThread).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ model: 'google' }));
    });

    it('falls back to openai when model is absent and defaultModel is null', async () => {
      mockPreferencesService.getPreferences.mockResolvedValue({ defaultModel: null, displayName: null });
      const thread = { id: 'tid-3', userId: USER_ID, model: 'openai', title: null };
      mockThreadService.createThread.mockResolvedValue(thread);

      const res = await request(app)
        .post('/api/v1/threads')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(mockThreadService.createThread).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ model: 'openai' }));
    });
  });

  describe('GET /api/v1/threads', () => {
    it('lists threads for the authenticated user', async () => {
      const threads = [{ id: 'tid-1', title: 'Chat 1' }];
      mockThreadService.listThreads.mockResolvedValue(threads);

      const res = await request(app)
        .get('/api/v1/threads')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(threads);
    });

    it('passes cursor and limit params', async () => {
      mockThreadService.listThreads.mockResolvedValue([]);

      await request(app)
        .get('/api/v1/threads?cursor=tid-1&limit=5')
        .set('Authorization', `Bearer ${authToken}`);

      expect(mockThreadService.listThreads).toHaveBeenCalledWith(USER_ID, 'tid-1', 5);
    });
  });

  describe('GET /api/v1/threads/:id', () => {
    it('returns thread with last 50 messages', async () => {
      const thread = { id: 'tid-1', userId: USER_ID };
      mockThreadService.getThreadById.mockResolvedValue(thread);
      mockMessageService.getByThread.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/threads/tid-1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.thread).toEqual(thread);
      expect(res.body.messages).toEqual([]);
    });

    it('returns 404 if thread not found', async () => {
      mockThreadService.getThreadById.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/threads/bad-id')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/threads/:id', () => {
    it('updates thread metadata', async () => {
      const updated = { id: 'tid-1', title: 'Renamed' };
      mockThreadService.updateThread.mockResolvedValue(updated);

      const res = await request(app)
        .patch('/api/v1/threads/tid-1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ title: 'Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Renamed');
    });
  });

  describe('DELETE /api/v1/threads/:id', () => {
    it('soft-deletes and returns 200', async () => {
      const deleted = { id: 'tid-1', status: 'deleted' };
      mockThreadService.softDeleteThread.mockResolvedValue(deleted);

      const res = await request(app)
        .delete('/api/v1/threads/tid-1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('deleted');
    });
  });
});
