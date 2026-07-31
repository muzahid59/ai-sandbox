import { Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';

const ALLOWED_MIME_TYPES = ['application/pdf', 'text/plain', 'text/markdown'];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new MulterError('LIMIT_UNEXPECTED_FILE', 'Only PDF, TXT, and MD files are supported'));
    }
  },
});

export const uploadDocument = upload.single('file');

export function handleUploadError(err: Error, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ code: 'FILE_TOO_LARGE', message: 'File exceeds the 20 MB limit' });
      return;
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      res
        .status(400)
        .json({
          code: 'UNSUPPORTED_FORMAT',
          message: err.message || 'Only PDF, TXT, and MD files are supported',
        });
      return;
    }
  }
  next(err);
}
