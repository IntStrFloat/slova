import { MONETIZATION } from '@/core/config/monetization';

import { NoopAdsProvider, NoopIapProvider } from './noop';
import type { AdsProvider, IapProvider } from './types';
import { YandexAdsProvider } from './yandexAds';

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
