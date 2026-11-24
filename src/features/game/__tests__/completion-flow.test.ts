/* eslint-disable @typescript-eslint/no-require-imports */
import type { Level } from '@/core/engine';

const level: Level = {
  id: 1,
  globalId: 1,
  world: 'world1',
  letters: ['к', 'о', 'т'],
  difficulty: 1,
  grid: { rows: 1, cols: 3, cells: [
    { row: 0, col: 0, ch: 'к' },
    { row: 0, col: 1, ch: 'о' },
    { row: 0, col: 2, ch: 'т' },
  ] },
  answers: [{ word: 'кот', dir: 'H', cells: [
    { row: 0, col: 0, ch: 'к' },
    { row: 0, col: 1, ch: 'о' },
    { row: 0, col: 2, ch: 'т' },
  ] }],
  bonusPool: ['ток'],
};

describe('completion settlement regression', () => {
  beforeEach(() => {
    jest.resetModules();
    // Base settlement assertions run before the calendar marathon starts.
    jest.useFakeTimers({ now: Date.parse('2026-10-25T12:00:00.000Z') });
  });
  afterEach(() => jest.useRealTimers());

  test('winning action pays before Next and replay cannot pay again', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();

      const { ECONOMY } = require('@/core/config/economy');
      const { useCurrency } = require('@/features/currency');
      const { useRetention } = require('@/features/retention');
      const { useLevels } = require('@/features/levels/store');
      const { useGame } = require('../store');
      const { loadGameSnapshot } = require('../persistence');
      const { settlePuzzleCompletion } = require('../settlement');
      useRetention.getState().reconcileRewards((id: string, amount: number) =>
        useCurrency.getState().addOnce(id, 'coins', amount));

      useGame.getState().start(level, 'normal');
      expect(useGame.getState().submit('кот').kind).toBe('grid');
      const winningSnapshot = useGame.getState().snapshot;
      expect(winningSnapshot?.completion.status).toBe('completion_pending');
      const beforeCoins = useCurrency.getState().coins;
      expect(beforeCoins).toBe(ECONOMY.starterCoins + ECONOMY.starterHintCoins);

      const first = settlePuzzleCompletion(level, 'normal', winningSnapshot!, true);
      expect(first.firstCompletion).toBe(true);
      expect(first.effects.some((effect: { source: string }) => effect.source === 'campaign')).toBe(false);
      expect(useCurrency.getState().coins).toBe(beforeCoins);
      expect(useLevels.getState().completed).toEqual([1]);
      expect(useLevels.getState().currentLevel).toBe(2);
      const firstBalance = useCurrency.getState().coins;

      const replay = settlePuzzleCompletion(level, 'normal', winningSnapshot!, true);
      expect(replay.firstCompletion).toBe(false);
      expect(useCurrency.getState().coins).toBe(firstBalance);
      expect(useLevels.getState().completed).toEqual([1]);

      useGame.getState().markRewardClaimed();
      expect(loadGameSnapshot()?.completion.status).toBe('reward_claimed');
      useGame.getState().finish();
      expect(loadGameSnapshot()).toBeNull();
    });
  });

  test('intro campaign player receives a 50-coin chest once at level 10', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      const { useGame } = require('../store');
      const { settlePuzzleCompletion } = require('../settlement');
      const chestLevel: Level = { ...level, id: 10, globalId: 10 };

      useGame.getState().start(chestLevel, 'normal');
      expect(useGame.getState().submit('кот').kind).toBe('grid');
      const snapshot = useGame.getState().snapshot!;
      const before = useCurrency.getState().coins;
      const first = settlePuzzleCompletion(chestLevel, 'normal', snapshot, true);
      expect(first.effects).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'legacy:campaign:10:milestone', amount: 50 }),
      ]));
      expect(useCurrency.getState().coins).toBeGreaterThanOrEqual(before + 50);
      const after = useCurrency.getState().coins;

      const replay = settlePuzzleCompletion(chestLevel, 'normal', snapshot, true);
      expect(replay.firstCompletion).toBe(false);
      expect(useCurrency.getState().coins).toBe(after);
    });
  });

  test('intro level 5 opens its first river postcard without preopening Eiffel', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { useCollection } = require('@/features/collection/store');
      const { useGame } = require('../store');
      const { settlePuzzleCompletion } = require('../settlement');
      const firstCardLevel: Level = { ...level, id: 5, globalId: 5 };

      useGame.getState().start(firstCardLevel, 'normal');
      expect(useGame.getState().submit('кот').kind).toBe('grid');
      settlePuzzleCompletion(firstCardLevel, 'normal', useGame.getState().snapshot!, true);
      expect(useCollection.getState().opened).toContain('paris-river-islands');
      expect(useCollection.getState().opened).not.toContain('eiffel');
    });
  });

  test('a failed daily-calendar write keeps the result pending until the date is saved', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      const { useDailyPuzzle } = require('@/features/dailypuzzle');
      const { useRetention } = require('@/features/retention');
      const { useGame } = require('../store');
      const { settlePuzzleCompletion } = require('../settlement');

      const day = useDailyPuzzle.getState().effectiveDay();
      useRetention.setState({ campaignCompletions: Object.fromEntries(
        [1, 2, 3, 4, 5].map((id) => [String(id), day]),
      ) });
      const instance = useDailyPuzzle.getState().getOrStartDaily()!;
      useGame.getState().start(instance.level, 'daily', instance.dateKey);
      for (const answer of instance.level.answers) useGame.getState().submit(answer.word);
      const winningSnapshot = useGame.getState().snapshot;
      expect(winningSnapshot?.completion.status).toBe('completion_pending');
      const beforeCoins = useCurrency.getState().coins;
      const originalSet = storage.set.bind(storage);
      const failing = jest.spyOn(storage, 'set').mockImplementation((...args: unknown[]) => {
        const [key, value] = args;
        if (key === KEYS.dailyPuzzle) throw new Error('daily MMKV failed');
        originalSet(key, value);
      });
      try {
        expect(() => settlePuzzleCompletion(instance.level, 'daily', winningSnapshot!, true)).toThrow('not durable');
      } finally {
        failing.mockRestore();
      }
      expect(useDailyPuzzle.getState().isDone(instance.dateKey)).toBe(false);
      expect(useGame.getState().completion.status).toBe('completion_pending');
      expect(useCurrency.getState().coins).toBe(beforeCoins);

      const retry = settlePuzzleCompletion(instance.level, 'daily', winningSnapshot!, true);
      expect(retry.firstCompletion).toBe(false);
      expect(retry.effects.some((effect: { id: string }) => effect.id === `daily:${instance.dateKey}:complete`)).toBe(true);
      expect(useDailyPuzzle.getState().isDone(instance.dateKey)).toBe(true);
      expect(useCurrency.getState().coins).toBeGreaterThanOrEqual(beforeCoins + 10);
      expect(useCurrency.getState().hasApplied(`daily:${instance.dateKey}:complete`)).toBe(true);
    });
  });
});
