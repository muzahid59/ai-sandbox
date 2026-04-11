import { Router } from 'express';
import {
  handleSendMessage,
  handleGetMessages,
} from '../controllers/messageController';

const router = Router();

router.post('/threads/:id/messages', handleSendMessage);
router.get('/threads/:id/messages', handleGetMessages);

export { router as messageRoutes };
