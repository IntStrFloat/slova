import {
  initYandexGames,
  isYandexRewardedReady,
  pauseYandexGameplay,
  resumeYandexGameplay,
} from '@/core/platform/yandexGames';

import type { AdsProvider, InterstitialResult, RewardedResult } from './types';

function reportAdsError(stage: string, error: unknown): void {
  console.warn(`[ads] Yandex Games ${stage} failed`, error);
}

async function showInterstitial(): Promise<InterstitialResult> {
  const sdk = await initYandexGames();
  if (!sdk) return 'unavailable';

  pauseYandexGameplay('ad');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: InterstitialResult) => {
      if (settled) return;
      settled = true;
      resumeYandexGameplay('ad');
      resolve(result);
    };

    try {
      sdk.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => pauseYandexGameplay('ad'),
          onClose: (wasShown) => finish(wasShown ? 'shown' : 'skipped'),
          onError: (error) => {
            reportAdsError('interstitial', error);
            finish('unavailable');
          },
        },
      });
    } catch (error) {
      reportAdsError('interstitial', error);
      finish('unavailable');
    }
  });
}

async function showRewarded(): Promise<RewardedResult> {
  const sdk = await initYandexGames();
  if (!sdk) return 'unavailable';

  pauseYandexGameplay('ad');
  return new Promise((resolve) => {
    let settled = false;
    let rewarded = false;
    const finish = (result: RewardedResult) => {
      if (settled) return;
      settled = true;
      resumeYandexGameplay('ad');
      resolve(result);
    };

    try {
      sdk.adv.showRewardedVideo({
        callbacks: {
          onOpen: () => pauseYandexGameplay('ad'),
          onRewarded: () => {
            rewarded = true;
          },
          onClose: (wasShown) => {
            finish(rewarded ? 'rewarded' : wasShown ? 'dismissed' : 'unavailable');
          },
          onError: (error) => {
            reportAdsError('rewarded', error);
            finish('unavailable');
          },
        },
      });
    } catch (error) {
      reportAdsError('rewarded', error);
      finish('unavailable');
    }
  });
}

export const YandexGamesAdsProvider: AdsProvider = {
  async init() {
    await initYandexGames();
  },
  showInterstitial,
  showRewarded,
  // Yandex Games does not expose a preloaded-fullscreen readiness signal.
  isInterstitialReady: () => false,
  isRewardedReady: isYandexRewardedReady,
};
