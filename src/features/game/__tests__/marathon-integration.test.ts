/* eslint-disable @typescript-eslint/no-require-imports */
import type { Level } from '@/core/engine';

const level: Level = {
  id: 1, globalId: 1, world: 'world1', letters: ['к', 'о', 'т'], difficulty: 1,
  grid: { rows: 1, cols: 3, cells: [
    { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
  ] },
  answers: [{ word: 'кот', dir: 'H', cells: [
    { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
  ] }], bonusPool: [],
};

describe('marathon settlement and wallet integration', () => {
  beforeEach(() => jest.resetModules());

  test('a newcomer gets the first-stage coins on victory and result replay pays once', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { MARATHON } = require('@/core/config/marathon');
      const { useCurrency } = require('@/features/currency');
      const { useGame } = require('../store');
      const { useMarathon } = require('@/features/marathon');
      const { getSavedPuzzleRewards, settlePuzzleCompletion } = require('../settlement');
      useGame.getState().start(level, 'normal');
      useGame.getState().submit('кот');
      const snapshot = JSON.parse(JSON.stringify(useGame.getState().snapshot));
      snapshot.completion.completedAt = new Date(MARATHON.startAtMs).toISOString();
      const result = settlePuzzleCompletion(level, 'normal', snapshot, true);
      expect(result.effects).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'marathon', amount: 10 }),
      ]));
      expect(Object.keys(useMarathon.getState().completions)).toEqual(['campaign:1']);
      const after = useCurrency.getState().coins;
      useGame.getState().markRewardClaimed();
      expect(getSavedPuzzleRewards('campaign', '1')).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'marathon', amount: 10 }),
      ]));
      expect(getSavedPuzzleRewards('campaign', '2')).toEqual([]);
      expect(useCurrency.getState().coins).toBe(after);
      expect(settlePuzzleCompletion(level, 'normal', snapshot, true).firstCompletion).toBe(false);
      expect(useCurrency.getState().coins).toBe(after);
      expect(Object.keys(useMarathon.getState().completions)).toHaveLength(1);
    });
  });

  test('a marathon write failure after retention commit is recovered by retrying the same result', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { MARATHON } = require('@/core/config/marathon');
      const { useCurrency } = require('@/features/currency');
      const { useRetention } = require('@/features/retention');
      const { useGame } = require('../store');
      const { useMarathon, MARATHON_STORAGE_KEYS } = require('@/features/marathon');
      const { settlePuzzleCompletion } = require('../settlement');
      useGame.getState().start(level, 'normal');
      useGame.getState().submit('кот');
      const snapshot = JSON.parse(JSON.stringify(useGame.getState().snapshot));
      snapshot.completion.completedAt = new Date(MARATHON.startAtMs + 1).toISOString();
      const original = storage.set.bind(storage);
      const failing = jest.spyOn(storage, 'set').mockImplementation((...args: unknown[]) => {
        const [key, value] = args;
        if (key === MARATHON_STORAGE_KEYS.primary) throw new Error('marathon write failed');
        original(key, value);
      });
      expect(() => settlePuzzleCompletion(level, 'normal', snapshot, true)).toThrow('marathon write failed');
      failing.mockRestore();
      expect(useRetention.getState().campaignCompletions['1']).toBe(MARATHON.startDay);
      expect(Object.keys(useMarathon.getState().completions)).toHaveLength(0);
      const retry = settlePuzzleCompletion(level, 'normal', snapshot, true);
      expect(retry.firstCompletion).toBe(false);
      expect(retry.effects).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: 'marathon', amount: 10 }),
      ]));
      const after = useCurrency.getState().coins;
      settlePuzzleCompletion(level, 'normal', snapshot, true);
      expect(useCurrency.getState().coins).toBe(after);
    });
  });

  test('a wallet rejection leaves the durable marathon reward pending for a later retry', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { MARATHON } = require('@/core/config/marathon');
      const { useCurrency } = require('@/features/currency');
      const { recordMarathonCompletion, reconcileMarathonRewards, useMarathon } = require('@/features/marathon');
      const { applyMarathonCoinsOnce } = require('../marathonRewards');
      const result = recordMarathonCompletion({ mode: 'campaign', puzzleKey: '1', actionDay: MARATHON.startDay,
        completedAtMs: MARATHON.startAtMs }, { campaignCompletions: { '1': MARATHON.startDay }, dailyCompletions: {} });
      const rewardId = result.effects[0].id;
      const originalAdd = useCurrency.getState().addOnce;
      useCurrency.setState({ addOnce: () => false });
      expect(() => reconcileMarathonRewards(applyMarathonCoinsOnce)).toThrow('has not reached the wallet');
      expect(useMarathon.getState().pendingCoinGrants[rewardId]).toBe(10);
      useCurrency.setState({ addOnce: originalAdd });
      reconcileMarathonRewards(applyMarathonCoinsOnce);
      expect(useCurrency.getState().hasApplied(rewardId)).toBe(true);
      expect(useMarathon.getState().pendingCoinGrants).toEqual({});
    });
  });
});
