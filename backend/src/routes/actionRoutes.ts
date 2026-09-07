import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { handleApproveAction, handleRejectAction, handleGetAction } from '../controllers/actionController';

const router = Router();

router.post('/actions/:id/approve', asyncHandler(handleApproveAction));
router.post('/actions/:id/reject', asyncHandler(handleRejectAction));
router.get('/actions/:id', asyncHandler(handleGetAction));

export { router as actionRoutes };
