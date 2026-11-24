import { DEFAULT_POLICY, resetRuntimePolicy, setConfiguredPolicy, setRuntimePolicyGuard } from '@/core/config/runtimePolicy';
import { EMPTY_ADS_META, seedCampaignCompletions } from '@/features/monetization/frequency';
import { recordRemoteParameterUse } from '../runtime';
import { evaluateConfiguredInterstitial } from '../consumption';

jest.mock('../runtime', () => ({ recordRemoteParameterUse: jest.fn() }));
const context = { enabled: true, removeAds: false, loaded: true, nowMs: 1000, isFirstGameplaySession: false,
  campaignLevelId: 8, userContinued: true, rewardsCommitted: true, protectedTransition: false };
const policy = { ...DEFAULT_POLICY, configVersion: 'candidate_v1', profileScope: 'profile_a',
  assignment: { experiment_id: 'ad_delay', assignment_id: 'assignment_1', variant: 'candidate', allocation_version: 1 },
  parameter: 'ads_interstitial_interval_seconds' as const,
  values: { ...DEFAULT_POLICY.values, ads_interstitial_interval_seconds: 600 } };
beforeEach(() => { jest.clearAllMocks(); resetRuntimePolicy(); setRuntimePolicyGuard(() => true); setConfiguredPolicy(policy); });

test('existing policy uses the actual configured interval; early protection and unavailable guards do not expose', () => {
  const state = { ...seedCampaignCompletions(EMPTY_ADS_META, [1, 2, 3, 4, 5, 6]), visibleGameplaySinceInterstitialSec: 400, newCampaignCompletionsSinceFullscreen: 1 };
  expect(evaluateConfiguredInterstitial(state, { ...context, loaded: false }).reason).toBe('ad_not_loaded');
  expect(recordRemoteParameterUse).not.toHaveBeenCalled();
  expect(evaluateConfiguredInterstitial(state, context).reason).toBe('insufficient_interstitial_interval');
  expect(recordRemoteParameterUse).toHaveBeenCalledWith('ads_interstitial_interval_seconds', 'interstitial_policy');
  expect(evaluateConfiguredInterstitial({ ...state, visibleGameplaySinceInterstitialSec: 600 }, context).allowed).toBe(true);
});

test('short-circuiting the time interval does not expose a level-count parameter that was never read', () => {
  const state = { ...seedCampaignCompletions(EMPTY_ADS_META, [1, 2, 3, 4, 5, 6]), visibleGameplaySinceInterstitialSec: 600, newCampaignCompletionsSinceFullscreen: 0 };
  evaluateConfiguredInterstitial(state, context);
  expect(recordRemoteParameterUse).not.toHaveBeenCalledWith('ads_interstitial_new_levels', expect.any(String));
});
