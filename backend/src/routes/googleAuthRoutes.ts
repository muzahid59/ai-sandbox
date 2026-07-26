import { Router, Request, Response } from 'express';
import { googleAuthService } from '../services/googleAuthService';
import { authMiddleware } from '../middleware/auth';
import logger from '../config/logger';

const log = logger.child({ route: 'googleAuth' });

export const googleAuthRoutes = Router();

googleAuthRoutes.get('/auth/google', authMiddleware, (req: Request, res: Response) => {
  try {
    const authorizeUrl = googleAuthService.buildAuthorizeUrl(req.user!.id);
    res.redirect(authorizeUrl);
  } catch (err: any) {
    log.error({ err }, 'OAuth initiation failed');
    res.status(500).json({ error: { type: 'internal_error', message: err.message } });
  }
});

async function handleOAuthCallback(req: Request, res: Response) {
  const { code, state, error } = req.query;
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  if (error === 'access_denied') {
    res.redirect(`${baseUrl}?google=error&reason=denied`);
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: { type: 'bad_request', message: 'Missing authorization code.' } });
    return;
  }

  if (!state || typeof state !== 'string') {
    res.status(400).json({ error: { type: 'bad_request', message: 'Missing state parameter.' } });
    return;
  }

  try {
    await googleAuthService.handleCallback(code, state);
    log.info({ userId: state }, 'OAuth callback complete');
    res.redirect(`${baseUrl}?google=connected`);
  } catch (err: any) {
    log.error({ err, userId: state }, 'Token exchange failed');
    res.status(500).json({ error: { type: 'internal_error', message: 'Token exchange failed.' } });
  }
}

// Handle both the new path and the legacy path already registered in Google Cloud Console
googleAuthRoutes.get('/auth/google/callback', handleOAuthCallback);
googleAuthRoutes.get('/auth/gmail/callback', handleOAuthCallback);

googleAuthRoutes.get('/auth/google/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const status = await googleAuthService.getConnectionStatus(req.user!.id);
    res.json(status);
  } catch (err: any) {
    log.error({ err }, 'Status check failed');
    res.status(500).json({ error: { type: 'internal_error', message: err.message } });
  }
});

googleAuthRoutes.delete('/auth/google', authMiddleware, async (req: Request, res: Response) => {
  const connected = await googleAuthService.isConnected(req.user!.id);
  if (!connected) {
    res.status(404).json({ error: { type: 'not_found', message: 'No Google account connected.' } });
    return;
  }
  try {
    await googleAuthService.revokeTokens(req.user!.id);
    res.json({ disconnected: true });
  } catch (err: any) {
    log.error({ err }, 'Disconnect failed');
    res.status(500).json({ error: { type: 'internal_error', message: err.message } });
  }
});
