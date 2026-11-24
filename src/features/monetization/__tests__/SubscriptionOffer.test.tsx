/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { KEYS, storage } from '@/core/storage';

const mockPush = jest.fn();
const mockTrack = jest.fn();
let mockRemoveAds = false;
let mockYandexGames = false;
let mockBilling: Record<string, any>;
let mockFocusCallback: (() => void) | null = null;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => {
    mockFocusCallback = callback;
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('@/core/platform/yandexGames', () => ({ isYandexGamesBuild: () => mockYandexGames }));
jest.mock('@/features/analytics/subscription', () => ({ trackSubscription: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('../entitlements', () => ({
  useEntitlements: (selector: (state: { removeAds: boolean }) => unknown) => selector({ removeAds: mockRemoveAds }),
}));
jest.mock('../subscription', () => ({ useSubscription: () => mockBilling }));
jest.mock('@/ui', () => {
  const { Text, View } = require('react-native');
  return { ...require('@/ui/theme'), AppText: Text, GlassPanel: View, Icon: () => null };
});

const { SubscriptionOffer, useSubscriptionOffer } = require('../SubscriptionOffer');
let offerModel: { trackShown: () => void };
function OfferHarness({ completedLevels }: { completedLevels: number }) {
  const offer = useSubscriptionOffer(completedLevels);
  React.useLayoutEffect(() => { offerModel = offer; }, [offer]);
  return <SubscriptionOffer offer={offer} />;
}
let tree: renderer.ReactTestRenderer | undefined;
const renderOffer = (completedLevels = 6) => {
  act(() => { tree = renderer.create(<OfferHarness completedLevels={completedLevels} />); });
};

beforeEach(() => {
  storage.clearAll();
  mockPush.mockClear(); mockTrack.mockClear();
  mockFocusCallback = null;
  mockRemoveAds = false; mockYandexGames = false;
  mockBilling = {
    catalog: { available: true, mode: 'live', plan: { amount: '99.00', periodDays: 30 } },
    status: { active: false, autoRenew: false, pendingPaymentId: null },
    busy: false, error: null, needsMigration: false, hasPendingCheckout: false,
  };
  jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
});
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; jest.restoreAllMocks(); });

test('offers a subscription after onboarding and opens its terms, without starting checkout', () => {
  renderOffer();
  const button = tree!.root.findByProps({ accessibilityLabel: 'Подписка · 99 ₽ / 30 дней' });
  act(() => button.props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/shop', params: { source: 'home_card' } });
  expect(mockTrack).toHaveBeenCalledWith('subscription_offer_clicked', { source: 'home_card', mode: 'live', amount: 99, periodDays: 30 });
});

test('does not interrupt the first six levels', () => {
  renderOffer(5);
  expect(tree!.toJSON()).toBeNull();
});

test.each([
  ['unavailable sales', () => { mockBilling.catalog.available = false; }],
  ['test payments', () => { mockBilling.catalog.mode = 'test'; }],
  ['missing catalog', () => { mockBilling.catalog = null; }],
  ['missing status', () => { mockBilling.status = null; }],
  ['active subscription', () => { mockBilling.status.active = true; }],
  ['legacy no ads', () => { mockRemoveAds = true; }],
  ['auto renewal', () => { mockBilling.status.autoRenew = true; }],
  ['pending invoice', () => { mockBilling.status.pendingPaymentId = 'payment'; }],
  ['pending checkout', () => { mockBilling.hasPendingCheckout = true; }],
  ['migration', () => { mockBilling.needsMigration = true; }],
  ['network failure', () => { mockBilling.error = 'network'; }],
  ['sync in progress', () => { mockBilling.busy = true; }],
  ['Yandex Games', () => { mockYandexGames = true; }],
])('hides the offer for %s', (_label, setup) => {
  setup(); renderOffer();
  expect(tree!.toJSON()).toBeNull();
  offerModel.trackShown();
  expect(mockTrack).not.toHaveBeenCalled();
});

test('dismissal survives remount and expires after seven days', () => {
  renderOffer();
  act(() => tree!.root.findByProps({ accessibilityLabel: 'Скрыть предложение на неделю' }).props.onPress());
  expect(tree!.toJSON()).toBeNull();
  expect(Number(storage.getString(KEYS.subscriptionOfferDismissedUntil))).toBe(Date.now() + 7 * 86_400_000);
  act(() => tree!.unmount()); renderOffer();
  expect(tree!.toJSON()).toBeNull();
  act(() => tree!.unmount());
  jest.mocked(Date.now).mockReturnValue(1_800_000_000_000 + 7 * 86_400_000);
  renderOffer();
  expect(tree!.root.findByProps({ accessibilityLabel: 'Подписка · 99 ₽ / 30 дней' })).toBeDefined();
});

test('counts only a viewport exposure, once per focus visit despite polling hide/reveal', () => {
  renderOffer();
  expect(mockTrack).not.toHaveBeenCalled();
  offerModel.trackShown();
  expect(mockTrack).toHaveBeenCalledWith('subscription_offer_shown', { source: 'home_card', mode: 'live', amount: 99, periodDays: 30 });
  mockBilling.busy = true;
  act(() => { tree!.update(<OfferHarness completedLevels={6} />); });
  offerModel.trackShown();
  mockBilling.busy = false;
  act(() => { tree!.update(<OfferHarness completedLevels={6} />); });
  offerModel.trackShown();
  expect(mockTrack.mock.calls.filter(([name]) => name === 'subscription_offer_shown')).toHaveLength(1);
  act(() => { mockFocusCallback?.(); });
  offerModel.trackShown();
  expect(mockTrack.mock.calls.filter(([name]) => name === 'subscription_offer_shown')).toHaveLength(2);
});

test('a shared post-ad dismissal prevents stale-layout impressions before focus refresh', () => {
  renderOffer();
  storage.set(KEYS.subscriptionOfferDismissedUntil, String(Date.now() + 7 * 86_400_000));
  offerModel.trackShown();
  expect(mockTrack).not.toHaveBeenCalled();
  act(() => { mockFocusCallback?.(); });
  expect(tree!.toJSON()).toBeNull();
});
