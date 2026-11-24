import { ENV } from './env';

/** Реклама — Yandex. Подписка Робокасса управляется каталогом backend, см. runbook. */
export const MONETIZATION = {
  adsEnabled: true,
  bannerEnabled: true,
  appOpenEnabled: false,
  subscriptionVisible: true, // видимость UI; доступность оплаты определяет backend
  subscriptionOffer: {
    minCompletedLevels: 6,
    minShownInterstitials: 3,
    dismissForMs: 7 * 24 * 60 * 60 * 1000,
  },
  iapEnabled: false, // старые заготовки покупок валюты; к подписке Робокасса не относится
  yandex: {
    bannerAdUnitId: ENV.yandex.bannerAdUnitId,
    interstitialAdUnitId: ENV.yandex.interstitialAdUnitId,
    rewardedAdUnitId: ENV.yandex.rewardedAdUnitId,
  },
  interstitial: {
    onboardingProtectedThroughLevel: 5,
    minUniqueCampaignCompletions: 5,
    minVisibleGameplaySinceInterstitialSec: 300,
    minNewCampaignCompletionsSinceFullscreen: 3,
    rewardedCooldownSec: 120,
  },
  fakeRewardedInDev: false,
} as const;

export const PRODUCT_IDS = {
  removeAds: 'remove_ads',
  proWeekly: 'pro_weekly',
  coinsSmall: 'coins_small',
  coinsLarge: 'coins_large',
} as const;
