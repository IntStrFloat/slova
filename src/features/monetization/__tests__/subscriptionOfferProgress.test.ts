import { MONETIZATION } from '@/core/config/monetization';
import { KEYS, storage } from '@/core/storage';

import { recordSubscriptionOfferInterstitial, reserveSubscriptionOffer, subscriptionOfferProgress } from '../subscriptionOfferProgress';

const NOW = 1_800_000_000_000;
const WEEK = MONETIZATION.subscriptionOffer.dismissForMs;
const showThree = () => { for (let i = 0; i < 3; i++) recordSubscriptionOfferInterstitial(); };

beforeEach(() => storage.clearAll());

test('only three new confirmed interstitials allow one offer, persisted across reads', () => {
  expect(reserveSubscriptionOffer(NOW)).toBe(false);
  for (let i = 0; i < 2; i++) {
    recordSubscriptionOfferInterstitial();
    expect(reserveSubscriptionOffer(NOW)).toBe(false);
  }
  recordSubscriptionOfferInterstitial();
  expect(subscriptionOfferProgress().shownInterstitialsSinceOffer).toBe(3);
  expect(reserveSubscriptionOffer(NOW)).toBe(true);
  expect(subscriptionOfferProgress()).toEqual({ version: 1, shownInterstitialsSinceOffer: 0, lastPresentedAt: NOW });
  expect(reserveSubscriptionOffer(NOW)).toBe(false);
});

test('does not invent exposure from old ad history or malformed storage', () => {
  storage.set(KEYS.adsMeta, JSON.stringify({ interstitialShownAt: [1, 2, 3, 4] }));
  expect(reserveSubscriptionOffer(NOW)).toBe(false);
  for (const saved of ['broken', JSON.stringify({ version: 2, shownInterstitialsSinceOffer: 5 }),
    JSON.stringify({ version: 1, shownInterstitialsSinceOffer: -1 }),
    JSON.stringify({ version: 1, shownInterstitialsSinceOffer: 2.5 })]) {
    storage.set(KEYS.subscriptionOfferProgress, saved);
    expect(reserveSubscriptionOffer(NOW)).toBe(false);
  }
});

test('requires both a week and three more ads, including across restarts', () => {
  showThree();
  expect(reserveSubscriptionOffer(NOW)).toBe(true);
  showThree();
  expect(reserveSubscriptionOffer(NOW + WEEK - 1)).toBe(false);
  expect(reserveSubscriptionOffer(NOW - 1)).toBe(false);
  expect(reserveSubscriptionOffer(NOW + WEEK)).toBe(true);
  expect(reserveSubscriptionOffer(NOW + 2 * WEEK)).toBe(false);
});

test('respects the home-card Later cooldown without consuming pending ad progress', () => {
  showThree();
  storage.set(KEYS.subscriptionOfferDismissedUntil, String(NOW + WEEK));
  expect(reserveSubscriptionOffer(NOW)).toBe(false);
  expect(subscriptionOfferProgress().shownInterstitialsSinceOffer).toBe(3);
  expect(reserveSubscriptionOffer(NOW + WEEK)).toBe(true);
});

test('caps the counter and skips a popup when its frequency reservation cannot be saved', () => {
  for (let i = 0; i < 100; i++) recordSubscriptionOfferInterstitial();
  expect(subscriptionOfferProgress().shownInterstitialsSinceOffer).toBe(3);
  const saved = storage.getString(KEYS.subscriptionOfferProgress);
  const set = jest.spyOn(storage, 'set').mockImplementation(() => { throw new Error('disk full'); });
  expect(reserveSubscriptionOffer(NOW)).toBe(false);
  expect(storage.getString(KEYS.subscriptionOfferProgress)).toBe(saved);
  set.mockRestore();
  expect(reserveSubscriptionOffer(NaN)).toBe(false);
});
