/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('yandex-mobile-ads', () => ({ MobileAds: { initialize: jest.fn(async () => {}) },
  InterstitialAdLoader: { create: jest.fn() }, RewardedAdLoader: { create: jest.fn() } }));
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  AppState: { value: { currentState: 'active', addEventListener: jest.fn() } },
}));
jest.mock('../../../../modules/rustore-review', () => ({ hasActiveForm: jest.fn(() => false),
  subscribeFormOwnership: jest.fn(() => () => {}) }));
jest.mock('../nativeRewardJournal', () => ({ hasActiveNativeRewardedShow: jest.fn(async () => true),
  prepareNativeReward: jest.fn(async () => {}) }));

type Ad = { show: jest.Mock; onAdDismissed?: () => void; onRewarded?: () => void };
async function fixture() {
  jest.resetModules();
  const sdk = require('yandex-mobile-ads');
  const interstitial: Ad[] = [], rewarded: Ad[] = [];
  const loader = (ads: Ad[]) => ({ loadAd: jest.fn(async () => {
    const ad = { show: jest.fn(async () => {}) }; ads.push(ad); return ad;
  }) });
  sdk.InterstitialAdLoader.create.mockResolvedValue(loader(interstitial));
  sdk.RewardedAdLoader.create.mockResolvedValue(loader(rewarded));
  const { YandexAdsProvider: provider } = require('../yandexAds.native');
  provider.setInterstitialPreloadAllowed(true);
  await provider.init();
  return { provider, interstitial, rewarded, fullscreen: require('@/core/fullscreen'),
    native: require('../../../../modules/rustore-review') };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test.each(['review', 'checkout', 'update'])('%s changes existing ad readiness and blocks both show methods', async (owner) => {
  const f = await fixture();
  const changes: string[] = [];
  f.provider.subscribeRewardedState(() => changes.push(f.provider.getRewardedState()));
  const lease = f.fullscreen.tryAcquireFullscreen(owner);
  expect(f.provider.getRewardedState()).toBe('fullscreen_busy');
  expect(f.provider.isRewardedReady()).toBe(false);
  expect(f.provider.isInterstitialReady()).toBe(false);
  await expect(f.provider.showRewarded('wheel')).resolves.toBe('unavailable');
  await expect(f.provider.showInterstitial('level_complete')).resolves.toBe('unavailable');
  expect(f.rewarded[0].show).not.toHaveBeenCalled();
  expect(f.interstitial[0].show).not.toHaveBeenCalled();
  f.fullscreen.releaseFullscreen(lease);
  expect(changes).toEqual(['fullscreen_busy', 'ready']);
});

test('rewarded watchdog retains its exact shared lease until that old ad really terminates', async () => {
  const f = await fixture();
  const pending = f.provider.showRewarded('wheel');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('rewarded');
  await jest.advanceTimersByTimeAsync(180_000);
  await expect(pending).resolves.toBe('unavailable');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('rewarded');
  expect(f.fullscreen.tryAcquireFullscreen('review')).toBeNull();
  f.rewarded[0].onAdDismissed?.();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
  const next = f.fullscreen.tryAcquireFullscreen('review');
  f.rewarded[0].onAdDismissed?.();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('review');
  f.fullscreen.releaseFullscreen(next);
});

test('an open interstitial owns the shared token until terminal callback', async () => {
  const f = await fixture();
  const pending = f.provider.showInterstitial('level_complete');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('interstitial');
  expect(f.fullscreen.tryAcquireFullscreen('checkout')).toBeNull();
  f.interstitial[0].onAdDismissed?.();
  await expect(pending).resolves.toBe('shown');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});

test('a native Review retained by an old JS context blocks ads without a new JS token', async () => {
  const f = await fixture();
  f.native.hasActiveForm.mockReturnValue(true);
  expect(f.provider.getRewardedState()).toBe('fullscreen_busy');
  await expect(f.provider.showRewarded('wheel')).resolves.toBe('unavailable');
  await expect(f.provider.showInterstitial('level_complete')).resolves.toBe('unavailable');
});

test('a terminal native Review invalidation refreshes existing readiness subscribers after focus already returned', async () => {
  const f = await fixture();
  const changes: string[] = [];
  f.provider.subscribeRewardedState(() => changes.push(f.provider.getRewardedState()));
  f.native.hasActiveForm.mockReturnValue(true);
  const callback = f.native.subscribeFormOwnership.mock.calls[0]?.[0];
  expect(callback).toEqual(expect.any(Function));
  callback();
  expect(changes).toEqual(['fullscreen_busy']);
  f.native.hasActiveForm.mockReturnValue(false);
  callback();
  expect(changes).toEqual(['fullscreen_busy', 'ready']);
  expect(f.provider.isRewardedReady()).toBe(true);
});
