/* eslint-disable @typescript-eslint/no-require-imports */
import type { Level } from '@/core/engine/types';

const cells = [
  { row: 0, col: 0, ch: 'к' },
  { row: 0, col: 1, ch: 'о' },
  { row: 0, col: 2, ch: 'т' },
];
const level: Level = {
  id: 9,
  globalId: 9,
  world: 'world1',
  letters: ['к', 'о', 'т', 'л'],
  difficulty: 1,
  grid: { rows: 1, cols: 3, cells },
  answers: [{ word: 'кот', dir: 'H', cells }],
  bonusPool: ['кол', 'лот'],
  acceptedBonus: ['кол', 'лот'],
  rewardedBonus: ['кол'],
};
const oldDay = '2026-09-25';

/** These are restored runs, so their 60-coin wallet already exists. */
function seedExistingWallet(): void {
  const { storage, KEYS } = require('@/core/storage');
  storage.set(KEYS.currency, JSON.stringify({ coins: 60, gems: 0 }));
}

function savedRun(
  mode: 'normal' | 'daily',
  wordDates: Record<string, string>,
  solvedWords = ['кот'],
  foundBonus = ['кол', 'лот'],
) {
  const { initPlayState } = require('@/core/engine/types');
  const { serializeGame } = require('../persistence');
  const play = {
    ...initPlayState(level),
    filled: solvedWords.includes('кот') ? { '0,0': 'к', '0,1': 'о', '0,2': 'т' } : {},
    solvedWords,
    foundBonus,
  };
  return serializeGame(
    level, play, level.letters, mode, { status: 'playing' }, null, [],
    mode === 'daily' ? oldDay : undefined, wordDates,
  );
}

