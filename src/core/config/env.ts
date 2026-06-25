/**
 * Единая точка чтения переменных окружения (спека 02/05/11).
 * EXPO_PUBLIC_* инлайнятся Metro в бандл; не-public (UAuth/сервисные токены) сюда не кладём.
 * Значения задаются в .env.local (gitignored) / .env.example (шаблон).
 */
export const ENV = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://slova.193.160.208.95.nip.io',
  yandex: {
    bannerAdUnitId: process.env.EXPO_PUBLIC_YANDEX_BANNER_AD_UNIT_ID || 'demo-banner-yandex',
    interstitialAdUnitId:
      process.env.EXPO_PUBLIC_YANDEX_INTERSTITIAL_AD_UNIT_ID || 'demo-interstitial-yandex',
    rewardedAdUnitId:
      process.env.EXPO_PUBLIC_YANDEX_REWARDED_AD_UNIT_ID || 'demo-rewarded-yandex',
  },
  rustore: {
    pushProjectId: process.env.EXPO_PUBLIC_RUSTORE_PUSH_PROJECT_ID ?? '',
    consoleAppId: process.env.EXPO_PUBLIC_RUSTORE_CONSOLE_APP_ID ?? '',
  },
} as const;
