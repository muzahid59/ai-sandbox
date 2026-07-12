import { Router, Request, Response } from 'express';
import { emailService } from '../services/emailService';
import { authMiddleware } from '../middleware/auth';
import logger from '../config/logger';

const log = logger.child({ route: 'gmailAuth' });

export const gmailAuthRoutes = Router();

gmailAuthRoutes.get('/auth/gmail', authMiddleware, (req: Request, res: Response) => {
  try {
    const oauth2 = emailService.createOAuth2Client();
    const authorizeUrl = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: emailService.getScopes(),
      state: req.user!.id,
    });
    res.redirect(authorizeUrl);
  } catch (err: any) {
    log.error({ err }, 'OAuth initiation failed');
    res.status(500).json({
      error: { type: 'internal_error', message: err.message },
    });
  }
});

gmailAuthRoutes.get('/auth/gmail/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    res.status(400).json({
      error: { type: 'bad_request', message: 'Authorization denied by user.' },
    });
    return;
  }

  if (!code || typeof code !== 'string') {
    res.status(400).json({
      error: { type: 'bad_request', message: 'Missing authorization code.' },
    });
    return;
  }

  const userId = typeof state === 'string' ? state : '';
  if (!userId) {
    res.status(400).json({
      error: { type: 'bad_request', message: 'Missing state parameter.' },
    });
    return;
  }

  try {
    const oauth2 = emailService.createOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    oauth2.setCredentials(tokens);
    const gmail = (await import('googleapis')).google.gmail({ version: 'v1', auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress ?? '';

    emailService.saveTokens(userId, {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiryDate: tokens.expiry_date!,
      scopes: (tokens.scope ?? '').split(' '),
      email,
      obtainedAt: new Date().toISOString(),
    });

    log.info({ userId, email }, 'Gmail OAuth complete');

    res.status(200).send(`
      <html>
      <body>
        <h1>Gmail Connected</h1>
        <p>You can close this window and return to the chat.</p>
      </body>
      </html>
    `);
  } catch (err: any) {
    log.error({ err, userId }, 'Token exchange failed');
    res.status(500).json({
      error: { type: 'internal_error', message: 'Token exchange failed.' },
    });
  }
});

gmailAuthRoutes.get('/auth/gmail/status', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tokens = emailService.getTokens(userId);

  if (!tokens) {
    res.json({ connected: false, authorizeUrl: '/api/v1/auth/gmail' });
    return;
  }

  res.json({
    connected: true,
    email: tokens.email,
    scopes: tokens.scopes,
    connectedAt: tokens.obtainedAt,
  });
});
