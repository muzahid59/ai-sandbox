import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { uploadDocument, handleUploadError } from '../middleware/upload';
import {
  handleUploadDocument,
  handleIngestUrl,
  handleListDocuments,
  handleGetDocument,
  handleDeleteDocument,
  handleCancelDocument,
  handleCheckDuplicate,
} from '../controllers/documentController';

const router = Router({ mergeParams: true });

router.get('/check-duplicate', asyncHandler(handleCheckDuplicate));

router.post(
  '/',
  (req, res, next) => {
    if (req.is('application/json')) {
      return asyncHandler(handleIngestUrl)(req, res, next);
    }
    uploadDocument(req, res, (err) => {
      if (err) return handleUploadError(err, req, res, next);
      asyncHandler(handleUploadDocument)(req, res, next);
    });
  }
);

router.get('/', asyncHandler(handleListDocuments));
router.get('/:documentId', asyncHandler(handleGetDocument));
router.delete('/:documentId', asyncHandler(handleDeleteDocument));
router.post('/:documentId/cancel', asyncHandler(handleCancelDocument));

export { router as documentRoutes };
