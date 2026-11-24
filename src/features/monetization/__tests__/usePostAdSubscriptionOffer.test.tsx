/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { KEYS, storage } from '@/core/storage';

import { usePostAdSubscriptionOffer } from '../usePostAdSubscriptionOffer';

let mockBilling: Record<string, any>;
let mockRemoveAds = false;
let mockYandexGames = false;
const mockAppListeners = new Set<(state: string) => void>();
const mockBillingListeners = new Set<() => void>();
const mockEntitlementListeners = new Set<() => void>();
const mockTrack = jest.fn();
let mockBlur: (() => void) | undefined;

jest.mock('react-native', () => ({
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
  TurboModuleRegistry: { get: () => null },
  AppState: { currentState: 'active',
  addEventListener: (_name: string, callback: (state: string) => void) => {
    mockAppListeners.add(callback);
    return { remove: () => mockAppListeners.delete(callback) };
  } } }));
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => () => void) => {
  require('react').useEffect(() => { mockBlur = callback(); return mockBlur; }, [callback]);
} }));
jest.mock('@/core/platform/yandexGames', () => ({ isYandexGamesBuild: () => mockYandexGames }));
jest.mock('@/features/analytics/subscription', () => ({ trackSubscription: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('../subscription', () => ({ useSubscription: {
  getState: () => mockBilling,
  subscribe: (callback: () => void) => { mockBillingListeners.add(callback); return () => mockBillingListeners.delete(callback); },
} }));
jest.mock('../entitlements', () => ({ useEntitlements: {
  getState: () => ({ removeAds: mockRemoveAds }),
  subscribe: (callback: () => void) => { mockEntitlementListeners.add(callback); return () => mockEntitlementListeners.delete(callback); },
} }));

let controller: ReturnType<typeof usePostAdSubscriptionOffer>;
let tree: renderer.ReactTestRenderer | undefined;
function Harness() {
  const value = usePostAdSubscriptionOffer();
  React.useLayoutEffect(() => { controller = value; });
  return null;
}
function mount() { act(() => { tree = renderer.create(<Harness />); }); }
async function shown() { let promise!: ReturnType<typeof controller.afterInterstitial>;
  act(() => { promise = controller.afterInterstitial(6); });
  return promise;
}
async function prepareTwo() { await expect(shown()).resolves.toBe('continue'); await expect(shown()).resolves.toBe('continue'); }
function third() { let promise!: ReturnType<typeof controller.afterInterstitial>;
  act(() => { promise = controller.afterInterstitial(6); }); return promise;
}

beforeEach(() => {
  storage.clearAll(); mockTrack.mockClear(); mockRemoveAds = false; mockYandexGames = false;
  mockBilling = { catalog: { available: true, mode: 'live', plan: { amount: '99.00', periodDays: 30 } },
    status: { active: false, autoRenew: false, pendingPaymentId: null },
    busy: false, error: null, needsMigration: false, hasPendingCheckout: false };
  jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
});
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; jest.restoreAllMocks(); });

test('waits after the third actual ad, counts only native onShow, and Later resumes play', async () => {
  mount(); await prepareTwo();
  expect(controller.prompt).toBeNull();
  const result = third();
  expect(controller.prompt).toEqual({ amount: '99.00', periodDays: 30 });
  expect(mockTrack).not.toHaveBeenCalled();
  act(() => { controller.onShown(); controller.onShown(); });
  expect(mockTrack.mock.calls.filter(([event]) => event === 'subscription_offer_shown')).toHaveLength(1);
  act(() => { controller.onLater(); controller.onLater(); });
  await expect(result).resolves.toBe('continue');
  expect(controller.prompt).toBeNull();
  expect(Number(storage.getString(KEYS.subscriptionOfferDismissedUntil))).toBe(Date.now() + 7 * 86_400_000);
  expect(mockTrack.mock.calls.filter(([event]) => event === 'subscription_offer_dismissed')).toHaveLength(1);
});

test('subscribe only resolves navigation intent; it cannot start a payment', async () => {
  mount(); await prepareTwo(); const result = third();
  act(() => { controller.onShown(); controller.onSubscribe(); });
  await expect(result).resolves.toBe('subscribe');
  expect(mockTrack).toHaveBeenCalledWith('subscription_offer_clicked', { source: 'post_ad', mode: 'live' });
  expect(mockBilling.checkout).toBeUndefined();
  expect(storage.getString(KEYS.subscriptionOfferDismissedUntil)).toBeUndefined();
});

test('the prompt cooldown survives remount and requires three new ads', async () => {
  mount(); await prepareTwo(); third();
  act(() => controller.onLater());
  act(() => tree!.unmount()); mount();
  await prepareTwo(); await expect(shown()).resolves.toBe('continue');
  jest.mocked(Date.now).mockReturnValue(1_800_000_000_000 + 7 * 86_400_000);
  const later = third(); expect(controller.prompt).not.toBeNull();
  act(() => controller.onLater()); await expect(later).resolves.toBe('continue');
});

test.each([
  ['paid entitlement', () => { mockRemoveAds = true; }],
  ['active status', () => { mockBilling.status.active = true; }],
  ['auto renewal', () => { mockBilling.status.autoRenew = true; }],
  ['pending checkout', () => { mockBilling.hasPendingCheckout = true; }],
  ['pending invoice', () => { mockBilling.status.pendingPaymentId = '123'; }],
  ['missing status', () => { mockBilling.status = null; }],
  ['unavailable catalog', () => { mockBilling.catalog.available = false; }],
  ['test catalog', () => { mockBilling.catalog.mode = 'test'; }],
  ['missing catalog', () => { mockBilling.catalog = null; }],
  ['busy sync', () => { mockBilling.busy = true; }],
  ['network error', () => { mockBilling.error = 'network'; }],
  ['migration', () => { mockBilling.needsMigration = true; }],
  ['Yandex Games', () => { mockYandexGames = true; }],
])('never offers for %s', async (_name, setup) => {
  setup(); mount(); await prepareTwo(); await expect(shown()).resolves.toBe('continue');
  expect(controller.prompt).toBeNull(); expect(mockTrack).not.toHaveBeenCalled();
});

test('returning availability preserves the ad threshold without showing until a new safe break', async () => {
  mockBilling.error = 'network'; mount(); await prepareTwo(); await expect(shown()).resolves.toBe('continue');
  mockBilling.error = null;
  act(() => { for (const callback of mockBillingListeners) callback(); });
  expect(controller.prompt).toBeNull();
  const result = third(); expect(controller.prompt).not.toBeNull();
  act(() => controller.onLater()); await expect(result).resolves.toBe('continue');
});

test.each(['background', 'blur', 'unmount'] as const)('%s aborts a waiting continuation and cannot invent an impression', async (kind) => {
  mount(); await prepareTwo(); const result = third();
  act(() => {
    if (kind === 'background') for (const callback of mockAppListeners) callback('background');
    if (kind === 'blur') mockBlur?.();
    if (kind === 'unmount') { tree!.unmount(); tree = undefined; }
  });
  await expect(result).resolves.toBe('aborted');
  expect(mockTrack).not.toHaveBeenCalled();
});

test.each(['background', 'blur', 'unmount'] as const)('late ad dismissal after %s aborts before creating a presentation', async (kind) => {
  mount(); await prepareTwo();
  act(() => {
    if (kind === 'background') for (const callback of mockAppListeners) callback('background');
    if (kind === 'blur') mockBlur?.();
    if (kind === 'unmount') { tree!.unmount(); tree = undefined; }
  });
  await expect(third()).resolves.toBe('aborted');
  expect(mockTrack).not.toHaveBeenCalled();
});

test('paid activation while the offer is open closes it without another purchase path', async () => {
  mount(); await prepareTwo(); const result = third();
  act(() => {
    controller.onShown(); mockRemoveAds = true;
    for (const callback of mockEntitlementListeners) callback();
    controller.onSubscribe();
  });
  await expect(result).resolves.toBe('continue'); expect(controller.prompt).toBeNull();
  expect(mockTrack.mock.calls.filter(([name]) => name === 'subscription_offer_clicked')).toHaveLength(0);
});
