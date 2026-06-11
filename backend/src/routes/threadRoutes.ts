import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  handleCreateThread,
  handleListThreads,
  handleGetThread,
  handleUpdateThread,
  handleDeleteThread,
} from '../controllers/threadController';

const router = Router();

router.post('/threads', asyncHandler(handleCreateThread));
router.get('/threads', asyncHandler(handleListThreads));
router.get('/threads/:id', asyncHandler(handleGetThread));
router.patch('/threads/:id', asyncHandler(handleUpdateThread));
router.delete('/threads/:id', asyncHandler(handleDeleteThread));

export { router as threadRoutes };
