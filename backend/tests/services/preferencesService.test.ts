const mockPrisma = {
  userPreferences: {
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import * as preferencesService from '../../src/services/preferencesService';

const userId = 'user-1';

const makePrefs = (overrides = {}) => ({
  id: 'prefs-1',
  userId,
  defaultModel: null,
  customInstructions: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeUser = (overrides = {}) => ({
  id: userId,
  displayName: null,
  ...overrides,
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('getPreferences', () => {
  it('merges displayName from User', async () => {
    mockPrisma.userPreferences.findUniqueOrThrow.mockResolvedValue(makePrefs());
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(makeUser({ displayName: 'Alex' }));

    const result = await preferencesService.getPreferences(userId);
    expect(result.displayName).toBe('Alex');
  });
});

describe('updatePreferences', () => {
  it('updates User.displayName when displayName is provided', async () => {
    mockPrisma.user.update.mockResolvedValue({});
    mockPrisma.userPreferences.findUniqueOrThrow.mockResolvedValue(makePrefs());
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(makeUser({ displayName: 'NewName' }));

    await preferencesService.updatePreferences(userId, { displayName: 'NewName' });

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: userId }, data: { displayName: 'NewName' } }),
    );
  });

  it('updates defaultModel without touching displayName', async () => {
    mockPrisma.userPreferences.update.mockResolvedValue(makePrefs({ defaultModel: 'google' }));
    mockPrisma.userPreferences.findUniqueOrThrow.mockResolvedValue(makePrefs({ defaultModel: 'google' }));
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());

    await preferencesService.updatePreferences(userId, { defaultModel: 'google' });

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.userPreferences.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { defaultModel: 'google' } }),
    );
  });

  it('clears customInstructions when passed null', async () => {
    mockPrisma.userPreferences.update.mockResolvedValue(makePrefs());
    mockPrisma.userPreferences.findUniqueOrThrow.mockResolvedValue(makePrefs());
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue(makeUser());

    await preferencesService.updatePreferences(userId, { customInstructions: null });

    expect(mockPrisma.userPreferences.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customInstructions: null } }),
    );
  });
});

describe('initializeDefaults', () => {
  it('creates record with null defaultModel and customInstructions', async () => {
    mockPrisma.userPreferences.create.mockResolvedValue(makePrefs());

    await preferencesService.initializeDefaults(userId);

    expect(mockPrisma.userPreferences.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId } }),
    );
  });
});
