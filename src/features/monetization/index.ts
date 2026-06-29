import { MONETIZATION, PRODUCT_IDS } from '@/core/config/monetization';
import { getJSON, KEYS, setJSON } from '@/core/storage';

import { EMPTY_ADS_META } from './frequency';
import type { AdsMeta } from './frequency';

export { MONETIZATION, PRODUCT_IDS };
export { AdBanner } from './AdBanner';
export { NoCoinsModal } from './NoCoinsModal';
export { requestRewarded, isRewardedReady } from './rewarded';
export { getAds, getIap } from './providers';
export { useEntitlements } from './entitlements';
export {
  EMPTY_ADS_META,
  recordInterstitialShown,
  recordLevelComplete,
  shouldShowInterstitial,
} from './frequency';
export type { AdsMeta } from './frequency';
export type {
  AdsProvider,
  IapProvider,
  InterstitialResult,
  Product,
  PurchaseResult,
  RewardedResult,
} from './types';

/** Персист счётчиков частоты (KEYS.adsMeta). */
export function loadAdsMeta(): AdsMeta {
  return getJSON<AdsMeta>(KEYS.adsMeta, EMPTY_ADS_META);
}

export function saveAdsMeta(meta: AdsMeta): void {
  setJSON(KEYS.adsMeta, meta);
}
