import { Router } from 'express';
import {
  handleCreateThread,
  handleListThreads,
  handleGetThread,
  handleUpdateThread,
  handleDeleteThread,
} from '../controllers/threadController';

const router = Router();

router.post('/threads', handleCreateThread);
router.get('/threads', handleListThreads);
router.get('/threads/:id', handleGetThread);
router.patch('/threads/:id', handleUpdateThread);
router.delete('/threads/:id', handleDeleteThread);

export { router as threadRoutes };
