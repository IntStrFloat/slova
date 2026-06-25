import { MONETIZATION } from '@/core/config/monetization';

export interface AdsMeta {
  /** число завершённых уровней (драйвер частоты) */
  levelCompletes: number;
  /** unix ms последнего interstitial */
  lastInterstitialAt: number | null;
}

export const EMPTY_ADS_META: AdsMeta = {
  levelCompletes: 0,
  lastInterstitialAt: null,
};

export interface InterstitialCfg {
  minLevelsBeforeFirst: number;
  everyNLevels: number;
  minIntervalSec: number;
}

interface FrequencyOpts {
  enabled: boolean;
  removeAds: boolean;
  nowMs: number;
  cfg?: InterstitialCfg;
}

/** Частотные правила interstitial на LevelComplete (спека 05). */
export function shouldShowInterstitial(meta: AdsMeta, opts: FrequencyOpts): boolean {
  const cfg = opts.cfg ?? MONETIZATION.interstitial;
  if (!opts.enabled || opts.removeAds) return false;
  const n = meta.levelCompletes;
  if (n < cfg.minLevelsBeforeFirst) return false;
  if ((n - cfg.minLevelsBeforeFirst) % cfg.everyNLevels !== 0) return false;
  if (
    meta.lastInterstitialAt !== null &&
    opts.nowMs - meta.lastInterstitialAt < cfg.minIntervalSec * 1000
  ) {
    return false;
  }
  return true;
}

export function recordLevelComplete(meta: AdsMeta): AdsMeta {
  return { ...meta, levelCompletes: meta.levelCompletes + 1 };
}

export function recordInterstitialShown(meta: AdsMeta, nowMs: number): AdsMeta {
  return { ...meta, lastInterstitialAt: nowMs };
}