describe('accepted word reward replay after restore', () => {
  beforeEach(() => jest.resetModules());

  test('replays only verified manual words, keeps bonus eligibility and stays idempotent', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      seedExistingWallet();
      const snapshot = savedRun('normal', {
        'grid:кот': oldDay,
        'bonus:кол': oldDay,
        'bonus:лот': oldDay,
        'grid:ток': oldDay, // not solved in this saved grid
        'bonus:сон': oldDay, // not found or accepted by this level
      });
      const { reconcileAcceptedWords } = require('../bonusReplay');
      const { useRetention } = require('@/features/retention');
      const { useCurrency } = require('@/features/currency');
      const first = reconcileAcceptedWords(level, 'normal', snapshot);
      expect(first).toEqual({ recordedWords: 3, reconciledCoinGrants: 1 });
      expect(useRetention.getState().bonusBankUnits).toBe(1);
      expect(useRetention.getState().manualWordKeys).toMatchObject({
        'campaign:9:кот': 1, 'campaign:9:кол': 1, 'campaign:9:лот': 1,
      });
      expect(useRetention.getState().bonusWordKeys['campaign:9:кол']).toBe(1);
      expect(useRetention.getState().bonusWordKeys['campaign:9:лот']).toBeUndefined();
      expect(useCurrency.getState().coins).toBe(61);
      expect(reconcileAcceptedWords(level, 'normal', snapshot)).toEqual({ recordedWords: 0, reconciledCoinGrants: 0 });
      expect(useCurrency.getState().coins).toBe(61);
    });
  });

  test('never credits a system-revealed word without a manual word date', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      seedExistingWallet();
      const snapshot = savedRun('normal', {}, ['кот'], []);
      snapshot.hintsUsed = ['bulb'];
      const { reconcileAcceptedWords } = require('../bonusReplay');
      const { useRetention } = require('@/features/retention');
      expect(reconcileAcceptedWords(level, 'normal', snapshot)).toEqual({ recordedWords: 0, reconciledCoinGrants: 0 });
      expect(useRetention.getState().manualWordKeys).toEqual({});
    });
  });

  test('keeps the original product date when a saved word closes a daily quest', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      seedExistingWallet();
      storage.set(KEYS.currency, JSON.stringify({ coins: 100, gems: 0 }));
      storage.set(KEYS.levelsProgress, JSON.stringify({
        world: 'world1', currentLevel: 9, completed: [1, 2, 3, 4, 5, 6, 7, 8],
      }));
      const { useRetention, makeInitialSnapshot, ensureDay } = require('@/features/retention');
      const pinned = ensureDay(makeInitialSnapshot({
        newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5, 6, 7, 8],
      }), {
        actionDay: oldDay, remainingNewPuzzles: 3, availableManualWords: 10, availableBonusWords: 2,
      });
      pinned.questInstances[oldDay].quests.find((quest: { id: string }) => quest.id === 'words').progress = 9;
      useRetention.setState(pinned);
      const snapshot = savedRun('normal', { 'grid:кот': oldDay }, ['кот'], []);
      const { reconcileAcceptedWords } = require('../bonusReplay');
      expect(reconcileAcceptedWords(level, 'normal', snapshot).recordedWords).toBe(1);
      expect(useRetention.getState().rewardGrants[`quest:${oldDay}:words`]?.amount).toBe(5);
      expect(useRetention.getState().rewardGrants['quest:2026-09-26:words']).toBeUndefined();
    });
  });

  test('daily words use their pinned puzzle date but their saved action day', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      seedExistingWallet();
      const snapshot = savedRun('daily', { 'bonus:кол': '2026-09-26' }, [], ['кол']);
      const { reconcileAcceptedWords } = require('../bonusReplay');
      const { useRetention } = require('@/features/retention');
      expect(reconcileAcceptedWords(level, 'daily', snapshot).recordedWords).toBe(1);
      expect(useRetention.getState().bonusWordKeys[`daily:${oldDay}:кол`]).toBe(1);
    });
  });

  test('rejects malformed daily identity and action dates without inventing today', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      seedExistingWallet();
      const snapshot = savedRun('daily', { 'bonus:кол': '2026-02-31' }, [], ['кол']);
      const { reconcileAcceptedWords } = require('../bonusReplay');
      const { useRetention } = require('@/features/retention');
      expect(reconcileAcceptedWords(level, 'daily', snapshot).recordedWords).toBe(0);
      expect(useRetention.getState().bonusWordKeys).toEqual({});
      snapshot.dailyId = '2026-02-31';
      expect(reconcileAcceptedWords(level, 'daily', snapshot).recordedWords).toBe(0);
      expect(useRetention.getState().bonusWordKeys).toEqual({});
    });
  });

  test('a failed retention write can replay the same saved word after restart', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      seedExistingWallet();
      const snapshot = savedRun('normal', { 'bonus:кол': oldDay }, [], ['кол']);
      const { reconcileAcceptedWords } = require('../bonusReplay');
      const { useRetention } = require('@/features/retention');
      const { useCurrency } = require('@/features/currency');
      const original = storage.set.bind(storage);
      storage.set = (key: string, value: string) => {
        if (key === KEYS.retention) throw new Error('retention write failed');
        return original(key, value);
      };
      expect(() => reconcileAcceptedWords(level, 'normal', snapshot)).toThrow('retention write failed');
      expect(useRetention.getState().bonusWordKeys['campaign:9:кол']).toBeUndefined();
      storage.set = original;
      expect(reconcileAcceptedWords(level, 'normal', snapshot)).toEqual({ recordedWords: 1, reconciledCoinGrants: 1 });
      expect(useCurrency.getState().coins).toBe(61);
    });
  });

  test('a process interruption between saved words resumes without replaying the first reward', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      seedExistingWallet();
      const snapshot = savedRun('normal', { 'bonus:кол': oldDay, 'bonus:лот': oldDay }, [], ['кол', 'лот']);
      const { reconcileAcceptedWords } = require('../bonusReplay');
      const { useRetention } = require('@/features/retention');
      const { useCurrency } = require('@/features/currency');
      const original = storage.set.bind(storage);
      let retentionWrites = 0;
      storage.set = (key: string, value: string) => {
        if (key === KEYS.retention && ++retentionWrites === 2) throw new Error('process interrupted');
        return original(key, value);
      };
      expect(() => reconcileAcceptedWords(level, 'normal', snapshot)).toThrow('process interrupted');
      expect(useRetention.getState().bonusWordKeys['campaign:9:кол']).toBe(1);
      expect(useRetention.getState().manualWordKeys['campaign:9:лот']).toBeUndefined();
      storage.set = original;
      expect(reconcileAcceptedWords(level, 'normal', snapshot)).toEqual({ recordedWords: 1, reconciledCoinGrants: 1 });
      expect(useRetention.getState().manualWordKeys['campaign:9:лот']).toBe(1);
      expect(useRetention.getState().bonusBankUnits).toBe(1);
      expect(useCurrency.getState().coins).toBe(61);
    });
  });

  test('wallet failure leaves the committed bonus outbox for idempotent retry', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      seedExistingWallet();
      const snapshot = savedRun('normal', { 'bonus:кол': oldDay }, [], ['кол']);
      const { reconcileAcceptedWords } = require('../bonusReplay');
      const { useRetention } = require('@/features/retention');
      const { useCurrency } = require('@/features/currency');
      const original = storage.set.bind(storage);
      storage.set = (key: string, value: string) => {
        if (key === KEYS.currency) throw new Error('wallet write failed');
        return original(key, value);
      };
      expect(() => reconcileAcceptedWords(level, 'normal', snapshot)).toThrow('wallet write failed');
      expect(useRetention.getState().bonusWordKeys['campaign:9:кол']).toBe(1);
      expect(useRetention.getState().pendingCoinGrants['bonus:campaign:9:кол']).toBe(1);
      storage.set = original;
      expect(reconcileAcceptedWords(level, 'normal', snapshot)).toEqual({ recordedWords: 0, reconciledCoinGrants: 1 });
      expect(useCurrency.getState().coins).toBe(61);
    });
  });
});
