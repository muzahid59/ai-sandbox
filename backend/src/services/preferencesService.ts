import { UserPreferences } from '@prisma/client';
import prisma from '../config/database';
import logger from '../config/logger';

const log = logger.child({ service: 'preferences' });

export interface PreferencesResult extends UserPreferences {
  displayName: string | null;
}

export async function getPreferences(userId: string): Promise<PreferencesResult> {
  const [prefs, user] = await Promise.all([
    prisma.userPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {},
    }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } }),
  ]);
  return { ...prefs, displayName: user.displayName };
}

export async function updatePreferences(
  userId: string,
  update: {
    displayName?: string | null;
    defaultModel?: string | null;
    customInstructions?: string | null;
  },
): Promise<PreferencesResult> {
  if ('displayName' in update) {
    await prisma.user.update({
      where: { id: userId },
      data: { displayName: update.displayName ?? null },
    });
  }

  const prefsUpdate: Record<string, unknown> = {};
  if ('defaultModel' in update) prefsUpdate.defaultModel = update.defaultModel ?? null;
  if ('customInstructions' in update) prefsUpdate.customInstructions = update.customInstructions ?? null;

  if (Object.keys(prefsUpdate).length > 0) {
    await prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...prefsUpdate },
      update: prefsUpdate,
    });
  }

  log.debug({ userId }, 'Preferences updated');
  return getPreferences(userId);
}

export async function initializeDefaults(userId: string): Promise<void> {
  await prisma.userPreferences.create({ data: { userId } });
  log.debug({ userId }, 'Preferences initialized');
}
