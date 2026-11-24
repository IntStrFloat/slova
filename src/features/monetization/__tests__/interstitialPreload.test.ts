import { EMPTY_ADS_META, shouldPreloadInterstitial, type InterstitialContext } from '../frequency';

const context: InterstitialContext = {
  enabled: true, removeAds: false, loaded: false, nowMs: 10_000,
  isFirstGameplaySession: false, campaignLevelId: 8, userContinued: false,
  rewardsCommitted: false, protectedTransition: false,
};
const meta = { ...EMPTY_ADS_META, campaignCompletedIds: [1, 2, 3, 4, 5, 6, 7] };
test('does not warm an ad at startup or during the full cooldown', () => {
  expect(shouldPreloadInterstitial(meta, context)).toBe(false);
  expect(shouldPreloadInterstitial({ ...meta, visibleGameplaySinceInterstitialSec: 269 }, context)).toBe(false);
});
test('warms one ad shortly before time eligibility or the next qualifying completion', () => {
  expect(shouldPreloadInterstitial({ ...meta, visibleGameplaySinceInterstitialSec: 270 }, context)).toBe(true);
  expect(shouldPreloadInterstitial({ ...meta, newCampaignCompletionsSinceFullscreen: 2 }, context)).toBe(true);
  expect(shouldPreloadInterstitial({ ...meta, newCampaignCompletionsSinceFullscreen: 1 }, context)).toBe(false);
});
test.each([
  { isFirstGameplaySession: true }, { removeAds: true }, { enabled: false },
  { campaignLevelId: null }, { campaignLevelId: 5 }, { protectedTransition: true },
])('does not speculate past a hard protection: %j', (guard) => {
  expect(shouldPreloadInterstitial({ ...meta, visibleGameplaySinceInterstitialSec: 600 }, { ...context, ...guard })).toBe(false);
});
test('does not assume missing onboarding levels or unique completions will be earned', () => {
  expect(shouldPreloadInterstitial({ ...meta, campaignCompletedIds: [1, 2, 3, 4] }, context)).toBe(false);
});
test('reuses the configured interval and respects the rewarded cooldown', () => {
  const cfg = { onboardingProtectedThroughLevel: 5, minUniqueCampaignCompletions: 5,
    minVisibleGameplaySinceInterstitialSec: 600, minNewCampaignCompletionsSinceFullscreen: 4, rewardedCooldownSec: 120 };
  expect(shouldPreloadInterstitial({ ...meta, visibleGameplaySinceInterstitialSec: 300 }, { ...context, cfg })).toBe(false);
  expect(shouldPreloadInterstitial({ ...meta, visibleGameplaySinceInterstitialSec: 570 }, { ...context, cfg })).toBe(true);
  expect(shouldPreloadInterstitial({ ...meta, visibleGameplaySinceInterstitialSec: 600,
    rewardedCooldownActive: true, visibleGameplaySinceFullscreenSec: 60 }, { ...context, cfg })).toBe(false);
});
