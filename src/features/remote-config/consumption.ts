import { getRuntimePolicy, type PolicyParameter } from '@/core/config/runtimePolicy';
import { MONETIZATION } from '@/core/config/monetization';
import { RETENTION } from '@/core/config/retention';
import type { RetentionSnapshot } from '@/features/retention/model';
import { evaluateInterstitial, normalizeAdsMeta, shouldPreloadInterstitial, type AdsMeta, type InterstitialContext } from '@/features/monetization/frequency';
import { recordRemoteParameterUse } from './runtime';

/** Coordinator maps the immutable snapshot into the existing deterministic policy. */
function configuredInterstitial() {
  const snapshot = getRuntimePolicy();
  return { ...MONETIZATION.interstitial,
    minVisibleGameplaySinceInterstitialSec: snapshot.values.ads_interstitial_interval_seconds,
    minNewCampaignCompletionsSinceFullscreen: snapshot.values.ads_interstitial_new_levels };
}

/** Preparation is not a policy exposure or a user show opportunity. */
export function shouldPreloadConfiguredInterstitial(meta: AdsMeta, context: InterstitialContext): boolean {
  return shouldPreloadInterstitial(meta, { ...context, cfg: configuredInterstitial() });
}

export function evaluateConfiguredInterstitial(meta: AdsMeta, context: InterstitialContext) {
  const cfg = configuredInterstitial();
  const decision = evaluateInterstitial(meta, { ...context, cfg });
  // These are the existing policy's only outcomes after it actually reaches the interval expression.
  // Earlier protection/permission/availability guards must not create a parameter exposure.
  if (decision.allowed || decision.reason === 'insufficient_interstitial_interval') {
    recordRemoteParameterUse('ads_interstitial_interval_seconds', 'interstitial_policy');
    if (normalizeAdsMeta(meta).visibleGameplaySinceInterstitialSec < cfg.minVisibleGameplaySinceInterstitialSec) {
      recordRemoteParameterUse('ads_interstitial_new_levels', 'interstitial_policy');
    }
  }
  return decision;
}

/** Called by retention's coordinator after its pure eligibility calculation, not by the policy model. */
export function recordRetentionEligibilityUse(snapshot: Pick<RetentionSnapshot, 'questInstances' | 'eventInstances'>,
  parameters: readonly PolicyParameter[] = ['retention_quests_unlock_wins', 'retention_event_unlock_wins'],
  point = 'retention_policy'): void {
  if (parameters.includes('retention_quests_unlock_wins') && RETENTION.featureFlags.quests && Object.keys(snapshot.questInstances).length === 0) {
    recordRemoteParameterUse('retention_quests_unlock_wins', point);
  }
  if (parameters.includes('retention_event_unlock_wins') && RETENTION.featureFlags.event && Object.keys(snapshot.eventInstances).length === 0) {
    recordRemoteParameterUse('retention_event_unlock_wins', point);
  }
}
