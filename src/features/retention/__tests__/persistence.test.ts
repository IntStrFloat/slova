/* eslint-disable @typescript-eslint/no-require-imports */

const day = '2026-09-26';
const completedAtMs = Date.parse('2026-09-26T12:00:00+03:00');

describe('retention and wallet persistence', () => {
  beforeEach(() => jest.resetModules());

  test('new profile gets 60 wallet coins and one durable 100-coin hint budget', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      const { useRetention } = require('../index');
      expect(useCurrency.getState().coins).toBe(60);
      expect(useRetention.getState().tickets).toBe(0);
      expect(JSON.parse(storage.getString(KEYS.currency)).newProfile).toBe(true);
      expect(useRetention.getState().pendingCoinGrants['starter:hint-coins']).toBe(100);
      expect(useRetention.getState().reconcileRewards((id: string, amount: number) =>
        useCurrency.getState().addOnce(id, 'coins', amount))).toBe(1);
      expect(useCurrency.getState().coins).toBe(160);
      expect(useRetention.getState().reconcileRewards((id: string, amount: number) =>
        useCurrency.getState().addOnce(id, 'coins', amount))).toBe(0);
      expect(useCurrency.getState().coins).toBe(160);
    });
  });

  test('unspent legacy tickets convert to coins once through the durable outbox', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      storage.set(KEYS.currency, JSON.stringify({ coins: 20, gems: 0 }));
      const { makeInitialSnapshot } = require('../model');
      const old = makeInitialSnapshot({ newProfile: false });
      old.tickets = 2;
      old.rewardGrants['starter:tickets'] = { id: 'starter:tickets', kind: 'ticket', amount: 2, source: 'starter' };
      old.ticketSpendIds['old-spend'] = 1;
      old.eventInstances.legacy = {
        id: 'legacy', startDay: day, endDay: '2026-09-27', points: 0,
        tiers: [{ points: 8, kind: 'ticket', amount: 1, claimed: false }],
      };
      storage.set(KEYS.retention, JSON.stringify(old));
      const { useRetention } = require('../index');
      const { useCurrency } = require('@/features/currency');
      expect(useRetention.getState().tickets).toBe(0);
      expect(useRetention.getState().ticketSpendIds['old-spend']).toBe(1);
      expect(useRetention.getState().eventInstances.legacy.tiers[0]).toMatchObject({ kind: 'coins', amount: 50 });
      expect(useRetention.getState().pendingCoinGrants['legacy-ticket-conversion:v1']).toBe(100);
      expect(() => useRetention.getState().reconcileRewards((id: string, amount: number) => {
        useCurrency.getState().addOnce(id, 'coins', amount);
        throw new Error('crash after wallet commit');
      })).toThrow('crash after wallet commit');
      expect(useCurrency.getState().coins).toBe(120);
      expect(useRetention.getState().reconcileRewards((id: string, amount: number) =>
        useCurrency.getState().addOnce(id, 'coins', amount))).toBe(1);
      expect(useCurrency.getState().coins).toBe(120);
    });
  });

  test('legacy wallet, progress, and old grant ledger migrate without starter resources', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      storage.set(KEYS.currency, JSON.stringify({ coins: 123, gems: 7 }));
      storage.set(KEYS.currencyRewardLedger, JSON.stringify({ 'old-effect': 1 }));
      storage.set(KEYS.levelsProgress, JSON.stringify({ completed: [1, 2, 3], currentLevel: 4 }));
      const { useCurrency } = require('@/features/currency');
      const { useRetention } = require('../index');
      expect(useCurrency.getState().coins).toBe(123);
      expect(useCurrency.getState().gems).toBe(7);
      expect(useCurrency.getState().newProfile).toBe(false);
      expect(useCurrency.getState().addOnce('old-effect', 'coins', 5)).toBe(false);
      expect(useRetention.getState().tickets).toBe(0);
      expect(useRetention.getState().journeyBaselineCompleted).toBe(3);
      expect(useRetention.getState().recordCompletion({
        mode: 'campaign', puzzleKey: '2', actionDay: day, completedAtMs,
      }).accepted).toBe(false);
    });
  });

  test('already solved daily dates migrate from the version-two daily store', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      storage.set(KEYS.currency, JSON.stringify({ coins: 123, gems: 0 }));
      storage.set(KEYS.dailyPuzzle, JSON.stringify({
        schemaVersion: 2,
        solvedDates: ['2026-09-23', '2026-09-24', '2026-09-25'],
        instances: {},
      }));
      const { useRetention, getDailyCollectionStatus } = require('../index');
      expect(getDailyCollectionStatus(useRetention.getState()).completedDays).toBe(3);
      expect(useRetention.getState().ownedCollectibles['daily-1-1']).toBeDefined();
      expect(useRetention.getState().recordCompletion({
        mode: 'daily', puzzleKey: '2026-09-24', actionDay: day,
        completedAtMs,
      }).accepted).toBe(false);
    });
  });

  test('daily coin outbox survives a crash while campaign wins add no coins', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      const { useRetention } = require('../index');
      useRetention.getState().reconcileRewards((id: string, amount: number) =>
        useCurrency.getState().addOnce(id, 'coins', amount));
      const retention = useRetention.getState();
      for (let level = 1; level <= 5; level++) {
        const campaign = retention.recordCompletion({
          mode: 'campaign', puzzleKey: String(level), actionDay: day, completedAtMs,
        });
        expect(campaign.effects.some((grant: { source: string }) => grant.source === 'campaign')).toBe(false);
      }
      expect(useCurrency.getState().coins).toBe(160);
      const first = retention.recordCompletion({ mode: 'daily', puzzleKey: day, actionDay: day, completedAtMs });
      expect(first.effects.find((grant: { id: string }) => grant.id === `daily:${day}:complete`)).toBeDefined();
      expect(useRetention.getState().pendingCoinGrants[`daily:${day}:complete`]).toBe(10);

      // Simulate a process death immediately after wallet commit, before outbox ack.
      expect(() => useRetention.getState().reconcileRewards((id: string, amount: number) => {
        useCurrency.getState().addOnce(id, 'coins', amount);
        throw new Error('killed');
      })).toThrow('killed');
      expect(useCurrency.getState().coins).toBe(170);
      expect(useRetention.getState().pendingCoinGrants[`daily:${day}:complete`]).toBe(10);
      expect(useRetention.getState().reconcileRewards((id: string, amount: number) =>
        useCurrency.getState().addOnce(id, 'coins', amount))).toBe(1);
      expect(useCurrency.getState().coins).toBe(170);
      expect(useRetention.getState().pendingCoinGrants[`daily:${day}:complete`]).toBeUndefined();
      expect(retention.recordCompletion({ mode: 'daily', puzzleKey: day, actionDay: day, completedAtMs }).accepted).toBe(false);
      expect(retention.recordCompletion({ mode: 'daily', puzzleKey: day, actionDay: day, completedAtMs }).effects.map((effect: { id: string }) => effect.id)).toEqual([`daily:${day}:complete`]);
      expect(useCurrency.getState().coins).toBe(170);
    });
  });

  test('persisted puzzle effect IDs replay a word quest on the completion result', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      storage.set(KEYS.currency, JSON.stringify({ coins: 100, gems: 0 }));
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world1', currentLevel: 9, completed: [1, 2, 3, 4, 5, 6, 7, 8] }));
      const { useRetention } = require('../index');
      const { useCurrency } = require('@/features/currency');
      const words = ['ааа', 'ааб', 'аав', 'ааг', 'аад', 'аае', 'ааж', 'ааз', 'ааи', 'аай'];
      for (const word of words) {
        useRetention.getState().recordWord({
          mode: 'campaign', puzzleKey: '9', word, actionDay: day, bonus: false, manual: true,
        });
      }
      const first = useRetention.getState().recordCompletion({
        mode: 'campaign', puzzleKey: '9', actionDay: day, completedAtMs,
      });
      expect(first.effects.map((effect: { id: string }) => effect.id)).toEqual([
        'quest:2026-09-26:words',
      ]);
      useRetention.getState().reconcileRewards((id: string, amount: number) =>
        useCurrency.getState().addOnce(id, 'coins', amount));
      expect(useCurrency.getState().coins).toBe(105);
      const saved = JSON.parse(storage.getString(KEYS.retention));
      expect(saved.completionEffectIds['campaign:9']).toEqual(first.effects.map((effect: { id: string }) => effect.id));
      expect(saved.pendingCoinGrants).toEqual({});
      useRetention.setState(saved);
      const replay = useRetention.getState().recordCompletion({
        mode: 'campaign', puzzleKey: '9', actionDay: day, completedAtMs,
      });
      expect(replay.accepted).toBe(false);
      expect(replay.effects).toEqual(first.effects);
      expect(useCurrency.getState().coins).toBe(105);
    });
  });

  test('pre-index v1 save migrates a completion-earned quest without a second payout', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { makeInitialSnapshot, ensureDay, reduceCompletion } = require('../model');
      let old = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5, 6, 7, 8] });
      old = ensureDay(old, { actionDay: day, remainingNewPuzzles: 3, availableManualWords: 10, availableBonusWords: 2 });
      for (const puzzleKey of ['9', '10', '11']) {
        old = reduceCompletion(old, { mode: 'campaign', puzzleKey, actionDay: day, completedAtMs }).snapshot;
      }
      // A real pre-change save may still contain earned completion grants.
      old.rewardGrants = {
        ...Object.fromEntries(['9', '10', '11'].map((key) => [
          `campaign:${key}:complete`, { id: `campaign:${key}:complete`, kind: 'coins', amount: 5, source: 'campaign' },
        ])),
        ...old.rewardGrants,
      };
      for (const key of ['9', '10', '11']) old.pendingCoinGrants[`campaign:${key}:complete`] = 5;
      delete old.puzzleEffectIds;
      delete old.completionEffectIds;
      storage.set(KEYS.retention, JSON.stringify(old));
      const { useRetention } = require('../index');
      const persisted = JSON.parse(storage.getString(KEYS.retention));
      expect(persisted.completionEffectIds['campaign:11']).toEqual([
        'campaign:11:complete', 'quest:2026-09-26:solver',
      ]);
      const replay = useRetention.getState().recordCompletion({
        mode: 'campaign', puzzleKey: '11', actionDay: day, completedAtMs,
      });
      expect(replay.accepted).toBe(false);
      expect(replay.effects.map((effect: { id: string }) => effect.id)).toEqual(persisted.completionEffectIds['campaign:11']);
      expect(useRetention.getState().pendingCoinGrants['campaign:11:complete']).toBe(5);
      expect(useRetention.getState().pendingCoinGrants['quest:2026-09-26:solver']).toBe(5);
    });
  });

  test('coin hint debit IDs are durable and distinguish duplicate from insufficient', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      expect(useCurrency.getState().spendOnce('hint:2:cell-b', 'coins', 50)).toBe('spent');
      expect(useCurrency.getState().spendOnce('hint:2:cell-b', 'coins', 50)).toBe('already_spent');
      expect(useCurrency.getState().hasApplied('hint:2:cell-b')).toBe(true);
      expect(useCurrency.getState().spendOnce('hint:3:cell-c', 'coins', 50)).toBe('insufficient');
      expect(useCurrency.getState().coins).toBe(10);
    });
  });

  test('collectible seen state changes only for an owned card', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { useRetention, getUnreadCollectibleCount } = require('../index');
      expect(useRetention.getState().markCollectibleSeen('journey-1-1')).toBe(false);
      for (let id = 1; id <= 5; id++) {
        useRetention.getState().recordCompletion({
          mode: 'campaign', puzzleKey: String(id), actionDay: day, completedAtMs,
        });
      }
      expect(getUnreadCollectibleCount(useRetention.getState())).toBe(1);
      expect(useRetention.getState().markCollectibleSeen('journey-1-1')).toBe(true);
      expect(useRetention.getState().markCollectibleSeen('journey-1-1')).toBe(false);
      expect(getUnreadCollectibleCount(useRetention.getState())).toBe(0);
    });
  });

  test('failed writes leave both wallet and retention state unconfirmed', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      const { useRetention } = require('../index');
      const write = storage.set.bind(storage);
      storage.set = (key: string, value: string) => {
        if (key === KEYS.currency || key === 'retention.v1') throw new Error('storage full');
        return write(key, value);
      };
      expect(() => useCurrency.getState().addOnce('grant', 'coins', 5)).toThrow('storage full');
      expect(useCurrency.getState().coins).toBe(60);
      expect(useCurrency.getState().hasApplied('grant')).toBe(false);
      expect(() => useRetention.getState().recordCompletion({
        mode: 'campaign', puzzleKey: '1', actionDay: day, completedAtMs,
      })).toThrow('storage full');
      expect(useRetention.getState().campaignCompletions['1']).toBeUndefined();
      expect(useRetention.getState().pendingCoinGrants['campaign:1:complete']).toBeUndefined();
      storage.set = write;
    });
  });

  test('unreadable wallet is preserved rather than replaced with a new grant', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      storage.set(KEYS.currency, '{broken');
      expect(() => require('@/features/currency')).toThrow('Wallet save is unreadable');
      expect(storage.getString(KEYS.currency)).toBe('{broken');
    });
  });
});
