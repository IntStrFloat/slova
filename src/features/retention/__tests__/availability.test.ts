/* eslint-disable @typescript-eslint/no-require-imports */

describe('verified daily quest content', () => {
  beforeEach(() => jest.resetModules());

  test('real campaign content without rewardable bonuses pins the word alternative', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const today = require('@/core/time').dayKey();
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world1', currentLevel: 5, completed: [1, 2, 3, 4] }));
      storage.set(KEYS.dailyPuzzle, JSON.stringify({ schemaVersion: 2, maxSeenDay: today, solvedDates: [today], instances: {} }));
      const { makeInitialSnapshot, ensureDay } = require('../model');
      const { getVerifiedQuestAvailability } = require('../availability');
      const snapshot = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [100, 101, 102, 103, 104, 105, 106, 107] });
      const verified = getVerifiedQuestAvailability(snapshot, today);
      expect(verified.remainingNewPuzzles).toBe(4);
      expect(verified.availableManualWords).toBeGreaterThanOrEqual(10);
      expect(verified.availableBonusWords).toBe(0);
      const instance = ensureDay(snapshot, verified).questInstances[today];
      expect(instance.quests.find((quest: { id: string }) => quest.id === 'bonus')).toMatchObject({
        kind: 'manualWords', target: 5, rewardCoins: 5,
      });
      expect(instance.contentProof).toEqual(verified.contentProof);
    });
  });

  test('a shortened nine-word opening cannot pin an impossible ten-word quest', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const today = require('@/core/time').dayKey();
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world1', currentLevel: 1, completed: [] }));
      storage.set(KEYS.dailyPuzzle, JSON.stringify({ schemaVersion: 2, maxSeenDay: today, solvedDates: [today], instances: {} }));
      const { makeInitialSnapshot, ensureDay } = require('../model');
      const { getVerifiedQuestAvailability } = require('../availability');
      const snapshot = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [100, 101, 102, 103, 104, 105, 106, 107] });
      const verified = getVerifiedQuestAvailability(snapshot, today);
      expect(verified.remainingNewPuzzles).toBe(4);
      expect(verified.availableManualWords).toBe(9);
      expect(ensureDay(snapshot, verified).questInstances[today]).toBeUndefined();
    });
  });

  test('exhausted released puzzles do not pin an impossible solver or word goal', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const today = require('@/core/time').dayKey();
      const completed = Array.from({ length: 1500 }, (_, index) => index + 1);
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world21', currentLevel: 1501, completed }));
      const { makeInitialSnapshot, ensureDay } = require('../model');
      const { getVerifiedQuestAvailability } = require('../availability');
      const snapshot = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: completed });
      const verified = getVerifiedQuestAvailability(snapshot, today);
      expect(verified.remainingNewPuzzles).toBeLessThanOrEqual(1);
      expect(verified.availableManualWords).toBeLessThan(10);
      expect(ensureDay(snapshot, verified).questInstances[today]).toBeUndefined();
    });
  });

  test('a former 1000-level finisher can pin reachable quests from the third route', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const today = require('@/core/time').dayKey();
      const completed = Array.from({ length: 1000 }, (_, index) => index + 1);
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world14', currentLevel: 1001, completed }));
      storage.set(KEYS.dailyPuzzle, JSON.stringify({ schemaVersion: 2, maxSeenDay: today, solvedDates: [today], instances: {} }));
      const { makeInitialSnapshot, ensureDay } = require('../model');
      const { getVerifiedQuestAvailability } = require('../availability');
      const snapshot = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: completed });
      const verified = getVerifiedQuestAvailability(snapshot, today);

      expect(verified.remainingNewPuzzles).toBe(4);
      expect(verified.availableManualWords).toBeGreaterThanOrEqual(16);
      expect(verified.contentProof.map((proof: { puzzleKey: string }) => proof.puzzleKey))
        .toEqual(['campaign:1001', 'campaign:1002', 'campaign:1003', 'campaign:1004']);
      expect(ensureDay(snapshot, verified).questInstances[today]?.contentProof).toEqual(verified.contentProof);
    });
  });

  test('already found words in the saved active grid are excluded from the promise', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const today = require('@/core/time').dayKey();
      const completed = Array.from({ length: 9 }, (_, index) => index + 1);
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world1', currentLevel: 10, completed }));
      storage.set(KEYS.dailyPuzzle, JSON.stringify({ schemaVersion: 2, maxSeenDay: today, solvedDates: [today], instances: {} }));
      const { loadGlobalLevel } = require('@/features/levels/loader');
      const { makeInitialSnapshot } = require('../model');
      const { getVerifiedQuestAvailability } = require('../availability');
      const state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: completed });
      const before = getVerifiedQuestAvailability(state, today);
      const level = loadGlobalLevel(10);
      const foundBonus = level.rewardedBonus[0];
      storage.set(KEYS.gameCurrentNormal, JSON.stringify({
        version: 2, mode: 'normal', globalLevel: 10, levelFingerprint: level.fingerprint,
        completion: { status: 'playing' }, disk: level.letters,
        solvedWords: [level.answers[0].word], foundBonus: [foundBonus],
      }));
      const after = getVerifiedQuestAvailability(state, today);
      expect(after.availableManualWords).toBe(before.availableManualWords - 2);
      expect(after.availableBonusWords).toBe(before.availableBonusWords - 1);
      expect(after.contentProof).toEqual(before.contentProof);
    });
  });

  test('removed pinned content is compensated once, while progress and grants stay durable', () => {
    jest.isolateModules(() => {
      const { storage, KEYS } = require('@/core/storage');
      storage.clearAll();
      const today = require('@/core/time').dayKey();
      const completed = Array.from({ length: 8 }, (_, index) => index + 1);
      storage.set(KEYS.levelsProgress, JSON.stringify({ world: 'world1', currentLevel: 9, completed }));
      storage.set(KEYS.dailyPuzzle, JSON.stringify({ schemaVersion: 2, maxSeenDay: today, solvedDates: [today], instances: {} }));
      const { useLevels } = require('@/features/levels/store');
      const { getVerifiedQuestAvailability } = require('../availability');
      const { useRetention } = require('../index');
      const first = getVerifiedQuestAvailability(useRetention.getState(), today);
      expect(first.remainingNewPuzzles).toBe(4);
      expect(first.availableManualWords).toBeGreaterThanOrEqual(10);
      useRetention.getState().ensureDay(first);
      expect(useRetention.getState().questInstances[today]?.contentProof?.length).toBe(4);

      // Simulate a published-content correction that makes the pinned route
      // unreachable before the player can finish today's quest.
      useLevels.setState({ currentLevel: 1501 });
      useRetention.getState().ensureDay({ actionDay: today });
      const after = useRetention.getState();
      expect(after.questInstances[today].quests.every((quest: { completed: boolean }) => quest.completed)).toBe(true);
      expect(after.questInstances[today].claimedAll).toBe(true);
      expect(Object.keys(after.pendingCoinGrants).filter((id) => id.startsWith(`quest:${today}:`))).toHaveLength(4);
      const { useCurrency } = require('@/features/currency');
      const { reconcileRewards } = require('../index');
      expect(reconcileRewards((id: string, amount: number) =>
        useCurrency.getState().addOnce(id, 'coins', amount))).toBe(4);
      expect(useCurrency.getState().coins).toBe(25);
      const saved = storage.getString(KEYS.retention);
      useRetention.getState().ensureDay({ actionDay: today });
      expect(storage.getString(KEYS.retention)).toBe(saved);
      expect(useCurrency.getState().coins).toBe(25);
    });
  });
});
