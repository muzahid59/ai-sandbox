import crypto from 'crypto';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../config/database';
import { GoogleConnectionStatus, TokenRecord } from '../types/google';
import { ToolError } from '../errors';
import logger from '../config/logger';

const log = logger.child({ service: 'googleAuth' });

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.readonly',
];

function getEncryptionKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ciphertext.toString('base64')}:${authTag.toString('base64')}`;
}

function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const [ivB64, ciphertextB64, authTagB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}

function createOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }
  // Use the redirect URI already registered in Google Cloud Console.
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5001/api/v1/auth/gmail/callback';
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

class GoogleAuthService {
  async saveTokens(userId: string, credentials: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null; scope?: string | null }, googleEmail: string): Promise<void> {
    const encryptedAccess = encrypt(credentials.access_token!);
    const encryptedRefresh = encrypt(credentials.refresh_token!);
    const scopes = (credentials.scope ?? SCOPES.join(' ')).split(' ').filter(Boolean);
    const expiryTimestamp = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3600 * 1000);

    await prisma.googleOAuthToken.upsert({
      where: { userId },
      update: {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiryTimestamp,
        scopes,
        googleEmail,
      },
      create: {
        userId,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiryTimestamp,
        scopes,
        googleEmail,
      },
    });

    log.info({ userId, googleEmail }, 'Tokens saved');
  }

  async getTokens(userId: string): Promise<TokenRecord | null> {
    const record = await prisma.googleOAuthToken.findUnique({ where: { userId } });
    if (!record) return null;
    return {
      accessToken: decrypt(record.accessToken),
      refreshToken: decrypt(record.refreshToken),
      expiryTimestamp: record.expiryTimestamp,
      scopes: record.scopes,
      googleEmail: record.googleEmail,
    };
  }

  async revokeTokens(userId: string): Promise<void> {
    const tokens = await this.getTokens(userId);
    if (tokens) {
      try {
        const oauth2 = createOAuth2Client();
        oauth2.setCredentials({ access_token: tokens.accessToken });
        await oauth2.revokeToken(tokens.accessToken);
      } catch (err) {
        log.warn({ userId, err }, 'Google token revocation failed — continuing with DB deletion');
      }
    }
    await prisma.googleOAuthToken.deleteMany({ where: { userId } });
    log.info({ userId }, 'Tokens revoked and deleted');
  }

  async isConnected(userId: string): Promise<boolean> {
    const record = await prisma.googleOAuthToken.findUnique({ where: { userId } });
    return record !== null;
  }

  async getConnectionStatus(userId: string): Promise<GoogleConnectionStatus> {
    const record = await prisma.googleOAuthToken.findUnique({ where: { userId } });
    if (!record) {
      return { connected: false, authorizeUrl: this.buildAuthorizeUrl(userId) };
    }
    return {
      connected: true,
      email: record.googleEmail,
      scopes: record.scopes,
      connectedAt: record.createdAt.toISOString(),
    };
  }

  buildAuthorizeUrl(userId: string): string {
    const oauth2 = createOAuth2Client();
    return oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state: userId,
    });
  }

  async handleCallback(code: string, userId: string): Promise<void> {
    const oauth2 = createOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userInfoRes.json() as { email?: string };
    const googleEmail = userInfo.email ?? '';

    await this.saveTokens(userId, tokens, googleEmail);
    log.info({ userId, googleEmail }, 'OAuth callback processed');
  }

  async getAuthClient(userId: string): Promise<OAuth2Client> {
    const tokens = await this.getTokens(userId);
    if (!tokens) {
      throw new ToolError('Google account not connected. Please connect your Google account first.');
    }

    const oauth2 = createOAuth2Client();
    oauth2.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiryTimestamp.getTime(),
    });

    if (tokens.expiryTimestamp.getTime() < Date.now()) {
      log.info({ userId }, 'Access token expired, refreshing');
      try {
        const { credentials } = await oauth2.refreshAccessToken();
        const record = await prisma.googleOAuthToken.findUnique({ where: { userId } });
        await this.saveTokens(userId, {
          ...credentials,
          refresh_token: credentials.refresh_token ?? tokens.refreshToken,
          scope: record?.scopes.join(' '),
        }, tokens.googleEmail);
        oauth2.setCredentials(credentials);
      } catch (err) {
        log.error({ userId, err }, 'Token refresh failed — revoking');
        await prisma.googleOAuthToken.deleteMany({ where: { userId } });
        throw new ToolError('Your Google connection has expired. Please reconnect your account.');
      }
    }

    return oauth2;
  }

  async hasScope(userId: string, requiredScope: string): Promise<void> {
    const tokens = await this.getTokens(userId);
    if (!tokens || !tokens.scopes.some((s) => s.includes(requiredScope))) {
      const authorizeUrl = this.buildAuthorizeUrl(userId);
      throw new ToolError(
        `Missing required Google permission: ${requiredScope}. Please reconnect your account: ${authorizeUrl}`,
      );
    }
  }
}

export const googleAuthService = new GoogleAuthService();

export { encrypt, decrypt, getEncryptionKey };
