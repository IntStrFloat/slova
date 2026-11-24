import {
  EMPTY_ADS_META,
  evaluateInterstitial,
  normalizeAdsMeta,
  recordCampaignLevelComplete,
  recordInterstitialShown,
  recordLevelComplete,
  recordRewardedShown,
  recordVisibleGameplay,
  seedCampaignCompletions,
  shouldShowInterstitial,
} from '../frequency';
import type { AdsState, InterstitialContext } from '../frequency';

const context: InterstitialContext = {
  enabled: true,
  removeAds: false,
  loaded: true,
  nowMs: 1_000_000,
  isFirstGameplaySession: false,
  campaignLevelId: 8,
  userContinued: true,
  rewardsCommitted: true,
  protectedTransition: false,
};

function afterOnboarding(): AdsState {
  return seedCampaignCompletions(EMPTY_ADS_META, [1, 2, 3, 4, 5]);
}

function threeShortLevels(): AdsState {
  let state = afterOnboarding();
  for (let level = 6; level <= 8; level++) {
    state = recordVisibleGameplay(recordCampaignLevelComplete(state, level), 10);
  }
  return state;
}

describe('interstitial frequency policy', () => {
  test('migrates legacy metadata without inventing completed campaign levels', () => {
    const old = { levelCompletes: 100, lastInterstitialAt: 900_000 };
    const state = normalizeAdsMeta(old);
    expect(state.campaignCompletedIds).toEqual([]);
    expect(state.interstitialShownAt).toEqual([900_000]);
    expect(evaluateInterstitial(state, context)).toEqual({
      allowed: false,
      reason: 'onboarding_incomplete',
    });
    expect(recordLevelComplete(old).levelCompletes).toBe(101);
    expect(shouldShowInterstitial(old, { enabled: true, removeAds: false, nowMs: 1_000_000 })).toBe(false);
  });

  test('does not count repeated or invalid campaign completions', () => {
    let state = recordCampaignLevelComplete(EMPTY_ADS_META, 1);
    for (const id of [1, -2, 0, 1.5, NaN, Infinity]) {
      state = recordCampaignLevelComplete(state, id);
    }
    expect(state.campaignCompletedIds).toEqual([1]);
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(1);
  });

  test('seeds older campaign progress without inventing interval completions', () => {
    const migrated = seedCampaignCompletions(
      { levelCompletes: 7, lastInterstitialAt: 900_000 },
      [1, 2, 3, 4, 5, 6, 6, -1, '7'],
    );
    expect(migrated.campaignCompletedIds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(migrated.levelCompletes).toBe(7);
    expect(migrated.newCampaignCompletionsSinceFullscreen).toBe(0);
    expect(evaluateInterstitial(migrated, context).reason).toBe('insufficient_interstitial_interval');
    expect(evaluateInterstitial(recordVisibleGameplay(migrated, 300), context).allowed).toBe(true);
  });

  test('protects onboarding, incomplete intro, and only the first gameplay session', () => {
    const state = threeShortLevels();
    expect(evaluateInterstitial(state, { ...context, campaignLevelId: 5 }).reason).toBe('onboarding_level');
    expect(evaluateInterstitial(recordVisibleGameplay(state, 3_600), {
      ...context, isFirstGameplaySession: true,
    }).reason).toBe('first_session_protected');
    expect(evaluateInterstitial(state, context).allowed).toBe(true);
    expect(evaluateInterstitial({ ...state, campaignCompletedIds: [1, 3, 4, 5, 6] }, context).reason)
      .toBe('onboarding_incomplete');
  });

  test.each([
    [{ enabled: false }, 'ads_disabled'],
    [{ removeAds: true }, 'remove_ads'],
    [{ campaignLevelId: null }, 'not_campaign_result'],
    [{ protectedTransition: true }, 'protected_transition'],
    [{ userContinued: false }, 'not_user_continuation'],
    [{ rewardsCommitted: false }, 'rewards_not_committed'],
    [{ loaded: false }, 'ad_not_loaded'],
    [{ nowMs: NaN }, 'invalid_time'],
  ] as const)('fails closed for %p', (change, reason) => {
    expect(evaluateInterstitial(threeShortLevels(), { ...context, ...change }).reason).toBe(reason);
  });

  test('permits three short levels without a lifetime or minimum time threshold', () => {
    let state = afterOnboarding();
    for (let level = 6; level <= 7; level++) state = recordCampaignLevelComplete(state, level);
    expect(evaluateInterstitial(state, context).reason).toBe('insufficient_interstitial_interval');
    state = recordCampaignLevelComplete(state, 8);
    expect(state.lifetimeVisibleGameplaySec).toBe(0);
    expect(evaluateInterstitial(state, context)).toEqual({ allowed: true, reason: null });
    expect(shouldShowInterstitial(state, context)).toBe(true);
  });

  test.each([1, 2])('permits a transition after %i long level(s) once gameplay totals five minutes', (levels) => {
    let state = afterOnboarding();
    for (let level = 6; level < 6 + levels; level++) state = recordCampaignLevelComplete(state, level);
    state = recordVisibleGameplay(state, 299);
    expect(evaluateInterstitial(state, context).reason).toBe('insufficient_interstitial_interval');
    state = recordVisibleGameplay(state, 1);
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(levels);
    expect(evaluateInterstitial(state, context)).toEqual({ allowed: true, reason: null });
  });

  test('protected and no-fill transitions preserve the pending eligible interval', () => {
    const state = threeShortLevels();
    const persistedBefore = JSON.stringify(state);
    expect(evaluateInterstitial(state, { ...context, protectedTransition: true }).reason)
      .toBe('protected_transition');
    expect(evaluateInterstitial(state, { ...context, loaded: false }).reason).toBe('ad_not_loaded');
    expect(JSON.stringify(state)).toBe(persistedBefore);
    expect(evaluateInterstitial(normalizeAdsMeta(JSON.parse(persistedBefore)), context).allowed).toBe(true);
  });

  test('rewarded preserves interval progress and delays interstitial for 120 gameplay seconds', () => {
    let state = recordRewardedShown(recordVisibleGameplay(threeShortLevels(), 270));
    expect(state.lifetimeVisibleGameplaySec).toBe(300);
    expect(state.visibleGameplaySinceInterstitialSec).toBe(300);
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(3);
    expect(state.visibleGameplaySinceFullscreenSec).toBe(0);
    expect(state.rewardedCooldownActive).toBe(true);
    expect(evaluateInterstitial(state, context).reason).toBe('rewarded_cooldown');
    state = recordVisibleGameplay(state, 119);
    expect(evaluateInterstitial(state, context).reason).toBe('rewarded_cooldown');
    state = recordVisibleGameplay(state, 1);
    expect(evaluateInterstitial(state, context).allowed).toBe(true);
    expect(state.visibleGameplaySinceInterstitialSec).toBe(420);
    expect(recordVisibleGameplay(state, -20)).toEqual(state);
    expect(recordVisibleGameplay(state, Infinity)).toEqual(state);
  });

  test('each newly shown rewarded restarts only the short cooldown', () => {
    let state = recordRewardedShown(threeShortLevels());
    state = recordVisibleGameplay(state, 119);
    state = recordRewardedShown(state);
    expect(state.visibleGameplaySinceInterstitialSec).toBe(149);
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(3);
    expect(evaluateInterstitial(state, context).reason).toBe('rewarded_cooldown');
    expect(evaluateInterstitial(recordVisibleGameplay(state, 120), context).allowed).toBe(true);
  });

  test('ignores legacy session counts and any number of recent interstitials', () => {
    const state = {
      ...threeShortLevels(), sessionId: 'same-session', sessionInterstitialCount: 100,
    };
    expect(evaluateInterstitial(state, context).allowed).toBe(true);
    const manyRecentShows = {
      ...state, interstitialShownAt: Array.from({ length: 20 }, (_, index) => context.nowMs - index * 1_000),
    };
    expect(evaluateInterstitial(manyRecentShows, context)).toEqual({ allowed: true, reason: null });
    expect(evaluateInterstitial(manyRecentShows, { ...context, isFirstGameplaySession: true }).reason)
      .toBe('first_session_protected');
  });

  test('thirty new one-minute levels permit ten shows within the same hour', () => {
    let state = afterOnboarding();
    let shows = 0;
    for (let index = 1; index <= 30; index++) {
      const levelId = 5 + index;
      const nowMs = context.nowMs + index * 60_000;
      state = recordVisibleGameplay(recordCampaignLevelComplete(state, levelId), 60);
      const decision = evaluateInterstitial(state, { ...context, campaignLevelId: levelId, nowMs });
      expect(decision.allowed).toBe(index % 3 === 0);
      if (decision.allowed) {
        shows++;
        state = recordInterstitialShown(state, nowMs);
      }
    }
    expect(shows).toBe(10);
    expect(state.interstitialShownAt).toHaveLength(10);
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(0);
  });

  test('the five-minute trigger also works after more than six recent shows', () => {
    const state = {
      ...recordVisibleGameplay(afterOnboarding(), 300),
      interstitialShownAt: Array.from({ length: 8 }, (_, index) => context.nowMs - index * 30_000),
    };
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(0);
    expect(evaluateInterstitial(state, context)).toEqual({ allowed: true, reason: null });
    expect(evaluateInterstitial(recordRewardedShown(state), context).reason).toBe('rewarded_cooldown');
  });

  test('confirmed interstitial clears both intervals and cooldown, and prunes the rolling window', () => {
    const state = recordInterstitialShown({
      ...recordRewardedShown(threeShortLevels()),
      interstitialShownAt: [0, 950_000],
    }, 4_000_000);
    expect(state.interstitialShownAt).toEqual([950_000, 4_000_000]);
    expect(state.lastInterstitialAt).toBe(4_000_000);
    expect(state.visibleGameplaySinceFullscreenSec).toBe(0);
    expect(state.visibleGameplaySinceInterstitialSec).toBe(0);
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(0);
    expect(state.rewardedCooldownActive).toBe(false);
    expect(evaluateInterstitial(state, { ...context, nowMs: 4_000_000 }).reason)
      .toBe('insufficient_interstitial_interval');
  });

  test('legacy fullscreen time migrates to interstitial time and keeps accumulating', () => {
    const state = normalizeAdsMeta({
      levelCompletes: 5,
      lastInterstitialAt: null,
      campaignCompletedIds: [1, 2, 3, 4, 5],
      visibleGameplaySinceFullscreenSec: 290,
    });
    expect(state.visibleGameplaySinceInterstitialSec).toBe(290);
    expect(state.rewardedCooldownActive).toBe(false);
    expect(evaluateInterstitial(state, context).reason).toBe('insufficient_interstitial_interval');
    expect(evaluateInterstitial(recordVisibleGameplay(state, 10), context).allowed).toBe(true);
  });

  test('normalizes new fields conservatively and respects an explicit zero interval', () => {
    const state = normalizeAdsMeta({
      ...threeShortLevels(),
      visibleGameplaySinceFullscreenSec: 300,
      visibleGameplaySinceInterstitialSec: 0,
      rewardedCooldownActive: true,
    });
    expect(state.visibleGameplaySinceInterstitialSec).toBe(0);
    expect(state.rewardedCooldownActive).toBe(true);
    expect(normalizeAdsMeta({ ...state, visibleGameplaySinceInterstitialSec: NaN })
      .visibleGameplaySinceInterstitialSec).toBe(0);
  });
});
