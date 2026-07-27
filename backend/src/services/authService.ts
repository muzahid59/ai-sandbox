import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/database';
import logger from '../config/logger';

const log = logger.child({ service: 'auth' });
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

function getSecret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new Error('JWT_ACCESS_SECRET env var is required');
  return s;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateAccessToken(userId: string, email: string): string {
  return jwt.sign({ id: userId, email }, getSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): { id: string; email: string } {
  return jwt.verify(token, getSecret()) as { id: string; email: string };
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createRefreshTokenRecord(userId: string, token: string) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
  const record = await prisma.refreshToken.create({
    data: { token, userId, expiresAt },
  });
  log.debug({ userId }, 'Refresh token created');
  return record;
}

export async function findValidRefreshToken(token: string) {
  return prisma.refreshToken.findFirst({
    where: {
      token,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { token },
    data: { revokedAt: new Date() },
  });
  log.debug('Refresh token revoked');
}
