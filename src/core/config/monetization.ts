import { ENV } from './env';

/** Реклама — Yandex. Подписка ЮKassa управляется каталогом backend, см. runbook. */
export const MONETIZATION = {
  adsEnabled: true,
  bannerEnabled: true,
  appOpenEnabled: false,
  iapEnabled: false, // старые заготовки покупок валюты; к подписке ЮKassa не относится
  yandex: {
    bannerAdUnitId: ENV.yandex.bannerAdUnitId,
    interstitialAdUnitId: ENV.yandex.interstitialAdUnitId,
    rewardedAdUnitId: ENV.yandex.rewardedAdUnitId,
  },
  interstitial: {
    onboardingProtectedThroughLevel: 5,
    minUniqueCampaignCompletions: 5,
    minLifetimeVisibleGameplaySec: 300,
    minVisibleGameplaySinceFullscreenSec: 180,
    minNewCampaignCompletionsSinceFullscreen: 3,
    maxFirstSession: 1,
    maxLaterSession: 3,
    maxRollingHour: 6,
    rollingWindowMs: 60 * 60 * 1000,
  },
  fakeRewardedInDev: false,
} as const;

export const PRODUCT_IDS = {
  removeAds: 'remove_ads',
  proWeekly: 'pro_weekly',
  coinsSmall: 'coins_small',
  coinsLarge: 'coins_large',
} as const;
