import { MONETIZATION, PRODUCT_IDS } from '@/core/config/monetization';
import { getJSON, KEYS, setJSON } from '@/core/storage';

import { EMPTY_ADS_META } from './frequency';
import type { AdsMeta } from './frequency';
import { NoopAdsProvider, NoopIapProvider } from './noop';
import type { AdsProvider, IapProvider } from './types';
import { YandexAdsProvider } from './yandexAds';

export { MONETIZATION, PRODUCT_IDS };
export { AdBanner } from './AdBanner';
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

export function getAds(): AdsProvider {
  return MONETIZATION.adsEnabled ? YandexAdsProvider : NoopAdsProvider;
}

export function getIap(): IapProvider {
  if (MONETIZATION.iapEnabled) {
    // RuStoreIapProvider подключается здесь после регистрации продуктов в RuStore Console (спека 05).
    // SDK: react-native-rustore-billing-sdk (GitFlic). Поток: init → getProducts → purchaseProduct.
  }
  return NoopIapProvider;
}

/** Персист счётчиков частоты (KEYS.adsMeta). */
export function loadAdsMeta(): AdsMeta {
  return getJSON<AdsMeta>(KEYS.adsMeta, EMPTY_ADS_META);
}

export function saveAdsMeta(meta: AdsMeta): void {
  setJSON(KEYS.adsMeta, meta);
}
