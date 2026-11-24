/**
 * Единая точка чтения переменных окружения (спека 02/05/11).
 * EXPO_PUBLIC_* инлайнятся Metro в бандл; не-public (UAuth/сервисные токены) сюда не кладём.
 * Значения задаются в .env.local (gitignored) / .env.example (шаблон).
 */
// Development and explicit QA builds never request paid production impressions.
const useTestAds = __DEV__ || process.env.EXPO_PUBLIC_YANDEX_TEST_ADS === '1';

export const ENV = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://slova.193.160.208.95.nip.io',
  yandex: {
    bannerAdUnitId: useTestAds ? 'demo-banner-yandex'
      : process.env.EXPO_PUBLIC_YANDEX_BANNER_AD_UNIT_ID || 'R-M-20249615-1',
    interstitialAdUnitId:
      useTestAds ? 'demo-interstitial-yandex'
        : process.env.EXPO_PUBLIC_YANDEX_INTERSTITIAL_AD_UNIT_ID || 'R-M-20249615-3',
    rewardedAdUnitId:
      useTestAds ? 'demo-rewarded-yandex'
        : process.env.EXPO_PUBLIC_YANDEX_REWARDED_AD_UNIT_ID || 'R-M-20249615-2',
  },
  rustore: {
    pushProjectId: process.env.EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID ?? '',
    consoleAppId: process.env.EXPO_PUBLIC_RUSTORE_CONSOLE_APP_ID ?? '',
  },
} as const;
