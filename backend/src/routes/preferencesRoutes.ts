import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import * as preferencesService from '../services/preferencesService';
import { BadRequestError } from '../errors';
import logger from '../config/logger';

const router = Router();
const log = logger.child({ service: 'preferencesRoutes' });

const patchSchema = z.object({
  displayName: z.string().min(1).max(100).nullable().optional(),
  defaultModel: z.enum(['openai', 'google', 'deepseek', 'lama']).nullable().optional(),
  customInstructions: z.string().min(1).max(2000).nullable().optional(),
});

router.get('/preferences', asyncHandler(async (req, res) => {
  const prefs = await preferencesService.getPreferences(req.user!.id);
  return res.json(prefs);
}));

router.patch('/preferences', asyncHandler(async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { type: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Validation failed' } });
  }

  const prefs = await preferencesService.updatePreferences(req.user!.id, parsed.data);
  log.debug({ userId: req.user!.id }, 'Preferences updated via API');
  return res.json(prefs);
}));

export { router as preferencesRoutes };
