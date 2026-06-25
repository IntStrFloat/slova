import {
  EMPTY_ADS_META,
  recordInterstitialShown,
  recordLevelComplete,
  shouldShowInterstitial,
} from '../frequency';

const cfg = { minLevelsBeforeFirst: 3, everyNLevels: 2, minIntervalSec: 60 };
const base = { enabled: true, removeAds: false, nowMs: 1_000_000, cfg };

describe('shouldShowInterstitial', () => {
  test('не показывает до minLevelsBeforeFirst', () => {
    const meta = { levelCompletes: 2, lastInterstitialAt: null };
    expect(shouldShowInterstitial(meta, base)).toBe(false);
  });

  test('показывает на 3-м, затем каждый 2-й уровень', () => {
    expect(shouldShowInterstitial({ levelCompletes: 3, lastInterstitialAt: null }, base)).toBe(true);
    expect(shouldShowInterstitial({ levelCompletes: 4, lastInterstitialAt: null }, base)).toBe(false);
    expect(shouldShowInterstitial({ levelCompletes: 5, lastInterstitialAt: null }, base)).toBe(true);
  });

  test('removeAds полностью отключает', () => {
    const meta = { levelCompletes: 5, lastInterstitialAt: null };
    expect(shouldShowInterstitial(meta, { ...base, removeAds: true })).toBe(false);
  });

  test('соблюдает минимальный интервал', () => {
    const meta = { levelCompletes: 5, lastInterstitialAt: 1_000_000 - 30_000 };
    expect(shouldShowInterstitial(meta, base)).toBe(false);
  });

  test('recordLevelComplete/recordInterstitialShown обновляют мету', () => {
    let m = recordLevelComplete(EMPTY_ADS_META);
    expect(m.levelCompletes).toBe(1);
    m = recordInterstitialShown(m, 123);
    expect(m.lastInterstitialAt).toBe(123);
  });
});
