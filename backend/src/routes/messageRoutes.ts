import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  handleSendMessage,
  handleGetMessages,
} from '../controllers/messageController';

const router = Router();

router.post('/threads/:id/messages', asyncHandler(handleSendMessage));
router.get('/threads/:id/messages', asyncHandler(handleGetMessages));

export { router as messageRoutes };
