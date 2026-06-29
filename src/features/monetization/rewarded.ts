import { track } from '@/features/analytics';

import { getAds } from './providers';
import type { RewardedPlacement, RewardedResult } from './types';

/**
 * Единая точка показа rewarded-рекламы (спека 05). Логирует воронку и гарантирует,
 * что вызывающий начисляет награду строго при результате 'rewarded'. Fallback:
 * при недоступности возвращает 'unavailable' — игра продолжает работать без награды.
 */
export async function requestRewarded(placement: RewardedPlacement): Promise<RewardedResult> {
  track('rewarded_requested', { placement });
  let res: RewardedResult = 'unavailable';
  try {
    res = await getAds().showRewarded(placement);
  } catch {
    res = 'unavailable';
  }
  if (res === 'rewarded') track('rewarded_completed', { placement });
  else if (res === 'unavailable') track('ad_failed', { placement, kind: 'rewarded' });
  return res;
}

/** Готовность rewarded к показу (для состояния кнопок). */
export function isRewardedReady(): boolean {
  return getAds().isRewardedReady();
}
