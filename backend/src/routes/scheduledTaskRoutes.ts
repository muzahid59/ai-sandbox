import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  handleCreateTask,
  handleListTasks,
  handleGetTask,
  handleUpdateTask,
  handleDeleteTask,
  handleGetExecutions,
} from '../controllers/scheduledTaskController';

const router = Router();

router.get('/scheduled-tasks', asyncHandler(handleListTasks));
router.post('/scheduled-tasks', asyncHandler(handleCreateTask));
router.get('/scheduled-tasks/:id', asyncHandler(handleGetTask));
router.patch('/scheduled-tasks/:id', asyncHandler(handleUpdateTask));
router.delete('/scheduled-tasks/:id', asyncHandler(handleDeleteTask));
router.get('/scheduled-tasks/:id/executions', asyncHandler(handleGetExecutions));

export { router as scheduledTaskRoutes };
