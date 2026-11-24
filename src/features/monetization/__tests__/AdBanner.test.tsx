/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { AppState, StyleSheet, Text, type AppStateStatus } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { BannerAdSize, BannerView, MobileAds } from 'yandex-mobile-ads';

import { MONETIZATION } from '@/core/config/monetization';
import { releaseFullscreen, tryAcquireFullscreen, type FullscreenLease, type FullscreenOwner } from '@/core/fullscreen';

import { AdBanner } from '../AdBanner.native';
import { useEntitlements } from '../entitlements';
import { trackOnce } from '@/features/analytics';

let mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
let mockFocused = true;
const mockFocusListeners = new Set<() => void>();
const appStateListeners = new Set<(state: AppStateStatus) => void>();
const initialAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState');

jest.mock('@/features/analytics', () => ({ trackOnce: jest.fn(() => 'e_banner') }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => () => void) => {
  const React = require('react');
  const focused = React.useSyncExternalStore((listener: () => void) => {
    mockFocusListeners.add(listener);
    return () => mockFocusListeners.delete(listener);
  }, () => mockFocused, () => mockFocused);
  React.useEffect(() => focused ? callback() : undefined, [focused, callback]);
} }));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));
jest.mock('yandex-mobile-ads', () => ({
  BannerAdSize: { stickySize: jest.fn() },
  MobileAds: { initialize: jest.fn() },
  BannerView: jest.fn((props) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, { ...props, testID: 'yandex-banner' });
  }),
}));

function sdkSize(width: number, height: number): BannerAdSize {
  return {
    initialWidth: width, initialHeight: 0, width, height,
    widthInPixels: width * 3, heightInPixels: height * 3, type: 'sticky',
  } as BannerAdSize;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let tree: renderer.ReactTestRenderer | undefined;
let fullscreenLease: FullscreenLease | null = null;
async function mount(adUnitId?: string) {
  await act(async () => {
    tree = renderer.create(adUnitId === undefined ? <AdBanner /> : <AdBanner adUnitId={adUnitId} />);
  });
}
function slot() {
  return tree!.root.findByProps({ testID: 'ad-banner-slot' });
}
function banners() {
  return tree!.root.findAll((node) => typeof node.type === 'string' && node.props.testID === 'yandex-banner');
}
async function measure(width: number) {
  await act(async () => {
    slot().props.onLayout({ nativeEvent: { layout: { width, height: 0, x: 0, y: 0 } } });
  });
}
async function focus(value: boolean) {
  await act(async () => {
    mockFocused = value;
    mockFocusListeners.forEach((listener) => listener());
  });
}
async function appState(value: AppStateStatus) {
  Object.defineProperty(AppState, 'currentState', { value, configurable: true });
  await act(async () => appStateListeners.forEach((listener) => listener(value)));
}
function lifecycleEvents() {
  return jest.mocked(trackOnce).mock.calls.map((call) => call[2]!);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockFocusListeners.clear();
  appStateListeners.clear();
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') appStateListeners.add(listener);
    return { remove: () => { appStateListeners.delete(listener); } };
  });
  mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
  useEntitlements.setState({ removeAds: false });
  jest.mocked(MobileAds.initialize).mockResolvedValue(undefined);
  jest.mocked(BannerAdSize.stickySize).mockImplementation(async (width) => sdkSize(width, 96));
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  if (fullscreenLease) releaseFullscreen(fullscreenLease);
  fullscreenLease = null;
  jest.restoreAllMocks();
  if (initialAppState) Object.defineProperty(AppState, 'currentState', initialAppState);
});

test.each<FullscreenOwner>(['interstitial', 'rewarded', 'review', 'checkout', 'update'])(
  'a focused foreground banner never initializes while %s owns fullscreen, even after background return', async (owner) => {
    fullscreenLease = tryAcquireFullscreen(owner);
    expect(fullscreenLease).not.toBeNull();
    await mount();
    expect(tree!.toJSON()).toBeNull();
    expect(MobileAds.initialize).not.toHaveBeenCalled();
    await appState('background');
    await appState('active');
    expect(tree!.toJSON()).toBeNull();
    expect(MobileAds.initialize).not.toHaveBeenCalled();
    await act(async () => { releaseFullscreen(fullscreenLease!); });
    fullscreenLease = null;
    expect(banners()).toHaveLength(0);
    await measure(361);
    expect(banners()).toHaveLength(1);
  },
);

