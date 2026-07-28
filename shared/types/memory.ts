export type MemorySource = 'manual' | 'extracted';

export interface Memory {
  id: string;
  userId: string;
  content: string;
  source: MemorySource;
  sourceThreadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  id: string;
  userId: string;
  displayName: string | null;
  defaultModel: string | null;
  customInstructions: string | null;
  createdAt: string;
  updatedAt: string;
}
