/* eslint-disable @typescript-eslint/no-require-imports */

describe('progression milestone rewards', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('uses deterministic rewards for milestone, world finale, and campaign finale chests', () => {
    jest.isolateModules(() => {
      const {
        isMilestoneLevel,
        milestoneRewardForLevel,
        giftProgress,
      } = require('../store');

      expect(isMilestoneLevel(10)).toBe(true);
      expect(isMilestoneLevel(35)).toBe(false);
      expect(milestoneRewardForLevel(20)).toBe(50);
      expect(milestoneRewardForLevel(90)).toBe(75);
      expect(milestoneRewardForLevel(500)).toBe(150);
      expect(milestoneRewardForLevel(510)).toBe(50);
      expect(milestoneRewardForLevel(590)).toBe(75);
      expect(milestoneRewardForLevel(1000)).toBe(150);
      expect(isMilestoneLevel(1010)).toBe(false);
      expect(giftProgress(0)).toMatchObject({ nextGiftLevel: 10, remaining: 10, amount: 50, fraction: 0 });
      expect(giftProgress(9)).toMatchObject({ nextGiftLevel: 10, remaining: 1, amount: 50, fraction: 0.9 });
      expect(giftProgress(10)).toMatchObject({ nextGiftLevel: 20, remaining: 10, amount: 50, fraction: 0 });
      expect(giftProgress(89)).toMatchObject({ nextGiftLevel: 90, remaining: 1, amount: 75 });
      expect(giftProgress(90)).toMatchObject({ nextGiftLevel: 100, remaining: 10, amount: 50 });
      expect(giftProgress(500)).toMatchObject({ nextGiftLevel: 510, remaining: 10, amount: 50 });
      expect(giftProgress(999)).toMatchObject({ nextGiftLevel: 1000, remaining: 1, amount: 150 });
      expect(giftProgress(1000)).toBeNull();
    });
  });

  test('keeps milestone claims idempotent across retries and later replays', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();

      const {
        claimMilestoneReward,
        nearestMilestoneLevel,
      } = require('../store');

      expect(claimMilestoneReward('completion-a', 20)).toBe(50);
      expect(claimMilestoneReward('completion-a', 20)).toBe(50);
      expect(claimMilestoneReward('completion-b', 20)).toBe(0);
      expect(claimMilestoneReward('completion-c', 21)).toBe(0);
      expect(nearestMilestoneLevel(21)).toBe(30);
      expect(nearestMilestoneLevel(31)).toBe(40);
      expect(nearestMilestoneLevel(501)).toBe(510);
      expect(nearestMilestoneLevel(991)).toBe(1000);
      expect(nearestMilestoneLevel(1001)).toBeNull();
    });
  });

  test('credits missed intro gifts once and respects the released wallet key', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { useCurrency } = require('@/features/currency');
      const { backfillCompletedChestCoins, useProgression } = require('../store');
      const before = useCurrency.getState().coins;

      expect(backfillCompletedChestCoins([5, 10, 10, 20])).toBe(100);
      expect(useCurrency.getState().coins).toBe(before + 100);
      expect(backfillCompletedChestCoins([10, 20])).toBe(0);
      expect(useCurrency.getState().coins).toBe(before + 100);
      expect(useCurrency.getState().hasApplied('legacy:campaign:10:milestone')).toBe(true);
      expect(useProgression.getState().claimedLevelRewards).toMatchObject({ 10: 50, 20: 50 });
    });
  });

  test('sanitizes broken persisted milestone payloads on restore', () => {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      storage.set(
        'progression.milestones.v1',
        JSON.stringify({
          claimAmountsByKey: {
            ok: 40,
            bad: 'x',
          },
          claimedLevelRewards: {
            20: 40,
            25: 99,
            nope: 10,
          },
        }),
      );

      const { useProgression } = require('../store');
      expect(useProgression.getState().claimAmountsByKey).toEqual({ ok: 40 });
      expect(useProgression.getState().claimedLevelRewards).toEqual({ 20: 40 });
    });
  });
});