test('fullscreen acquisition destroys the previous banner and rejects late callbacks until a fresh request after release', async () => {
  await mount();
  await measure(361);
  const previous = banners()[0].props;
  const count = lifecycleEvents().length;
  await act(async () => { fullscreenLease = tryAcquireFullscreen('interstitial'); });
  expect(tree!.toJSON()).toBeNull();
  act(() => {
    previous.onAdLoaded();
    previous.onAdImpression({ nativeEvent: { impressionData: 'behind-fullscreen' } });
  });
  expect(lifecycleEvents()).toHaveLength(count);
  await appState('background');
  await appState('active');
  expect(tree!.toJSON()).toBeNull();
  expect(MobileAds.initialize).toHaveBeenCalledTimes(1);
  await act(async () => { releaseFullscreen(fullscreenLease!); });
  fullscreenLease = null;
  await measure(361);
  expect(banners()).toHaveLength(1);
  expect(MobileAds.initialize).toHaveBeenCalledTimes(2);
  const requests = lifecycleEvents().filter((event) => event.stage === 'requested');
  expect(requests).toHaveLength(2);
  expect(requests[0].request_id).not.toBe(requests[1].request_id);
});

test('fullscreen acquisition during pending initialization cannot create a hidden native banner', async () => {
  const initialized = deferred<void>();
  jest.mocked(MobileAds.initialize).mockReturnValueOnce(initialized.promise);
  await mount();
  await measure(361);
  await act(async () => { fullscreenLease = tryAcquireFullscreen('rewarded'); });
  await act(async () => { initialized.resolve(); });
  expect(BannerAdSize.stickySize).not.toHaveBeenCalled();
  expect(banners()).toHaveLength(0);
  expect(lifecycleEvents()).toHaveLength(0);
  await act(async () => { releaseFullscreen(fullscreenLease!); });
  fullscreenLease = null;
  await measure(361);
  expect(banners()).toHaveLength(1);
});

test('an inactive retained route never initializes or mounts a banner', async () => {
  mockFocused = false;
  await mount();
  expect(tree!.toJSON()).toBeNull();
  expect(MobileAds.initialize).not.toHaveBeenCalled();
  await focus(true);
  await measure(361);
  expect(banners()).toHaveLength(1);
  await focus(false);
  expect(banners()).toHaveLength(0);
  expect(appStateListeners.size).toBe(1);
  act(() => tree!.unmount());
  tree = undefined;
  expect(mockFocusListeners.size).toBe(0);
  expect(appStateListeners.size).toBe(0);
});

test('does not initialize in the background and requires a visible measurement on return', async () => {
  Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
  await mount();
  expect(tree!.toJSON()).toBeNull();
  expect(MobileAds.initialize).not.toHaveBeenCalled();
  await appState('active');
  await measure(361);
  expect(banners()).toHaveLength(1);
  await appState('background');
  expect(banners()).toHaveLength(0);
  await appState('active');
  expect(banners()).toHaveLength(0);
  await measure(361);
  expect(banners()).toHaveLength(1);
});

test.each(['blur', 'background'])('ignores initialization finishing after %s', async (reason) => {
  const initialized = deferred<void>();
  jest.mocked(MobileAds.initialize).mockReturnValue(initialized.promise);
  await mount();
  await measure(361);
  if (reason === 'blur') await focus(false);
  else await appState('background');
  await act(async () => { initialized.resolve(); });
  expect(BannerAdSize.stickySize).not.toHaveBeenCalled();
  expect(banners()).toHaveLength(0);
  expect(lifecycleEvents()).toHaveLength(0);
});

