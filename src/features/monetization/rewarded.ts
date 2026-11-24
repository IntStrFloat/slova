import { track } from '@/features/analytics';

import { getAds } from './providers';
import { loadAdsMeta, saveAdsMeta } from './index';
import { recordRewardedShown } from './frequency';
import type { RewardConfirmation, RewardedObservation, RewardedPlacement, RewardedResult } from './types';

/**
 * Единая точка показа rewarded-рекламы (спека 05). Логирует воронку и гарантирует,
 * что вызывающий начисляет награду строго при результате 'rewarded'. Fallback:
 * при недоступности возвращает 'unavailable' — игра продолжает работать без награды.
 */
export async function requestRewarded(
  placement: RewardedPlacement,
  confirmation?: RewardConfirmation,
  onOpportunity?: (observation: RewardedObservation) => void,
): Promise<RewardedResult> {
  try { track('rewarded_requested', { placement }); } catch { /* Optional telemetry. */ }
  let res: RewardedResult = 'unavailable';
  try {
    res = await (onOpportunity ? getAds().showRewarded(placement, confirmation, onOpportunity)
      : getAds().showRewarded(placement, confirmation));
  } catch {
    res = 'unavailable';
  }
  // Every placement, including the wheel, delays automatic ads without erasing
  // the player's completed levels or accumulated interstitial interval.
  if (res !== 'unavailable') {
    try {
      saveAdsMeta(recordRewardedShown(loadAdsMeta()));
    } catch {
      // An optional cooldown must never hide the SDK's earned reward from its caller.
    }
  }
  try {
    if (res === 'rewarded') track('rewarded_completed', { placement });
    else if (res === 'unavailable') track('ad_failed', { placement, kind: 'rewarded',
      reason: getAds().getRewardedFailure?.() ?? 'not_ready' });
  } catch { /* An analytics failure cannot hide an earned callback. */ }
  return res;
}

/** Готовность rewarded к показу (для состояния кнопок). */
export function isRewardedReady(): boolean {
  return getAds().isRewardedReady();
}
