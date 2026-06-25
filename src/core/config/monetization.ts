import { ENV } from './env';

/** Флаги и параметры монетизации (спека 05). Реклама — Yandex, платежи — RuStore. */
export const MONETIZATION = {
  adsEnabled: true,
  bannerEnabled: true,
  appOpenEnabled: false,
  iapEnabled: false, // включить после регистрации продуктов в RuStore Console
  yandex: {
    bannerAdUnitId: ENV.yandex.bannerAdUnitId,
    interstitialAdUnitId: ENV.yandex.interstitialAdUnitId,
    rewardedAdUnitId: ENV.yandex.rewardedAdUnitId,
  },
  interstitial: {
    minLevelsBeforeFirst: 3,
    everyNLevels: 2,
    minIntervalSec: 60,
  },
  fakeRewardedInDev: false,
} as const;

export const PRODUCT_IDS = {
  removeAds: 'remove_ads',
  proWeekly: 'pro_weekly',
  coinsSmall: 'coins_small',
  coinsLarge: 'coins_large',
} as const;
