/* eslint-disable @typescript-eslint/no-require-imports */

describe('levels progress store', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('sanitizes persisted progress and keeps the world aligned to the campaign level', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      storage.set(
        KEYS.levelsProgress,
        JSON.stringify({
          world: 'world1',
          currentLevel: 431,
          completed: [500, 431, 431, 0, 'bad'],
        }),
      );

      const { useLevels } = require('../store');
      expect(useLevels.getState().currentLevel).toBe(431);
      expect(useLevels.getState().world).toBe('world7');
      expect(useLevels.getState().completed).toEqual([431, 500]);
    });
  });

  test('completing level 500 unlocks the second route once', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));

      const { useLevels } = require('../store');
      expect(useLevels.getState().completeLevelOnce('completion-500', 500)).toBe(true);
      expect(useLevels.getState().completeLevelOnce('completion-500', 500)).toBe(false);
      expect(useLevels.getState().currentLevel).toBe(501);
      expect(useLevels.getState().world).toBe('world8');
      expect(useLevels.getState().completed).toEqual([500]);
    });
  });

  test('existing campaign finishers resume at 501 with their completed levels intact', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      const completed = Array.from({ length: 500 }, (_, index) => index + 1);
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world7', currentLevel: 501, completed }));

      const { useLevels } = require('../store');
      expect(useLevels.getState()).toMatchObject({ world: 'world8', currentLevel: 501, completed });
    });
  });

  test('completing level 1000 opens the third route exactly once', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      const { useLevels } = require('../store');
      expect(useLevels.getState().completeLevelOnce('completion-1000', 1000)).toBe(true);
      expect(useLevels.getState().completeLevelOnce('completion-1000', 1000)).toBe(false);
      expect(useLevels.getState()).toMatchObject({ world: 'world15', currentLevel: 1001, completed: [1000] });
      expect(JSON.parse(storage.getString(KEYS.levelsProgress))).toMatchObject({ world: 'world15', currentLevel: 1001, completed: [1000] });
    });
  });

  test('existing second-route finishers resume at 1001 without losing progress or replaying its completion', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      const completed = Array.from({ length: 1000 }, (_, index) => index + 1);
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world14', currentLevel: 1001, completed }));
      storage.set(KEYS.levelsRewardLedger, JSON.stringify({ 'completion-1000': 123 }));

      const { useLevels } = require('../store');
      expect(useLevels.getState()).toMatchObject({ world: 'world15', currentLevel: 1001, completed });
      expect(useLevels.getState().completeLevelOnce('completion-1000', 1000)).toBe(false);
      expect(useLevels.getState().completeLevelOnce('completion-1001', 1001)).toBe(true);
      expect(useLevels.getState()).toMatchObject({ world: 'world15', currentLevel: 1002, completed: [...completed, 1001] });
      expect(JSON.parse(storage.getString(KEYS.levelsProgress))).toMatchObject({ currentLevel: 1002, completed: [...completed, 1001] });
    });
  });

  test('completing the third-route finale persists and restores the campaign-end sentinel', () => {
    const completed = Array.from({ length: 1500 }, (_, index) => index + 1);
    let savedProgress = '';
    let savedLedger = '';
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world21', currentLevel: 1500, completed: completed.slice(0, -1) }));
      const { useLevels } = require('../store');
      expect(useLevels.getState().completeLevelOnce('completion-1500', 1500)).toBe(true);
      expect(useLevels.getState()).toMatchObject({ world: 'world21', currentLevel: 1501, completed });
      expect(JSON.parse(storage.getString(KEYS.levelsProgress))).toMatchObject({ world: 'world21', currentLevel: 1501, completed });
      savedProgress = storage.getString(KEYS.levelsProgress);
      savedLedger = storage.getString(KEYS.levelsRewardLedger);
    });
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.set(KEYS.levelsProgress, savedProgress);
      storage.set(KEYS.levelsRewardLedger, savedLedger);
      const { useLevels } = require('../store');
      expect(useLevels.getState()).toMatchObject({ world: 'world21', currentLevel: 1501, completed });
      expect(useLevels.getState().completeLevelOnce('completion-1500', 1500)).toBe(false);
    });
  });

  test('writes the previous valid progress before publishing a completion', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      const { useLevels } = require('../store');
      const original = storage.set.bind(storage);
      const order: string[] = [];
      storage.set = (key: string, value: string) => {
        order.push(key);
        return original(key, value);
      };
      expect(useLevels.getState().completeLevelOnce('completion-1', 1)).toBe(true);
      expect(order).toEqual([KEYS.levelsProgressBackup, KEYS.levelsProgress, KEYS.levelsRewardLedger]);
      expect(JSON.parse(storage.getString(KEYS.levelsProgressBackup))).toMatchObject({ currentLevel: 1, completed: [] });
      expect(JSON.parse(storage.getString(KEYS.levelsProgress))).toMatchObject({ currentLevel: 2, completed: [1] });
      storage.set = original;
    });
  });

  test('a failed primary write leaves the effect retryable and React state unchanged', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      const { useLevels } = require('../store');
      const original = storage.set.bind(storage);
      storage.set = (key: string, value: string) => {
        if (key === KEYS.levelsProgress) throw new Error('disk full');
        return original(key, value);
      };
      expect(() => useLevels.getState().completeLevelOnce('completion-1', 1)).toThrow('disk full');
      expect(useLevels.getState()).toMatchObject({ currentLevel: 1, completed: [] });
      expect(storage.getString(KEYS.levelsRewardLedger)).toBeUndefined();
      expect(JSON.parse(storage.getString(KEYS.levelsProgressBackup))).toMatchObject({ currentLevel: 1, completed: [] });
      storage.set = original;
      expect(useLevels.getState().completeLevelOnce('completion-1', 1)).toBe(true);
      expect(useLevels.getState()).toMatchObject({ currentLevel: 2, completed: [1] });
      expect(useLevels.getState().completeLevelOnce('completion-1', 1)).toBe(false);
    });
  });

  test('a failed ledger write does not mark the effect before a successful retry', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      const { useLevels } = require('../store');
      const original = storage.set.bind(storage);
      storage.set = (key: string, value: string) => {
        if (key === KEYS.levelsRewardLedger) throw new Error('ledger write failed');
        return original(key, value);
      };
      expect(() => useLevels.getState().completeLevelOnce('completion-1', 1)).toThrow('ledger write failed');
      expect(useLevels.getState()).toMatchObject({ currentLevel: 1, completed: [] });
      expect(JSON.parse(storage.getString(KEYS.levelsProgress))).toMatchObject({ currentLevel: 2, completed: [1] });
      storage.set = original;
      expect(useLevels.getState().completeLevelOnce('completion-1', 1)).toBe(true);
      expect(useLevels.getState()).toMatchObject({ currentLevel: 2, completed: [1] });
      expect(JSON.parse(storage.getString(KEYS.levelsRewardLedger))).toHaveProperty('completion-1');
    });
  });

  test('a failed reset keeps the last completed level in memory and storage', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      const { useLevels } = require('../store');
      useLevels.getState().completeLevel(1);
      const original = storage.set.bind(storage);
      storage.set = (key: string, value: string) => {
        if (key === KEYS.levelsProgress) throw new Error('reset write failed');
        return original(key, value);
      };
      expect(() => useLevels.getState().reset()).toThrow('reset write failed');
      expect(useLevels.getState()).toMatchObject({ currentLevel: 2, completed: [1] });
      expect(JSON.parse(storage.getString(KEYS.levelsProgress))).toMatchObject({ currentLevel: 2, completed: [1] });
      storage.set = original;
    });
  });

  test('recovers a damaged primary progress value from a validated backup', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      storage.set(KEYS.levelsProgress, '{broken');
      storage.set(KEYS.levelsProgressBackup, JSON.stringify({
        world: 'world1', currentLevel: 8, completed: [1, 2, 3, 4, 5, 6, 7],
      }));
      const { useLevels } = require('../store');
      expect(useLevels.getState()).toMatchObject({ currentLevel: 8, completed: [1, 2, 3, 4, 5, 6, 7] });
      expect(JSON.parse(storage.getString(KEYS.levelsProgress))).toMatchObject({ currentLevel: 8, completed: [1, 2, 3, 4, 5, 6, 7] });
    });
  });

  test('does not overwrite both unreadable progress values with an empty profile', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      jest.doMock('../loader', () => ({ DEFAULT_WORLD: 'world1' }));
      storage.set(KEYS.levelsProgress, '{broken');
      storage.set(KEYS.levelsProgressBackup, '{also broken');
      expect(() => require('../store')).toThrow('Levels progress is unreadable');
      expect(storage.getString(KEYS.levelsProgress)).toBe('{broken');
    });
  });
});
