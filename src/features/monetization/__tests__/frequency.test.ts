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
  sessionId: 'second-session',
  isFirstAnalyticsSession: false,
  campaignLevelId: 6,
  userContinued: true,
  rewardsCommitted: true,
  protectedTransition: false,
};

function eligible(): AdsState {
  let state = normalizeAdsMeta(EMPTY_ADS_META);
  for (let level = 1; level <= 6; level++) state = recordCampaignLevelComplete(state, level);
  return recordVisibleGameplay(state, 300);
}

describe('interstitial frequency policy', () => {
  test('migrates old metadata conservatively and does not count legacy completions as unique', () => {
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

  test('does not count repeated or invalid campaign completion IDs', () => {
    let state = recordCampaignLevelComplete(EMPTY_ADS_META, 1);
    state = recordCampaignLevelComplete(state, 1);
    state = recordCampaignLevelComplete(state, -2);
    expect(state.campaignCompletedIds).toEqual([1]);
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(1);
  });

  test('seeds lifetime completion IDs from older progress without bypassing the fullscreen interval', () => {
    const migrated = seedCampaignCompletions(
      { levelCompletes: 7, lastInterstitialAt: 900_000 },
      [1, 2, 3, 4, 5, 6, 6, -1, '7'],
    );
    expect(migrated.campaignCompletedIds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(migrated.levelCompletes).toBe(7);
    expect(migrated.newCampaignCompletionsSinceFullscreen).toBe(0);
    expect(evaluateInterstitial(recordVisibleGameplay(migrated, 300), context).reason)
      .toBe('insufficient_completions_since_fullscreen');
  });

  test('protects onboarding levels, incomplete intro, and the first analytics session', () => {
    const state = eligible();
    expect(evaluateInterstitial(state, { ...context, campaignLevelId: 5 }).reason).toBe('onboarding_level');
    expect(evaluateInterstitial(state, { ...context, isFirstAnalyticsSession: true }).reason)
      .toBe('first_session_protected');
    const withoutLevelTwo = { ...state, campaignCompletedIds: [1, 3, 4, 5, 6] };
    expect(evaluateInterstitial(withoutLevelTwo, context).reason).toBe('onboarding_incomplete');
  });

  test.each([
    [{ enabled: false }, 'ads_disabled'],
    [{ removeAds: true }, 'remove_ads'],
    [{ campaignLevelId: null }, 'not_campaign_result'],
    [{ protectedTransition: true }, 'protected_transition'],
    [{ userContinued: false }, 'not_user_continuation'],
    [{ rewardsCommitted: false }, 'rewards_not_committed'],
    [{ sessionId: '' }, 'session_unavailable'],
    [{ loaded: false }, 'ad_not_loaded'],
  ] as const)('fails closed for %p', (change, reason) => {
    expect(evaluateInterstitial(eligible(), { ...context, ...change }).reason).toBe(reason);
  });

  test('requires 300 lifetime visible seconds, 180 since fullscreen, and three new levels', () => {
    let state = normalizeAdsMeta(EMPTY_ADS_META);
    for (let level = 1; level <= 6; level++) state = recordCampaignLevelComplete(state, level);
    expect(evaluateInterstitial(state, context).reason).toBe('insufficient_lifetime_gameplay');
    state = recordVisibleGameplay(state, 299);
    expect(evaluateInterstitial(state, context).reason).toBe('insufficient_lifetime_gameplay');
    state = recordVisibleGameplay(state, 1);
    expect(evaluateInterstitial(state, context)).toEqual({ allowed: true, reason: null });

    state = recordInterstitialShown(state, 1_000_000, context.sessionId);
    expect(evaluateInterstitial(state, { ...context, nowMs: 1_000_001 }).reason)
      .toBe('insufficient_gameplay_since_fullscreen');
    state = recordVisibleGameplay(state, 180);
    expect(evaluateInterstitial(state, { ...context, nowMs: 1_000_001 }).reason)
      .toBe('insufficient_completions_since_fullscreen');
    for (let level = 7; level <= 9; level++) state = recordCampaignLevelComplete(state, level);
    expect(evaluateInterstitial(state, { ...context, nowMs: 1_000_001 })).toEqual({
      allowed: true,
      reason: null,
    });
  });

  test('rewarded fullscreen resets intervals even when lifetime progress remains', () => {
    const state = recordRewardedShown(eligible());
    expect(state.lifetimeVisibleGameplaySec).toBe(300);
    expect(state.visibleGameplaySinceFullscreenSec).toBe(0);
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(0);
    expect(evaluateInterstitial(state, context).reason).toBe('insufficient_gameplay_since_fullscreen');
    expect(recordVisibleGameplay(state, -20)).toEqual(state);
  });

  test('applies session and rolling-hour caps across persisted state', () => {
    const state = eligible();
    expect(evaluateInterstitial({ ...state, sessionId: context.sessionId, sessionInterstitialCount: 3 }, context).reason)
      .toBe('session_cap');
    expect(evaluateInterstitial({ ...state, sessionId: 'old-session', sessionInterstitialCount: 3 }, context).allowed)
      .toBe(true);

    const capped = { ...state, interstitialShownAt: [0, 1, 2, 3, 4, 5] };
    expect(evaluateInterstitial(capped, context).reason).toBe('rolling_hour_cap');
    expect(evaluateInterstitial(capped, { ...context, nowMs: 3_600_000 }).allowed).toBe(true);
  });

  test('shown interstitial updates the session count and prunes the rolling window', () => {
    const state = recordInterstitialShown(
      { ...eligible(), sessionId: context.sessionId, sessionInterstitialCount: 1,
        interstitialShownAt: [0, 950_000] },
      4_000_000,
      context.sessionId,
    );
    expect(state.sessionInterstitialCount).toBe(2);
    expect(state.interstitialShownAt).toEqual([950_000, 4_000_000]);
    expect(state.lastInterstitialAt).toBe(4_000_000);
    expect(state.visibleGameplaySinceFullscreenSec).toBe(0);
    expect(state.newCampaignCompletionsSinceFullscreen).toBe(0);
  });
});
