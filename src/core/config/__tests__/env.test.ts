describe('Yandex ad unit environments', () => {
  const originalEnv = { ...process.env };
  const originalDev = __DEV__;

  function load(dev: boolean, testAds?: string, overrides = false) {
    Object.assign(globalThis, { __DEV__: dev });
    process.env.EXPO_PUBLIC_YANDEX_TEST_ADS = testAds;
    for (const key of ['BANNER', 'INTERSTITIAL', 'REWARDED']) {
      delete process.env[`EXPO_PUBLIC_YANDEX_${key}_AD_UNIT_ID`];
    }
    if (overrides) {
      process.env.EXPO_PUBLIC_YANDEX_BANNER_AD_UNIT_ID = 'R-M-123-1';
      process.env.EXPO_PUBLIC_YANDEX_INTERSTITIAL_AD_UNIT_ID = 'R-M-123-3';
      process.env.EXPO_PUBLIC_YANDEX_REWARDED_AD_UNIT_ID = 'R-M-123-2';
    }
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('../env') as typeof import('../env')).ENV.yandex;
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.assign(globalThis, { __DEV__: originalDev });
    jest.resetModules();
  });

  test('release uses the manager IDs with rewarded -2 and interstitial -3', () => {
    expect(load(false)).toEqual({
      bannerAdUnitId: 'R-M-20249615-1',
      interstitialAdUnitId: 'R-M-20249615-3',
      rewardedAdUnitId: 'R-M-20249615-2',
    });
  });

  test('debug ignores production overrides and requests only demo ads', () => {
    expect(load(true, '0', true)).toEqual({
      bannerAdUnitId: 'demo-banner-yandex',
      interstitialAdUnitId: 'demo-interstitial-yandex',
      rewardedAdUnitId: 'demo-rewarded-yandex',
    });
  });

  test('explicit release QA selects demo ads', () => {
    expect(load(false, '1', true).rewardedAdUnitId).toBe('demo-rewarded-yandex');
  });

  test('release preserves explicit per-format overrides', () => {
    expect(load(false, '0', true)).toEqual({
      bannerAdUnitId: 'R-M-123-1',
      interstitialAdUnitId: 'R-M-123-3',
      rewardedAdUnitId: 'R-M-123-2',
    });
  });
});
