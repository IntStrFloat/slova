import { MONETIZATION, PRODUCT_IDS } from '@/core/config/monetization';
import { getJSON, KEYS, setJSON } from '@/core/storage';

import { EMPTY_ADS_META, normalizeAdsMeta, seedCampaignCompletions } from './frequency';
import type { AdsMeta, AdsState } from './frequency';

export { MONETIZATION, PRODUCT_IDS };
export { AdBanner } from './AdBanner';
export { NoCoinsModal } from './NoCoinsModal';
export { requestRewarded, isRewardedReady } from './rewarded';
export { getAds, getIap } from './providers';
export { useEntitlements } from './entitlements';
export {
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
} from './frequency';
export type { AdsMeta, AdsState, InterstitialContext, InterstitialDecision, InterstitialSkipReason } from './frequency';
export type {
  AdsProvider,
  IapProvider,
  InterstitialResult,
  Product,
  PurchaseResult,
  RewardConfirmation,
  RewardedResult,
} from './types';

/** Персист счётчиков частоты (KEYS.adsMeta). */
export function loadAdsMeta(): AdsState {
  const saved = getJSON<AdsMeta | null>(KEYS.adsMeta, null);
  const normalized = normalizeAdsMeta(saved ?? EMPTY_ADS_META);
  if (Array.isArray(saved?.campaignCompletedIds)) return normalized;
  const progress = getJSON<{ completed?: unknown } | null>(KEYS.levelsProgress, null);
  return seedCampaignCompletions(normalized, progress?.completed);
}

export function saveAdsMeta(meta: AdsMeta): void {
  setJSON(KEYS.adsMeta, meta);
}
