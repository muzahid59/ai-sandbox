const mockThreadService = {
  getThreadById: jest.fn(),
};

const mockMessageService = {
  createMessage: jest.fn(),
  getByThread: jest.fn(),
  updateMessageStatus: jest.fn(),
  countByThread: jest.fn(),
  incrementThreadTokens: jest.fn(),
};

const mockContextService = {
  buildContextWindow: jest.fn(),
  invalidate: jest.fn(),
  estimateTokens: jest.fn(),
};

const mockChatService = {
  processMessage: jest.fn(),
};

jest.mock('../../src/services/threadService', () => mockThreadService);
jest.mock('../../src/services/messageService', () => mockMessageService);
jest.mock('../../src/services/contextService', () => ({
  contextService: mockContextService,
  ContextService: jest.fn(),
}));
jest.mock('../../src/services/chatService', () => mockChatService);

// Mock prisma for title update
const mockPrisma = {
  thread: { update: jest.fn() },
};
jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import request from 'supertest';
import express from 'express';
import { authMiddleware } from '../../src/middleware/auth';
import { messageRoutes } from '../../src/routes/messageRoutes';

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/v1', messageRoutes);

const USER_ID = '00000000-0000-0000-0000-000000000001';

describe('Message API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /api/v1/threads/:id/messages', () => {
    it('returns paginated messages', async () => {
      mockThreadService.getThreadById.mockResolvedValue({ id: 'tid-1', userId: USER_ID });
      const msgs = [{ id: 'mid-1', role: 'user', content: [{ type: 'text', text: 'Hi' }] }];
      mockMessageService.getByThread.mockResolvedValue(msgs);

      const res = await request(app).get('/api/v1/threads/tid-1/messages');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(msgs);
    });

    it('returns 404 for unknown thread', async () => {
      mockThreadService.getThreadById.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/threads/bad/messages');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/threads/:id/messages', () => {
    it('returns 404 if thread not found', async () => {
      mockThreadService.getThreadById.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/threads/bad/messages')
        .send({ content: [{ type: 'text', text: 'Hi' }] });

      expect(res.status).toBe(404);
    });

    it('returns 400 if content is missing', async () => {
      mockThreadService.getThreadById.mockResolvedValue({ id: 'tid-1', userId: USER_ID });

      const res = await request(app)
        .post('/api/v1/threads/tid-1/messages')
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
