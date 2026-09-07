const mockPendingActionService = {
  getPendingAction: jest.fn(),
  resolvePendingAction: jest.fn(),
  getThreadPendingAction: jest.fn(),
};

const mockToolRegistry = {
  execute: jest.fn(),
  getDefinitions: jest.fn().mockReturnValue([]),
  register: jest.fn(),
  has: jest.fn(),
};

const mockContextService = {
  buildContextWindow: jest.fn().mockResolvedValue([]),
  invalidate: jest.fn(),
  estimateTokens: jest.fn(),
};

const mockThreadService = {
  getThreadById: jest.fn(),
  incrementThreadTokens: jest.fn(),
};

const mockMessageService = {
  createMessage: jest.fn().mockResolvedValue({ id: 'msg-new' }),
  getByThread: jest.fn(),
  updateMessageStatus: jest.fn(),
  countByThread: jest.fn(),
};

const mockChatCompletion = jest.fn();

jest.mock('../../src/services/pendingActionService', () => mockPendingActionService);
jest.mock('../../src/services/toolRegistry', () => ({ toolRegistry: mockToolRegistry }));
jest.mock('../../src/services/contextService', () => ({
  contextService: mockContextService,
  ContextService: jest.fn(),
}));
jest.mock('../../src/services/threadService', () => mockThreadService);
jest.mock('../../src/services/messageService', () => mockMessageService);
jest.mock('../../src/providers', () => ({
  createProvider: jest.fn(() => ({
    name: 'test',
    chatCompletion: mockChatCompletion,
  })),
  registerProviders: jest.fn(),
}));
jest.mock('../../src/prompts', () => ({
  getSystemPrompt: jest.fn(() => 'system prompt'),
}));
jest.mock('../../src/services/memoryService', () => ({
  buildMemorySystemPrompt: jest.fn().mockResolvedValue(''),
}));
jest.mock('../../src/tools', () => ({
  registerAllTools: jest.fn(),
}));
jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: {},
}));

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../../src/middleware/auth';
import { errorHandler } from '../../src/middleware/errorHandler';
import { actionRoutes } from '../../src/routes/actionRoutes';

const TEST_SECRET = 'test-secret-actions';
process.env.JWT_ACCESS_SECRET = TEST_SECRET;

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/v1', actionRoutes);
app.use(errorHandler);

const USER_ID = 'user-1';
const USER_EMAIL = 'test@example.com';
const authToken = jwt.sign({ id: USER_ID, email: USER_EMAIL }, TEST_SECRET, { expiresIn: '1h' });

const makePendingAction = (overrides: Record<string, unknown> = {}) => ({
  id: 'pa-1',
  threadId: 'thread-1',
  userId: USER_ID,
  messageId: 'msg-1',
  toolName: 'test_approval',
  toolCallId: 'tc-1',
  arguments: { message: 'hello' },
  status: 'pending',
  expiresAt: new Date(Date.now() + 600_000),
  resolvedAt: null,
  createdAt: new Date(),
  ...overrides,
});

describe('Action API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /api/v1/actions/:id', () => {
    it('returns 200 with action data', async () => {
      const action = makePendingAction();
      mockPendingActionService.getPendingAction.mockResolvedValue(action);

      const res = await request(app)
        .get('/api/v1/actions/pa-1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('pa-1');
      expect(res.body.toolName).toBe('test_approval');
      expect(res.body.status).toBe('pending');
    });

    it('returns 404 when action not found', async () => {
      mockPendingActionService.getPendingAction.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/actions/nonexistent')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ACTION_NOT_FOUND');
    });
  });

  describe('POST /api/v1/actions/:id/approve', () => {
    it('returns 404 when action not found', async () => {
      mockPendingActionService.getPendingAction.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/actions/nonexistent/approve')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ACTION_NOT_FOUND');
    });

    it('returns 409 when action already resolved', async () => {
      const action = makePendingAction({ status: 'approved' });
      mockPendingActionService.getPendingAction.mockResolvedValue(action);

      const res = await request(app)
        .post('/api/v1/actions/pa-1/approve')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ACTION_ALREADY_RESOLVED');
    });

    it('returns 410 when action has expired', async () => {
      const action = makePendingAction({ expiresAt: new Date(Date.now() - 1000) });
      mockPendingActionService.getPendingAction.mockResolvedValue(action);
      mockPendingActionService.resolvePendingAction.mockResolvedValue({ ok: true, action: { ...action, status: 'expired' } });

      const res = await request(app)
        .post('/api/v1/actions/pa-1/approve')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(410);
      expect(res.body.code).toBe('ACTION_EXPIRED');
    });

    it('returns SSE stream on success', async () => {
      const action = makePendingAction();
      mockPendingActionService.getPendingAction.mockResolvedValue(action);
      mockPendingActionService.resolvePendingAction.mockResolvedValue({ ok: true, action: { ...action, status: 'approved' } });
      mockToolRegistry.execute.mockResolvedValue({ output: 'hello', is_error: false });
      mockThreadService.getThreadById.mockResolvedValue({ id: 'thread-1', model: 'openai', userId: USER_ID });
      mockChatCompletion.mockResolvedValue({
        text: 'Done!',
        contentBlocks: [{ type: 'text', text: 'Done!' }],
        toolCalls: [],
        stopReason: 'end_turn',
      });

      const res = await request(app)
        .post('/api/v1/actions/pa-1/approve')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      const body = res.text;
      expect(body).toContain('"type":"content_block_stop"');
      expect(body).toContain('"type":"message_stop"');
    });
  });

  describe('POST /api/v1/actions/:id/reject', () => {
    it('returns 404 when action not found', async () => {
      mockPendingActionService.getPendingAction.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/actions/nonexistent/reject')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ACTION_NOT_FOUND');
    });

    it('returns 409 when action already resolved', async () => {
      const action = makePendingAction({ status: 'rejected' });
      mockPendingActionService.getPendingAction.mockResolvedValue(action);

      const res = await request(app)
        .post('/api/v1/actions/pa-1/reject')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ACTION_ALREADY_RESOLVED');
    });

    it('returns SSE stream on success', async () => {
      const action = makePendingAction();
      mockPendingActionService.getPendingAction.mockResolvedValue(action);
      mockPendingActionService.resolvePendingAction.mockResolvedValue({ ok: true, action: { ...action, status: 'rejected' } });
      mockThreadService.getThreadById.mockResolvedValue({ id: 'thread-1', model: 'openai', userId: USER_ID });
      mockChatCompletion.mockResolvedValue({
        text: 'Action cancelled.',
        contentBlocks: [{ type: 'text', text: 'Action cancelled.' }],
        toolCalls: [],
        stopReason: 'end_turn',
      });

      const res = await request(app)
        .post('/api/v1/actions/pa-1/reject')
        .set('Authorization', `Bearer ${authToken}`)
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      const body = res.text;
      expect(body).toContain('"type":"message_stop"');
    });
  });
});
