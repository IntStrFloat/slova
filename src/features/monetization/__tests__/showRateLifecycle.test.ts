/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('yandex-mobile-ads', () => ({
  MobileAds: { initialize: jest.fn(async () => {}) },
  InterstitialAd: { hasActiveShow: jest.fn(async () => true) },
  InterstitialAdLoader: { create: jest.fn() }, RewardedAdLoader: { create: jest.fn() },
}));
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  AppState: { value: { currentState: 'active', addEventListener: jest.fn() } },
}));
type Ad = { show: jest.Mock; dispose: jest.Mock; onAdDismissed?: () => void; onAdShown?: () => void };
function fixture() {
  jest.resetModules();
  const sdk = require('yandex-mobile-ads');
  const ads: Ad[] = [];
  const loadAd = jest.fn(async () => {
    const ad = { show: jest.fn(async () => {}), dispose: jest.fn(async () => {}) };
    ads.push(ad); return ad;
  });
  sdk.InterstitialAdLoader.create.mockResolvedValue({ loadAd });
  sdk.RewardedAdLoader.create.mockResolvedValue({ loadAd: jest.fn(async () => ({ show: jest.fn() })) });
  const { YandexAdsProvider: provider } = require('../yandexAds.native');
  return { sdk, provider, ads, loadAd, entitlements: require('../entitlements').useEntitlements,
    fullscreen: require('@/core/fullscreen'), appState: require('react-native').AppState };
}
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('startup initializes rewarded without selecting an interstitial for a protected or absent placement', async () => {
  const f = fixture();
  await f.provider.init();
  expect(f.loadAd).not.toHaveBeenCalled();
  expect(f.provider.isRewardedReady()).toBe(true);
  f.provider.setInterstitialPreloadAllowed(true);
  await f.provider.init();
  expect(f.loadAd).toHaveBeenCalledTimes(1);
});

test('removeAds suppresses loads and readiness, including a load completed after entitlement changes', async () => {
  const f = fixture();
  f.entitlements.setState({ removeAds: true });
  f.provider.setInterstitialPreloadAllowed(true);
  await f.provider.init();
  expect(f.loadAd).not.toHaveBeenCalled();
  expect(f.provider.isInterstitialReady()).toBe(false);
  let complete!: (ad: Ad) => void;
  f.loadAd.mockImplementationOnce(() => new Promise<Ad>((resolve) => { complete = resolve; }));
  f.entitlements.setState({ removeAds: false });
  f.provider.setInterstitialPreloadAllowed(true);
  const loading = f.provider.init();
  await jest.advanceTimersByTimeAsync(0);
  f.entitlements.setState({ removeAds: true });
  const late = { show: jest.fn(), dispose: jest.fn(async () => {}) };
  complete(late); await loading;
  expect(late.dispose).toHaveBeenCalledTimes(1);
  expect(f.provider.isInterstitialReady()).toBe(false);
});

test('completed interstitial does not immediately preload another ad during its full cooldown', async () => {
  const f = fixture();
  f.provider.setInterstitialPreloadAllowed(true);
  await f.provider.init();
  const showing = f.provider.showInterstitial('level_complete');
  f.ads[0].onAdDismissed?.(); await showing;
  await f.provider.init();
  await jest.advanceTimersByTimeAsync(120_000);
  expect(f.loadAd).toHaveBeenCalledTimes(1);
  f.provider.setInterstitialPreloadAllowed(true);
  await f.provider.init();
  expect(f.loadAd).toHaveBeenCalledTimes(2);
});

test('withdrawing a placement stops retries but retains one ready ad for the next eligible pause', async () => {
  const f = fixture();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  f.loadAd.mockRejectedValueOnce(new Error('offline'));
  f.provider.setInterstitialPreloadAllowed(true);
  await f.provider.init();
  f.provider.setInterstitialPreloadAllowed(false);
  await jest.advanceTimersByTimeAsync(120_000);
  expect(f.loadAd).toHaveBeenCalledTimes(1);
  f.provider.setInterstitialPreloadAllowed(true);
  await f.provider.init();
  f.provider.setInterstitialPreloadAllowed(false);
  f.provider.setInterstitialPreloadAllowed(true);
  await f.provider.init();
  expect(f.loadAd).toHaveBeenCalledTimes(2);
  expect(f.ads[0].dispose).not.toHaveBeenCalled();
});

test('interstitial callback timeout returns control while native ownership prevents overlap and stale release', async () => {
  const f = fixture();
  f.provider.setInterstitialPreloadAllowed(true);
  await f.provider.init();
  const showing = f.provider.showInterstitial('level_complete');
  await jest.advanceTimersByTimeAsync(180_000);
  await expect(showing).resolves.toBe('unavailable');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('interstitial');
  expect(f.fullscreen.tryAcquireFullscreen('review')).toBeNull();
  f.ads[0].onAdDismissed?.();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
  const lease = f.fullscreen.tryAcquireFullscreen('review');
  f.ads[0].onAdDismissed?.();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('review');
  f.fullscreen.releaseFullscreen(lease);
});

test('positive native absence releases a timed out interstitial even if its terminal callback was lost', async () => {
  const f = fixture();
  f.sdk.InterstitialAd.hasActiveShow.mockResolvedValue(false);
  f.provider.setInterstitialPreloadAllowed(true);
  await f.provider.init();
  const showing = f.provider.showInterstitial('level_complete');
  await jest.advanceTimersByTimeAsync(180_000);
  await showing;
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});