test('new ad IDs own fresh telemetry and late callbacks cannot be assigned to the replacement', async () => {
  await mount('first-banner');
  await measure(361);
  const oldCallbacks = banners()[0].props;
  act(() => oldCallbacks.onAdLoaded());
  const firstRequest = lifecycleEvents().find((event) => event.stage === 'requested')!.request_id;
  await act(async () => { tree!.update(<AdBanner adUnitId="second-banner" />); });
  const requests = lifecycleEvents().filter((event) => event.stage === 'requested');
  expect(requests).toHaveLength(2);
  const secondRequest = requests[1].request_id;
  expect(secondRequest).not.toBe(firstRequest);
  const count = lifecycleEvents().length;
  act(() => {
    oldCallbacks.onAdLoaded();
    oldCallbacks.onAdClicked();
    oldCallbacks.onAdImpression({ nativeEvent: { impressionData: 'old' } });
    oldCallbacks.onAdFailedToLoad({ nativeEvent: { description: 'old' } });
  });
  expect(lifecycleEvents()).toHaveLength(count);
  act(() => {
    banners()[0].props.onAdLoaded();
    banners()[0].props.onAdImpression({ nativeEvent: { impressionData: 'new' } });
  });
  expect(lifecycleEvents().filter((event) => event.request_id === secondRequest).map((event) => event.stage))
    .toEqual(['eligible', 'requested', 'loaded', 'impression']);
});

test('late callbacks from a resized or hidden banner cannot log against its successor', async () => {
  await mount();
  await measure(361);
  const first = banners()[0].props;
  await measure(320);
  const count = lifecycleEvents().length;
  act(() => first.onAdImpression({ nativeEvent: { impressionData: 'old-width' } }));
  expect(lifecycleEvents()).toHaveLength(count);
  const second = banners()[0].props;
  await focus(false);
  act(() => second.onAdLoaded());
  expect(lifecycleEvents()).toHaveLength(count);
});

test('returning to an earlier width does not remount its discarded native request while resizing', async () => {
  await mount();
  await measure(361);
  const narrow = deferred<BannerAdSize>();
  const restored = deferred<BannerAdSize>();
  jest.mocked(BannerAdSize.stickySize).mockReturnValueOnce(narrow.promise).mockReturnValueOnce(restored.promise);
  await measure(320);
  expect(banners()).toHaveLength(0);
  const nativeRenders = jest.mocked(BannerView).mock.calls.length;
  await measure(361);
  expect(banners()).toHaveLength(0);
  expect(jest.mocked(BannerView).mock.calls).toHaveLength(nativeRenders);
  await act(async () => { narrow.resolve(sdkSize(320, 90)); });
  expect(banners()).toHaveLength(0);
  await act(async () => { restored.resolve(sdkSize(361, 96)); });
  expect(banners()).toHaveLength(1);
});

test('waits for a measured container and SDK initialization before sizing the banner', async () => {
  const initialized = deferred<void>();
  jest.mocked(MobileAds.initialize).mockReturnValue(initialized.promise);
  await mount();
  expect(BannerAdSize.stickySize).not.toHaveBeenCalled();
  await measure(361.8);
  expect(MobileAds.initialize).toHaveBeenCalledTimes(1);
  expect(BannerAdSize.stickySize).not.toHaveBeenCalled();
  await act(async () => { initialized.resolve(); });
  expect(BannerAdSize.stickySize).toHaveBeenCalledWith(361);
  expect(banners()).toHaveLength(1);
});

test.each([90, 120])('reserves the full SDK height of %i dp without adding a label', async (height) => {
  jest.mocked(BannerAdSize.stickySize).mockImplementation(async (width) => sdkSize(width, height));
  await mount('demo-banner-yandex');
  await measure(361);
  expect(StyleSheet.flatten(slot().props.style)).toMatchObject({ height, flexShrink: 0 });
  expect(banners()[0].props.size).toMatchObject({ width: 361, height, type: 'sticky' });
  expect(banners()[0].props.adRequest).toEqual({ adUnitId: 'demo-banner-yandex' });
  expect(tree!.root.findAllByType(Text)).toHaveLength(0);
});

test('does not resize or reload the native banner during ordinary game renders', async () => {
  await mount();
  await measure(361.8);
  const request = banners()[0].props.adRequest;
  const rendered = jest.mocked(BannerView).mock.calls.length;
  await act(async () => { tree!.update(<AdBanner />); });
  await measure(361.2);
  expect(BannerAdSize.stickySize).toHaveBeenCalledTimes(1);
  expect(banners()[0].props.adRequest).toBe(request);
  expect(jest.mocked(BannerView).mock.calls).toHaveLength(rendered);
});

