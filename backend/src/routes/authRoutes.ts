import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import * as authService from '../services/authService';
import logger from '../config/logger';

const log = logger.child({ service: 'authRoutes' });

export const authRoutes = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(1024),
});

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

authRoutes.post('/register', async (req: Request, res: Response) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'validation_error', message: parsed.error.issues[0].message } });
    return;
  }

  const { email: rawEmail, password } = parsed.data;
  const email = rawEmail.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: { type: 'conflict', message: 'Email already registered' } });
    return;
  }

  const passwordHash = await authService.hashPassword(password);
  const user = await prisma.user.create({ data: { email, passwordHash } });

  const accessToken = authService.generateAccessToken(user.id, user.email);
  const refreshToken = authService.generateRefreshToken();
  await authService.createRefreshTokenRecord(user.id, refreshToken);

  res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
  log.info({ userId: user.id }, 'User registered');
  res.status(201).json({ accessToken, user: { id: user.id, email: user.email } });
});

authRoutes.post('/login', async (req: Request, res: Response) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { type: 'validation_error', message: parsed.error.issues[0].message } });
    return;
  }

  const { email: rawEmail, password } = parsed.data;
  const email = rawEmail.toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: { type: 'invalid_credentials', message: 'Invalid email or password' } });
    return;
  }

  const valid = await authService.verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: { type: 'invalid_credentials', message: 'Invalid email or password' } });
    return;
  }

  const accessToken = authService.generateAccessToken(user.id, user.email);
  const refreshToken = authService.generateRefreshToken();
  await authService.createRefreshTokenRecord(user.id, refreshToken);

  res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
  log.info({ userId: user.id }, 'User logged in');
  res.status(200).json({ accessToken, user: { id: user.id, email: user.email } });
});

authRoutes.post('/refresh', async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken;
  if (!token) {
    res.status(401).json({ error: { type: 'unauthorized', message: 'No refresh token' } });
    return;
  }

  const record = await authService.findValidRefreshToken(token);
  if (!record) {
    res.status(401).json({ error: { type: 'invalid_token', message: 'Refresh token is invalid or expired' } });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user) {
    res.status(401).json({ error: { type: 'unauthorized', message: 'User not found' } });
    return;
  }

  const accessToken = authService.generateAccessToken(user.id, user.email);
  res.status(200).json({ accessToken });
});

authRoutes.post('/logout', async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    try {
      await authService.revokeRefreshToken(token);
    } catch (err) {
      log.warn({ err }, 'Failed to revoke refresh token during logout (fail-open)');
    }
  }
  res.clearCookie('refreshToken', COOKIE_OPTIONS);
  res.status(200).json({ loggedOut: true });
});