test('ignores stale size results and removes the old width while recalculating', async () => {
  const first = deferred<BannerAdSize>();
  const second = deferred<BannerAdSize>();
  jest.mocked(BannerAdSize.stickySize)
    .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await mount();
  await measure(361);
  await measure(320);
  await act(async () => { second.resolve(sdkSize(320, 100)); });
  await act(async () => { first.resolve(sdkSize(361, 120)); });
  expect(banners()).toHaveLength(1);
  expect(banners()[0].props.size).toMatchObject({ width: 320, height: 100 });

  const third = deferred<BannerAdSize>();
  jest.mocked(BannerAdSize.stickySize).mockReturnValueOnce(third.promise);
  await measure(280);
  expect(banners()).toHaveLength(0);
  await act(async () => { third.resolve(sdkSize(280, 90)); });
  expect(banners()[0].props.size).toMatchObject({ width: 280, height: 90 });
});

test('recalculates for a height-only window change', async () => {
  await mount();
  await measure(361);
  mockWindow = { ...mockWindow, height: 600 };
  await act(async () => { tree!.update(<AdBanner adUnitId="height-change" />); });
  expect(BannerAdSize.stickySize).toHaveBeenCalledTimes(2);
});

test('hides immediately for removeAds and ignores an unfinished calculation', async () => {
  const pending = deferred<BannerAdSize>();
  jest.mocked(BannerAdSize.stickySize).mockReturnValueOnce(pending.promise);
  await mount();
  await measure(361);
  await act(async () => { useEntitlements.setState({ removeAds: true }); });
  await act(async () => { pending.resolve(sdkSize(361, 96)); });
  expect(tree!.toJSON()).toBeNull();
  await act(async () => { useEntitlements.setState({ removeAds: false }); });
  await measure(361);
  expect(banners()).toHaveLength(1);
});

test('requires a fresh container measurement after ads are re-enabled', async () => {
  await mount();
  await measure(361);
  await act(async () => { useEntitlements.setState({ removeAds: true }); });
  mockWindow = { ...mockWindow, width: 320 };
  await act(async () => { useEntitlements.setState({ removeAds: false }); });
  expect(banners()).toHaveLength(0);
  expect(BannerAdSize.stickySize).toHaveBeenCalledTimes(1);
  await measure(320);
  expect(banners()[0].props.size.width).toBe(320);
  expect(BannerAdSize.stickySize).toHaveBeenCalledTimes(2);
});

test('never initializes or requests a banner when it is disabled or removed', async () => {
  useEntitlements.setState({ removeAds: true });
  await mount();
  expect(tree!.toJSON()).toBeNull();
  expect(MobileAds.initialize).not.toHaveBeenCalled();
  expect(BannerAdSize.stickySize).not.toHaveBeenCalled();
  act(() => tree!.unmount());
  tree = undefined;

  useEntitlements.setState({ removeAds: false });
  jest.replaceProperty(MONETIZATION as { bannerEnabled: boolean }, 'bannerEnabled', false);
  await mount();
  expect(tree!.toJSON()).toBeNull();
  expect(MobileAds.initialize).not.toHaveBeenCalled();
});

test.each([0, -1, NaN, Infinity])('does not request a banner for invalid width %s', async (width) => {
  await mount();
  await measure(width);
  expect(BannerAdSize.stickySize).not.toHaveBeenCalled();
  expect(banners()).toHaveLength(0);
});

test('an initialization failure leaves the game usable without a request loop', async () => {
  jest.mocked(MobileAds.initialize).mockRejectedValue(new Error('offline'));
  await mount();
  await measure(361);
  expect(BannerAdSize.stickySize).not.toHaveBeenCalled();
  expect(banners()).toHaveLength(0);
  await measure(361);
  expect(MobileAds.initialize).toHaveBeenCalledTimes(1);
});

test('a load failure retains the reserved height and does not start a custom refresh', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await mount();
  await measure(361);
  act(() => {
    banners()[0].props.onAdFailedToLoad({ nativeEvent: { description: 'no fill' } });
  });
  expect(StyleSheet.flatten(slot().props.style).height).toBe(96);
  expect(BannerAdSize.stickySize).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledTimes(1);
});
