/* eslint-disable @typescript-eslint/no-require-imports */

import type { BillingCatalog, SubscriptionStatus } from '@/core/net';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const listeners = new Map();
  const AppState = { currentState: 'active',
    addEventListener: jest.fn((name, callback) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
      return { remove: () => listeners.get(name).delete(callback) };
    }),
    emit: (name: string, value?: string) => {
      if (name === 'change' && typeof value === 'string') AppState.currentState = value;
      for (const callback of [...(listeners.get(name) ?? [])]) callback(value);
    },
  };
  return Object.create(actual, { AppState: { value: AppState } });
});
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => {
  // These billing regressions include a complete browser UI round trip. Dedicated
  // checkoutFullscreen tests separately retain the owner across a still-open browser.
  const { AppState } = require('react-native');
  AppState.emit('blur'); AppState.emit('change', 'background');
  AppState.emit('change', 'active'); AppState.emit('focus');
  return true;
}),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock('@/core/platform/yandexGames', () => ({ isYandexGamesBuild: jest.fn(() => false) }));
jest.mock('@/core/net', () => ({ ...jest.requireActual('@/core/net'), getBackend: jest.fn() }));
jest.mock('@/core/native/appmetrica', () => ({ reportEvent: jest.fn(() => true),
  isAppMetricaAvailable: jest.fn(() => true), isAppMetricaTestDevice: jest.fn(() => false) }));

const now = 1_800_000_000_000;
const day = 86_400_000;
const profile = { userId: 'player-one', authToken: 'test-token', nickname: 'Игрок', tag: '#1' };
const recoveryCode = 'abcdefghijklmnopqrstuvwx12345678';
const confirmationUrl = 'https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=slova_test&InvId=9223372036854775807&OutSum=99.00&SignatureValue=test';
const catalog: BillingCatalog = {
  provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: 'slova_test',
  available: true,
  mode: 'test',
  plan: { id: 'no_ads_30', title: 'Без рекламных пауз', amount: '99.00', currency: 'RUB', periodDays: 30, consentVersion: 'no-ads-30-robokassa-v3',
    termsVersion: 'no-ads-30-robokassa-v3', privacyVersion: 'subscription-privacy-v2',
    consentText: 'Я согласен на автоматические списания согласно условиям оферты',
    userAgreementVersion: 'subscription-user-agreement-v1', personalDataConsentVersion: 'subscription-personal-data-v1',
    personalDataConsentText: 'Я согласен на обработку персональных данных' },
};
const acceptedConsents = { recurringConsented: true, personalDataConsented: true, personalDataConsentVersion: catalog.plan.personalDataConsentVersion };
const inactive: SubscriptionStatus = {
  active: false, activeUntil: null, autoRenew: false, nextPaymentAt: null,
  pendingPaymentId: null, serverTime: now,
};
const pending = { ...inactive, pendingPaymentId: 'test-payment' };
const active = { ...inactive, active: true, activeUntil: now + day, autoRenew: true, nextPaymentAt: now + day };
const legacyDraft = { requestId: '12345678-1234-4123-8123-123456789abc', email: 'first@example.ru', consentVersion: 'no-ads-30-v1', paymentId: 'legacy-payment', confirmationUrl: 'https://yoomoney.ru/checkout/legacy' };
const migrationDraft = { requestId: legacyDraft.requestId, paymentId: legacyDraft.paymentId, provider: 'yookassa', protocol: null, merchantLogin: null, mode: null };
const migrationTarget = { provider: catalog.provider, protocol: catalog.protocol, merchantLogin: catalog.merchantLogin, mode: catalog.mode };
const resolution = { resolution: 'safe_to_discard', reason: 'retired_test_payment', draft: migrationDraft, target: migrationTarget };

function setup(savedEntitlements?: unknown, savedSubscription?: unknown) {
  const { storage, KEYS } = require('@/core/storage');
  storage.clearAll();
  storage.set(KEYS.profile, JSON.stringify(profile));
  if (savedEntitlements) storage.set(KEYS.entitlements, JSON.stringify(savedEntitlements));
  if (savedSubscription) storage.set(KEYS.subscription, JSON.stringify(savedSubscription));
  const backend = {
    billingCatalog: jest.fn().mockResolvedValue(catalog),
    subscription: jest.fn().mockResolvedValue(inactive),
    subscriptionCheckout: jest.fn().mockResolvedValue({
      ...pending, paymentId: 'test-payment', confirmationUrl, recoveryCode,
    }),
    cancelSubscription: jest.fn().mockResolvedValue({ ...active, autoRenew: false, nextPaymentAt: null }),
    restoreSubscription: jest.fn().mockResolvedValue(active),
    subscriptionRecovery: jest.fn().mockResolvedValue({ recoveryCode }),
    updateSubscriptionEmail: jest.fn().mockResolvedValue(active),
    resolveSubscriptionMigration: jest.fn().mockResolvedValue(resolution),
  };
  require('@/core/net').getBackend.mockReturnValue(backend);
  const { useSubscription } = require('../subscription') as typeof import('../subscription');
  const { useEntitlements } = require('../entitlements') as typeof import('../entitlements');
  const { useProfile } = require('@/features/profile') as typeof import('@/features/profile');
  const { openURL } = require('expo-linking');
  return { useSubscription, useEntitlements, useProfile, backend, openURL, storage, KEYS };
}

describe('server-verified no-ads subscription', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());

  test('browser return automatically picks up a delayed payment and removes ads without another checkout', async () => {
    const { useSubscription, useEntitlements, backend, openURL } = setup();
    const { AppState } = require('react-native');
    const { startSubscriptionAutoSync } = require('../subscriptionAutoSync');
    const stop = startSubscriptionAutoSync();
    try {
      await jest.advanceTimersByTimeAsync(0);
      openURL.mockImplementationOnce(async () => { AppState.emit('blur'); AppState.emit('change', 'background'); return true; });
      expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(true);
      expect(useEntitlements.getState().removeAds).toBe(false);
      backend.subscription.mockResolvedValueOnce(pending).mockResolvedValue(active);
      AppState.emit('change', 'active'); AppState.emit('focus');
      await jest.advanceTimersByTimeAsync(0);
      expect(useSubscription.getState().status?.pendingPaymentId).toBe('test-payment');
      await jest.advanceTimersByTimeAsync(3_000);
      expect(useSubscription.getState().status?.active).toBe(true);
      expect(useSubscription.getState().hasPendingCheckout).toBe(false);
      expect(useEntitlements.getState().removeAds).toBe(true);
      expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
      expect(openURL).toHaveBeenCalledTimes(1);
      const requests = backend.subscription.mock.calls.length;
      await jest.advanceTimersByTimeAsync(30_000);
      expect(backend.subscription).toHaveBeenCalledTimes(requests);
    } finally { stop(); }
  });

  test('requires separate consent and a receipt email before creating any payment', async () => {
    const { useSubscription, backend } = setup();
    expect(await useSubscription.getState().checkout('player@example.ru', false, true)).toBe(false);
    expect(useSubscription.getState().error).toBe('consent_required');
    expect(await useSubscription.getState().checkout('not-an-email', true, true)).toBe(false);
    expect(useSubscription.getState().error).toBe('bad_email');
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test('personal-data consent is independent and required before creating a checkout draft', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    expect(await useSubscription.getState().checkout('player@example.ru', true, false)).toBe(false);
    expect(useSubscription.getState().error).toBe('billing_personal_data_consent_required');
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(storage.getString(KEYS.subscription)).toBeUndefined();
  });

  test('rejects malformed domain labels locally and lets a corrected email create the first draft', async () => {
    const { useSubscription, backend } = setup();
    expect(await useSubscription.getState().checkout('a@b..com', true, true)).toBe(false);
    expect(useSubscription.getState().error).toBe('bad_email');
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(await useSubscription.getState().checkout('a@b.com', true, true)).toBe(true);
    expect(backend.subscriptionCheckout.mock.calls[0][1].email).toBe('a@b.com');
  });

  test.each(['player@пример.рф', 'игрок@example.ru', '.player@example.ru', 'player..one@example.ru', 'player@-example.ru', 'player@example-.ru', 'player@exam_ple.ru', 'player\r\n@example.ru'])(
    'rejects SMTP-incompatible email %s before checkout or contact update', async (email) => {
      const { useSubscription, backend } = setup();
      expect(await useSubscription.getState().checkout(email, true, true)).toBe(false);
      expect(await useSubscription.getState().updateEmail(email)).toBe(false);
      expect(useSubscription.getState().error).toBe('bad_email');
      expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
      expect(backend.updateSubscriptionEmail).not.toHaveBeenCalled();
    },
  );

  test.each(['billing_receipt_email_required', 'billing_bad_request_id'])(
    'definitive checkout validation error %s lets the next explicit attempt use a corrected draft', async (code) => {
      const { useSubscription, backend, storage, KEYS } = setup();
      backend.subscriptionCheckout.mockRejectedValueOnce(new Error(code));
      expect(await useSubscription.getState().checkout('first@example.ru', true, true)).toBe(false);
      const rejectedRequest = backend.subscriptionCheckout.mock.calls[0][1].requestId;
      expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
      expect(await useSubscription.getState().checkout('corrected@example.ru', true, true)).toBe(true);
      const nextDraft = backend.subscriptionCheckout.mock.calls[1][1];
      expect(nextDraft.requestId).not.toBe(rejectedRequest);
      expect(nextDraft.email).toBe('corrected@example.ru');
    },
  );

  test('stale consent refreshes the catalog and requires another explicit attempt with the new terms', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    await useSubscription.getState().sync();
    const updatedCatalog = { ...catalog, plan: { ...catalog.plan, consentVersion: 'no-ads-30-robokassa-v4' } };
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('billing_consent_required'));
    backend.billingCatalog.mockResolvedValue(updatedCatalog);
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(false);
    const rejectedDraft = backend.subscriptionCheckout.mock.calls[0][1];
    expect(rejectedDraft.consentVersion).toBe('no-ads-30-robokassa-v3');
    expect(useSubscription.getState().catalog?.plan.consentVersion).toBe('no-ads-30-robokassa-v4');
    expect(useSubscription.getState().error).toBe('billing_consent_required');
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(true);
    expect(backend.subscriptionCheckout.mock.calls[1][1].consentVersion).toBe('no-ads-30-robokassa-v4');
    expect(backend.subscriptionCheckout.mock.calls[1][1].requestId).not.toBe(rejectedDraft.requestId);
  });

  test('rejected personal-data terms refresh the catalog without automatically retrying checkout', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    await useSubscription.getState().sync();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('billing_personal_data_consent_required'));
    backend.billingCatalog.mockResolvedValue({ ...catalog, plan: { ...catalog.plan, personalDataConsentVersion: 'subscription-personal-data-v2' } });
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(false);
    expect(useSubscription.getState().error).toBe('billing_personal_data_consent_required');
    expect(useSubscription.getState().catalog?.plan.personalDataConsentVersion).toBe('subscription-personal-data-v2');
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
  });

  test.each(['billing_gateway_unavailable', 'billing_payment_pending', 'billing_payment_mismatch', 'billing_mode_conflict'])(
    'keeps the original checkout ID after non-validation error %s', async (code) => {
      const { useSubscription, backend, storage, KEYS } = setup();
      backend.subscriptionCheckout.mockRejectedValueOnce(new Error(code));
      expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(false);
      const originalDraft = backend.subscriptionCheckout.mock.calls[0][1];
      expect(JSON.parse(storage.getString(KEYS.subscription)).pending.requestId).toBe(originalDraft.requestId);
      expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(true);
      expect(backend.subscriptionCheckout.mock.calls[1][1]).toEqual(originalDraft);
    },
  );

  test('pending checkout and browser return do not grant no-ads or Pro perks', async () => {
    const { useSubscription, useEntitlements, backend, openURL } = setup();
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(true);
    expect(openURL).toHaveBeenCalledWith(confirmationUrl);
    expect(useEntitlements.getState().removeAds).toBe(false);
    expect(useEntitlements.getState().isPro()).toBe(false);
    backend.subscription.mockResolvedValue(pending);
    await useSubscription.getState().sync();
    expect(useEntitlements.getState().removeAds).toBe(false);
    expect(openURL).toHaveBeenCalledTimes(1);
  });

  test('only verified active status grants access, cancellation preserves its paid period, and expiry removes it', async () => {
    const { useSubscription, useEntitlements, backend } = setup();
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(useEntitlements.getState().subscriptionUntil).toBe(now + day);
    expect(useEntitlements.getState().proUntil).toBeNull();
    expect(await useSubscription.getState().cancel()).toBe(true);
    expect(useSubscription.getState().status?.autoRenew).toBe(false);
    expect(useEntitlements.getState().removeAds).toBe(true);
    useEntitlements.getState().refreshExpiration(now + day);
    expect(useEntitlements.getState().removeAds).toBe(false);
    expect(useEntitlements.getState().subscriptionUntil).toBeNull();
  });

  test('a stale active snapshot after local expiry fetches current status and permits a new checkout', async () => {
    const { useSubscription, useEntitlements, backend } = setup();
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    jest.setSystemTime(now + day);
    backend.subscription.mockResolvedValue({ ...inactive, serverTime: now + day });
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(true);
    expect(backend.subscription).toHaveBeenCalledTimes(2);
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(useEntitlements.getState().removeAds).toBe(false);
  });

  test('converts server clock skew into a local deadline without extending it on offline errors', async () => {
    const { useSubscription, useEntitlements, backend } = setup();
    backend.subscription.mockResolvedValue({ ...active, serverTime: now + 2 * day, activeUntil: now + 3 * day });
    await useSubscription.getState().sync();
    expect(useEntitlements.getState().subscriptionExpiresAt).toBe(now + day);
    backend.subscription.mockRejectedValue(new Error('network'));
    jest.setSystemTime(now + day / 2);
    await useSubscription.getState().sync();
    expect(useEntitlements.getState().subscriptionExpiresAt).toBe(now + day);
    expect(useEntitlements.getState().removeAds).toBe(true);
    jest.setSystemTime(now + day);
    await useSubscription.getState().sync();
    expect(useEntitlements.getState().removeAds).toBe(false);
  });

  test('preserves a legacy permanent purchase after subscription expiry and never treats Pro as no-ads', async () => {
    const { useSubscription, useEntitlements, backend, storage, KEYS } = setup({ removeAds: true, proUntil: now + day });
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    useEntitlements.getState().refreshExpiration(now + day);
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(JSON.parse(storage.getString(KEYS.entitlements)).permanentRemoveAds).toBe(true);
    useEntitlements.getState().setRemoveAds(false);
    expect(useEntitlements.getState().removeAds).toBe(false);
    expect(useEntitlements.getState().isPro()).toBe(true);
  });

  test('does not turn a persisted timed grant into a permanent purchase on hydration', () => {
    const { useEntitlements, storage, KEYS } = setup({
      schemaVersion: 2, removeAds: true, permanentRemoveAds: false,
      subscriptionOwnerId: profile.userId, subscriptionUntil: now + day, subscriptionExpiresAt: now + day,
    });
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(JSON.parse(storage.getString(KEYS.entitlements)).removeAds).toBe(false);
    useEntitlements.getState().refreshExpiration(now + day);
    expect(useEntitlements.getState().removeAds).toBe(false);
  });

  test('a different profile clears another owner’s cached grant immediately', async () => {
    const { useSubscription, useEntitlements, useProfile, backend } = setup();
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    useProfile.setState({ profile: { ...profile, userId: 'player-two' } });
    expect(useEntitlements.getState().removeAds).toBe(false);
    expect(useEntitlements.getState().subscriptionOwnerId).toBeNull();
    expect(useSubscription.getState().status).toBeNull();
  });

  test('a response for a replaced profile cannot regrant the previous owner’s access', async () => {
    const { useSubscription, useEntitlements, useProfile, backend } = setup();
    let finish!: (value: SubscriptionStatus) => void;
    backend.subscription.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const refresh = useSubscription.getState().sync();
    await Promise.resolve();
    await Promise.resolve();
    useProfile.setState({ profile: { ...profile, userId: 'player-two' } });
    finish(active);
    await refresh;
    expect(useEntitlements.getState().removeAds).toBe(false);
    expect(useSubscription.getState().status).toBeNull();
    expect(useSubscription.getState().error).toBe('profile_changed');
  });

  test('a failed profile/network bootstrap does not erase a valid same-owner paid cache', async () => {
    const { useSubscription, useEntitlements, useProfile, backend } = setup({
      schemaVersion: 2, permanentRemoveAds: false,
      subscriptionOwnerId: profile.userId, subscriptionUntil: now + day, subscriptionExpiresAt: now + day,
    });
    useProfile.setState({ ensure: async () => false });
    await useSubscription.getState().sync();
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(useSubscription.getState().error).toBe('profile_unavailable');
    expect(backend.subscription).not.toHaveBeenCalled();
  });

  test('retry retains the persisted idempotency ID and original receipt/consent after ambiguous failure', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    expect(await useSubscription.getState().checkout('first@example.ru', true, true)).toBe(false);
    const first = backend.subscriptionCheckout.mock.calls[0][1];
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending.requestId).toBe(first.requestId);
    await useSubscription.getState().sync();
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending.requestId).toBe(first.requestId);
    expect(await useSubscription.getState().checkout('changed@example.ru', true, true)).toBe(true);
    expect(backend.subscriptionCheckout.mock.calls[1][1]).toEqual(first);
  });

  test('an authoritative canceled checkout clears its ID and allows a fresh explicit purchase', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('billing_checkout_canceled'));
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(false);
    const first = backend.subscriptionCheckout.mock.calls[0][1].requestId;
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(true);
    expect(backend.subscriptionCheckout.mock.calls[1][1].requestId).not.toBe(first);
  });

  test('read-only status correlation resolves a lost response through pending and paid without another checkout', async () => {
    const { useSubscription, useEntitlements, backend, storage, KEYS, openURL } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    await useSubscription.getState().checkout('player@example.ru', true, true);
    const requestId = backend.subscriptionCheckout.mock.calls[0][1].requestId;
    backend.subscription.mockResolvedValue({ ...pending, pendingPaymentId: '101',
      checkoutResolution: { requestId, paymentId: '101', state: 'pending' } });
    await useSubscription.getState().sync();
    expect(backend.subscription).toHaveBeenLastCalledWith(profile.authToken, requestId);
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending.paymentId).toBe('101');
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    backend.subscription.mockResolvedValue({ ...active, checkoutResolution: { requestId, paymentId: '101', state: 'succeeded' } });
    await useSubscription.getState().sync();
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(useSubscription.getState().hasPendingCheckout).toBe(false);
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(openURL).not.toHaveBeenCalled();
  });

  test.each(['succeeded', 'canceled', 'failed'] as const)('terminal correlation %s clears an unknown draft directly', async (state) => {
    const { useSubscription, backend, storage, KEYS } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    await useSubscription.getState().checkout('player@example.ru', true, true);
    const requestId = backend.subscriptionCheckout.mock.calls[0][1].requestId;
    backend.subscription.mockResolvedValue({ ...(state === 'succeeded' ? active : inactive),
      checkoutResolution: { requestId, paymentId: '101', state } });
    await useSubscription.getState().sync();
    expect(useSubscription.getState().hasPendingCheckout).toBe(false);
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
  });

  test.each([undefined, null])('missing or unknown correlation %s does not discard an ambiguous draft', async (checkoutResolution) => {
    const { useSubscription, backend, storage, KEYS } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    await useSubscription.getState().checkout('player@example.ru', true, true);
    const draft = JSON.parse(storage.getString(KEYS.subscription)).pending;
    backend.subscription.mockResolvedValue({ ...active, checkoutResolution });
    await useSubscription.getState().sync();
    expect(useSubscription.getState().status?.active).toBe(true);
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toEqual(draft);
  });

  test.each(['request', 'invoice', 'state', 'pending-status', 'binding'])('invalid %s correlation never resolves the saved draft', async (invalid) => {
    const { useSubscription, backend, storage, KEYS } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    await useSubscription.getState().checkout('player@example.ru', true, true);
    const draft = JSON.parse(storage.getString(KEYS.subscription)).pending;
    backend.subscription.mockResolvedValue({ ...active, checkoutResolution: {
      requestId: invalid === 'request' ? '12345678-1234-4123-8123-123456789abc' : draft.requestId,
      paymentId: invalid === 'invoice' ? 'not-invoice' : '101',
      state: invalid === 'state' ? 'invented' : invalid === 'pending-status' ? 'pending' : 'succeeded',
    } });
    if (invalid === 'binding') backend.billingCatalog.mockResolvedValue({ ...catalog, merchantLogin: 'other' });
    await useSubscription.getState().sync();
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toEqual(draft);
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
  });

  test('profile replacement while loading checkout catalog cannot send or save another owner’s draft', async () => {
    const { useSubscription, useProfile, backend, storage, KEYS } = setup();
    let finish!: (value: BillingCatalog) => void;
    backend.billingCatalog.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const purchase = useSubscription.getState().checkout('player@example.ru', true, true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    useProfile.setState({ profile: { ...profile, userId: 'new-owner' } });
    finish(catalog);
    expect(await purchase).toBe(false);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(JSON.parse(storage.getString(KEYS.subscription))).toMatchObject({ userId: 'new-owner', pending: null });
    expect(useSubscription.getState().error).toBe('profile_changed');
  });

  test('a lost checkout response remains resumable after status reports a pending payment', async () => {
    const { useSubscription, useEntitlements, backend, openURL } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    expect(await useSubscription.getState().checkout('first@example.ru', true, true)).toBe(false);
    const first = backend.subscriptionCheckout.mock.calls[0][1];
    backend.subscription.mockResolvedValue(pending);
    await useSubscription.getState().sync();
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    expect(useSubscription.getState().confirmationUrl).toBeNull();
    expect(await useSubscription.getState().resumeCheckout()).toBe(true);
    expect(backend.subscriptionCheckout.mock.calls[1][1]).toEqual(first);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(useEntitlements.getState().removeAds).toBe(false);
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    expect(useSubscription.getState().hasPendingCheckout).toBe(false);
  });

  test('a persisted checkout with no response stays resumable after app restart', async () => {
    const draft = { ...acceptedConsents, provider: catalog.provider, protocol: catalog.protocol, merchantLogin: catalog.merchantLogin, mode: catalog.mode, requestId: '12345678-1234-4123-8123-123456789abc', email: 'first@example.ru', consentVersion: catalog.plan.consentVersion, paymentId: null, confirmationUrl: null };
    const { useSubscription, backend } = setup(undefined, { userId: profile.userId, pending: draft, recoveryCode: null });
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    backend.subscription.mockResolvedValue(pending);
    expect(await useSubscription.getState().resumeCheckout()).toBe(true);
    expect(backend.subscriptionCheckout).toHaveBeenCalledWith(profile.authToken, {
      provider: catalog.provider, protocol: catalog.protocol, merchantLogin: catalog.merchantLogin, mode: catalog.mode,
      ...acceptedConsents, requestId: draft.requestId, email: draft.email, consentVersion: draft.consentVersion,
    });
  });

  test('a durable protocol v1 checkout is preserved and quarantined before the v2 consent flow', async () => {
    const draft = { provider: catalog.provider, protocol: 'robokassa-v1', merchantLogin: catalog.merchantLogin, mode: catalog.mode,
      requestId: '12345678-1234-4123-8123-123456789abc', email: 'first@example.ru', consentVersion: 'no-ads-30-robokassa-v1', paymentId: null, confirmationUrl: null };
    const { useSubscription, backend, openURL, storage, KEYS } = setup(undefined, { userId: profile.userId, pending: draft, recoveryCode });
    backend.subscription.mockResolvedValue(pending);
    expect(await useSubscription.getState().resumeCheckout()).toBe(false);
    expect(useSubscription.getState().needsMigration).toBe(true);
    expect(useSubscription.getState().error).toBe('billing_provider_migration_required');
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toMatchObject(draft);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });

  test('resume refreshes a cached signed URL without changing its invoice or original consent', async () => {
    const draft = { ...acceptedConsents, provider: catalog.provider, protocol: catalog.protocol, merchantLogin: catalog.merchantLogin, mode: catalog.mode,
      requestId: '12345678-1234-4123-8123-123456789abc', email: 'first@example.ru', consentVersion: catalog.plan.consentVersion, paymentId: 'test-payment', confirmationUrl };
    const { useSubscription, backend, openURL } = setup(undefined, { userId: profile.userId, pending: draft, recoveryCode });
    const refreshedUrl = `${confirmationUrl}&Receipt=updated-receipt`;
    backend.subscription.mockResolvedValue(pending);
    backend.subscriptionCheckout.mockResolvedValue({ ...pending, paymentId: draft.paymentId, confirmationUrl: refreshedUrl, recoveryCode: null });
    expect(await useSubscription.getState().resumeCheckout()).toBe(true);
    expect(backend.subscriptionCheckout).toHaveBeenCalledWith(profile.authToken, {
      provider: draft.provider, protocol: draft.protocol, merchantLogin: draft.merchantLogin, mode: draft.mode,
      ...acceptedConsents, requestId: draft.requestId, email: draft.email, consentVersion: draft.consentVersion,
    });
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(refreshedUrl);
  });

  test.each(['termsVersion', 'privacyVersion', 'consentText', 'userAgreementVersion', 'personalDataConsentVersion', 'personalDataConsentText'])('catalog without %s cannot authorize a new purchase', async (field) => {
    const { useSubscription, backend } = setup();
    backend.billingCatalog.mockResolvedValue({ ...catalog, plan: { ...catalog.plan, [field]: '' } });
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(false);
    expect(useSubscription.getState().error).toBe('invalid_response');
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test('legacy v2 consent is never invented while matching-merchant status and cancellation remain usable', async () => {
    const draft = { provider: 'robokassa', protocol: 'robokassa-v2', merchantLogin: catalog.merchantLogin, mode: 'test',
      requestId: '12345678-1234-4123-8123-123456789abc', email: 'first@example.ru', consentVersion: 'no-ads-30-robokassa-v2', paymentId: 'test-payment', confirmationUrl };
    const { useSubscription, useEntitlements, backend, openURL, storage, KEYS } = setup(undefined, { userId: profile.userId, pending: draft, recoveryCode });
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    expect(useSubscription.getState().status?.active).toBe(true);
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(useSubscription.getState().needsMigration).toBe(true);
    expect(await useSubscription.getState().cancel()).toBe(true);
    expect(useSubscription.getState().status?.autoRenew).toBe(false);
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(await useSubscription.getState().resumeCheckout()).toBe(false);
    expect(await useSubscription.getState().issueRecovery()).toBe(true);
    const saved = JSON.parse(storage.getString(KEYS.subscription));
    expect(saved.pending.requestId).toBe(draft.requestId);
    expect(saved.pending.recurringConsented).toBeNull();
    expect(saved.pending.personalDataConsented).toBeNull();
    expect(saved.pending.personalDataConsentVersion).toBeNull();
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });

  test('a foreign-merchant pending draft still rejects status and never receives another merchant access', async () => {
    const draft = { provider: 'robokassa', protocol: 'robokassa-v2', merchantLogin: 'other_merchant', mode: 'test',
      requestId: '12345678-1234-4123-8123-123456789abc', email: 'first@example.ru', consentVersion: 'no-ads-30-robokassa-v2', paymentId: 'test-payment', confirmationUrl };
    const { useSubscription, useEntitlements, backend } = setup(undefined, { userId: profile.userId, pending: draft, recoveryCode });
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    expect(useSubscription.getState().status).toBeNull();
    expect(useEntitlements.getState().removeAds).toBe(false);
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    expect(useSubscription.getState().error).toBe('billing_provider_migration_required');
  });

  test('legacy checkout hydration preserves its identifiers and blocks replay into the new provider', async () => {
    const draft = { requestId: '12345678-1234-4123-8123-123456789abc', email: 'first@example.ru', consentVersion: 'no-ads-30-v1', paymentId: 'legacy-payment', confirmationUrl: 'https://yoomoney.ru/checkout/legacy' };
    const { useSubscription, backend, openURL, storage, KEYS } = setup(undefined, { userId: profile.userId, pending: draft, recoveryCode });
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    expect(useSubscription.getState().confirmationUrl).toBeNull();
    await useSubscription.getState().sync();
    expect(useSubscription.getState().error).toBe('billing_provider_migration_required');
    expect(await useSubscription.getState().resumeCheckout()).toBe(false);
    expect(await useSubscription.getState().checkout('corrected@example.ru', true, true)).toBe(false);
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    const saved = JSON.parse(storage.getString(KEYS.subscription));
    expect(saved.pending.requestId).toBe(draft.requestId);
    expect(saved.pending.paymentId).toBe(draft.paymentId);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });

  test.each(['retired_test_payment', 'operator_reviewed'])('authoritative migration resolution %s clears only the matched pending draft', async (reason) => {
    const { useSubscription, backend, openURL, storage, KEYS } = setup(undefined, { userId: profile.userId, pending: legacyDraft, recoveryCode });
    backend.resolveSubscriptionMigration.mockResolvedValue({ ...resolution, reason });
    await useSubscription.getState().sync();
    expect(useSubscription.getState().needsMigration).toBe(true);
    expect(await useSubscription.getState().resolveMigration()).toBe(true);
    expect(backend.resolveSubscriptionMigration).toHaveBeenCalledWith(profile.authToken, migrationDraft);
    expect(useSubscription.getState().needsMigration).toBe(false);
    expect(useSubscription.getState().hasPendingCheckout).toBe(false);
    expect(useSubscription.getState().confirmationUrl).toBeNull();
    expect(JSON.parse(storage.getString(KEYS.subscription))).toMatchObject({ userId: profile.userId, pending: null, recoveryCode });
    expect(JSON.parse(storage.getString(KEYS.profile))).toEqual(profile);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });

  test.each([
    { ...resolution, resolution: 'unknown' },
    { ...resolution, reason: 'absent_without_evidence' },
    { ...resolution, draft: { ...migrationDraft, requestId: 'other-request' } },
    { ...resolution, draft: { ...migrationDraft, paymentId: 'other-payment' } },
    { ...resolution, target: { ...migrationTarget, merchantLogin: 'other-merchant' } },
    { ...resolution, target: { ...migrationTarget, mode: 'live' } },
  ])('migration resolution refuses mismatched or unauthoritative proof: %j', async (response) => {
    const { useSubscription, backend, storage, KEYS } = setup(undefined, { userId: profile.userId, pending: legacyDraft, recoveryCode });
    backend.resolveSubscriptionMigration.mockResolvedValue(response);
    expect(await useSubscription.getState().resolveMigration()).toBe(false);
    expect(useSubscription.getState().error).toBe('invalid_response');
    expect(useSubscription.getState().needsMigration).toBe(true);
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending.requestId).toBe(legacyDraft.requestId);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test('an unresolved migration keeps the draft and recovery code available for a later review', async () => {
    const { useSubscription, backend, storage, KEYS } = setup(undefined, { userId: profile.userId, pending: legacyDraft, recoveryCode });
    backend.resolveSubscriptionMigration.mockRejectedValue(new Error('billing_migration_unresolved'));
    expect(await useSubscription.getState().resolveMigration()).toBe(false);
    expect(useSubscription.getState().error).toBe('billing_migration_unresolved');
    expect(useSubscription.getState().needsMigration).toBe(true);
    expect(JSON.parse(storage.getString(KEYS.subscription))).toMatchObject({ pending: legacyDraft, recoveryCode });
  });

  test('a failed status refresh after safe discard preserves paid cache and never retries a purchase', async () => {
    const { useSubscription, useEntitlements, backend, storage, KEYS } = setup({ schemaVersion: 2, permanentRemoveAds: false,
      subscriptionOwnerId: profile.userId, subscriptionUntil: now + day, subscriptionExpiresAt: now + day,
    }, { userId: profile.userId, pending: legacyDraft, recoveryCode });
    backend.subscription.mockRejectedValue(new Error('network'));
    expect(await useSubscription.getState().resolveMigration()).toBe(true);
    expect(useSubscription.getState().error).toBe('network');
    expect(useSubscription.getState().hasPendingCheckout).toBe(false);
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(JSON.parse(storage.getString(KEYS.subscription)).recoveryCode).toBe(recoveryCode);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test('a current-provider checkout cannot be discarded through migration resolution', async () => {
    const { useSubscription, backend } = setup();
    await useSubscription.getState().checkout('player@example.ru', true, true);
    expect(await useSubscription.getState().resolveMigration()).toBe(false);
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    expect(backend.resolveSubscriptionMigration).not.toHaveBeenCalled();
  });

  test('migration support data includes the current owner and exact binding without any secrets or email', async () => {
    const { useSubscription, useProfile } = setup(undefined, { userId: profile.userId, pending: legacyDraft, recoveryCode });
    expect(useSubscription.getState().migrationSupportData()).toBeNull();
    await useSubscription.getState().sync();
    const support = useSubscription.getState().migrationSupportData();
    expect(support).toEqual({ userId: profile.userId, draft: migrationDraft, target: migrationTarget });
    const serialized = JSON.stringify(support);
    for (const excluded of [profile.authToken, recoveryCode, legacyDraft.email, legacyDraft.confirmationUrl,
      'authToken', 'recoveryCode', 'email', 'confirmationUrl']) expect(serialized).not.toContain(excluded);
    useProfile.setState({ profile: { ...profile, userId: 'replacement-player' } });
    expect(useSubscription.getState().migrationSupportData()).toBeNull();
  });

  test('ordinary pending payments never expose a migration support disclosure', async () => {
    const { useSubscription } = setup();
    await useSubscription.getState().checkout('player@example.ru', true, true);
    expect(useSubscription.getState().migrationSupportData()).toBeNull();
  });

  test('a resolution response for a replaced profile cannot mutate the new owner or grant access', async () => {
    const { useSubscription, useProfile, useEntitlements, backend } = setup(undefined, { userId: profile.userId, pending: legacyDraft, recoveryCode });
    let finish!: (value: unknown) => void;
    backend.resolveSubscriptionMigration.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const request = useSubscription.getState().resolveMigration();
    for (let step = 0; step < 10 && !finish; step += 1) await Promise.resolve();
    expect(finish).toBeDefined();
    useProfile.setState({ profile: { ...profile, userId: 'replacement-player' } });
    finish(resolution);
    expect(await request).toBe(false);
    expect(useSubscription.getState().error).toBe('profile_changed');
    expect(useProfile.getState().profile?.userId).toBe('replacement-player');
    expect(useEntitlements.getState().removeAds).toBe(false);
    expect(backend.subscription).not.toHaveBeenCalled();
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test.each([
    { merchantLogin: 'another_merchant' }, { mode: 'live' }, { protocol: 'robokassa-v4' }, { provider: 'another_provider' },
  ])('a persisted checkout cannot cross its provider/merchant/protocol/mode binding: %j', async (change) => {
    const draft = { ...acceptedConsents, provider: catalog.provider, protocol: catalog.protocol, merchantLogin: catalog.merchantLogin, mode: catalog.mode, requestId: '12345678-1234-4123-8123-123456789abc', email: 'first@example.ru', consentVersion: catalog.plan.consentVersion, paymentId: 'test-payment', confirmationUrl, ...change };
    const { useSubscription, backend, openURL, storage, KEYS } = setup(undefined, { userId: profile.userId, pending: draft, recoveryCode });
    await useSubscription.getState().sync();
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    expect(await useSubscription.getState().resumeCheckout()).toBe(false);
    expect(useSubscription.getState().error).toBe('billing_provider_migration_required');
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending.requestId).toBe(draft.requestId);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });

  test('new drafts persist their full provider binding before a lost response', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    await useSubscription.getState().checkout('player@example.ru', true, true);
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toMatchObject({
      ...acceptedConsents, consentVersion: catalog.plan.consentVersion,
      provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: 'slova_test', mode: 'test',
    });
  });

  test('changed personal-data terms quarantine a durable attempt without rewriting either accepted consent', async () => {
    const { useSubscription, backend, openURL, storage, KEYS } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    await useSubscription.getState().checkout('player@example.ru', true, true);
    const original = JSON.parse(storage.getString(KEYS.subscription)).pending;
    backend.billingCatalog.mockResolvedValue({ ...catalog, plan: { ...catalog.plan, personalDataConsentVersion: 'subscription-personal-data-v2' } });
    await useSubscription.getState().sync();
    expect(await useSubscription.getState().resumeCheckout()).toBe(false);
    expect(useSubscription.getState().needsMigration).toBe(true);
    expect(useSubscription.getState().error).toBe('billing_provider_migration_required');
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toEqual(original);
    expect(original).toMatchObject({ ...acceptedConsents, consentVersion: catalog.plan.consentVersion });
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(openURL).not.toHaveBeenCalled();
  });

  test('unrecognized catalog protocol cannot create a payment', async () => {
    const { useSubscription, backend } = setup();
    backend.billingCatalog.mockResolvedValue({ ...catalog, protocol: 'unrecognized-v1' });
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(false);
    expect(useSubscription.getState().error).toBe('billing_provider_migration_required');
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test('correcting subscription email validates first and applies the verified server status', async () => {
    const { useSubscription, useEntitlements, backend } = setup();
    expect(await useSubscription.getState().updateEmail('wrong-email')).toBe(false);
    expect(useSubscription.getState().error).toBe('bad_email');
    expect(backend.updateSubscriptionEmail).not.toHaveBeenCalled();
    expect(await useSubscription.getState().updateEmail(' corrected@example.ru ')).toBe(true);
    expect(backend.updateSubscriptionEmail).toHaveBeenCalledWith(profile.authToken, 'corrected@example.ru');
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test('email update failures keep paid access and allow an explicit retry', async () => {
    const { useSubscription, useEntitlements, backend } = setup();
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    backend.updateSubscriptionEmail.mockRejectedValueOnce(new Error('network'));
    expect(await useSubscription.getState().updateEmail('corrected@example.ru')).toBe(false);
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(await useSubscription.getState().updateEmail('corrected@example.ru')).toBe(true);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test('a pending-payment email conflict preserves the original checkout for safe replay', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    await useSubscription.getState().checkout('first@example.ru', true, true);
    const saved = JSON.parse(storage.getString(KEYS.subscription));
    backend.updateSubscriptionEmail.mockRejectedValueOnce(new Error('billing_email_change_pending'));
    expect(await useSubscription.getState().updateEmail('corrected@example.ru')).toBe(false);
    expect(useSubscription.getState().error).toBe('billing_email_change_pending');
    expect(JSON.parse(storage.getString(KEYS.subscription))).toEqual(saved);
    expect(useSubscription.getState().hasPendingCheckout).toBe(true);
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
  });

  test('a checkout replay without a newly returned recovery code preserves the saved code', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    await useSubscription.getState().checkout('player@example.ru', true, true);
    backend.subscriptionCheckout.mockResolvedValue({ ...pending, paymentId: 'test-payment', confirmationUrl, recoveryCode: null });
    await useSubscription.getState().checkout('player@example.ru', true, true);
    expect(useSubscription.getState().recoveryCode).toBe(recoveryCode);
    expect(JSON.parse(storage.getString(KEYS.subscription)).recoveryCode).toBe(recoveryCode);
    expect(backend.subscriptionRecovery).not.toHaveBeenCalled();
  });

  test('only explicit resume reopens pending checkout and replays no purchase success from the URL', async () => {
    const { useSubscription, useEntitlements, backend, openURL } = setup();
    await useSubscription.getState().checkout('player@example.ru', true, true);
    backend.subscription.mockResolvedValue(pending);
    await useSubscription.getState().sync();
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(await useSubscription.getState().resumeCheckout()).toBe(true);
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(2);
    expect(backend.subscriptionCheckout.mock.calls[1][1]).toEqual(backend.subscriptionCheckout.mock.calls[0][1]);
    expect(useEntitlements.getState().removeAds).toBe(false);
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    expect(useSubscription.getState().confirmationUrl).toBeNull();
    expect(openURL).toHaveBeenCalledTimes(2);
  });

  test.each([
    'javascript:alert(1)', 'http://auth.robokassa.ru/Merchant/Index.aspx',
    'https://auth.robokassa.ru.evil.example/Merchant/Index.aspx', 'https://auth.robokassa.ru@evil.example/Merchant/Index.aspx',
    'https://name:password@auth.robokassa.ru/Merchant/Index.aspx', 'https://auth.robokassa.ru:8443/Merchant/Index.aspx',
    'https://auth.robokassa.ru\\@evil.example/Merchant/Index.aspx', 'https://auth.robokassa.ru/merchant/index.aspx',
    'https://auth.robokassa.ru/Merchant/Other.aspx', 'https://robokassa.ru/Merchant/Index.aspx',
    'https://yoomoney.ru/checkout', 'https://yookassa.ru/checkout',
  ])('never opens malformed/untrusted confirmation URL %s', async (url) => {
    const { useSubscription, useEntitlements, backend, openURL } = setup();
    backend.subscriptionCheckout.mockResolvedValue({ ...pending, paymentId: 'test-payment', confirmationUrl: url, recoveryCode });
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(false);
    expect(useSubscription.getState().error).toBe('invalid_confirmation_url');
    expect(openURL).not.toHaveBeenCalled();
    expect(useEntitlements.getState().removeAds).toBe(false);
  });

  test('shares an in-flight guard across checkout, sync, cancellation, and restore', async () => {
    const { useSubscription, backend } = setup();
    let finish!: (value: unknown) => void;
    backend.subscriptionCheckout.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const purchase = useSubscription.getState().checkout('player@example.ru', true, true);
    expect(await useSubscription.getState().cancel()).toBe(false);
    expect(await useSubscription.getState().restore(recoveryCode)).toBe(false);
    expect(await useSubscription.getState().updateEmail('corrected@example.ru')).toBe(false);
    await useSubscription.getState().sync();
    await Promise.resolve();
    expect(backend.cancelSubscription).not.toHaveBeenCalled();
    expect(backend.restoreSubscription).not.toHaveBeenCalled();
    expect(backend.updateSubscriptionEmail).not.toHaveBeenCalled();
    expect(backend.subscription).not.toHaveBeenCalled();
    finish({ ...pending, paymentId: 'test-payment', confirmationUrl, recoveryCode });
    expect(await purchase).toBe(true);
  });

  test('restore grants access only after verified server success and preserves it after recovery code rotation', async () => {
    const { useSubscription, useEntitlements, backend } = setup();
    backend.restoreSubscription.mockRejectedValueOnce(new Error('billing_recovery_not_found'));
    expect(await useSubscription.getState().restore(recoveryCode)).toBe(false);
    expect(useEntitlements.getState().removeAds).toBe(false);
    expect(await useSubscription.getState().restore(recoveryCode)).toBe(true);
    expect(useEntitlements.getState().removeAds).toBe(true);
    const nextCode = 'zyxwvutsrqponmlkjihgfedc87654321';
    backend.subscriptionRecovery.mockResolvedValue({ recoveryCode: nextCode });
    expect(await useSubscription.getState().issueRecovery()).toBe(true);
    expect(useSubscription.getState().recoveryCode).toBe(nextCode);
    expect(useEntitlements.getState().removeAds).toBe(true);
  });

  test('a lost recovery rotation response cannot keep displaying a possibly invalid old code', async () => {
    const { useSubscription, useEntitlements, backend, storage, KEYS } = setup();
    expect(await useSubscription.getState().restore(recoveryCode)).toBe(true);
    backend.subscriptionRecovery.mockRejectedValueOnce(new Error('network'));
    expect(await useSubscription.getState().issueRecovery()).toBe(false);
    expect(useSubscription.getState().recoveryCode).toBeNull();
    expect(JSON.parse(storage.getString(KEYS.subscription)).recoveryCode).toBeNull();
    expect(useEntitlements.getState().removeAds).toBe(true);
    expect(await useSubscription.getState().issueRecovery()).toBe(true);
    expect(useSubscription.getState().recoveryCode).toBe(recoveryCode);
  });

  test('invalid response and arbitrary error text never create a grant or expose raw provider information', async () => {
    const { useSubscription, useEntitlements, backend } = setup();
    backend.subscription.mockResolvedValue({ ...active, serverTime: 'wrong' });
    await useSubscription.getState().sync();
    expect(useSubscription.getState().error).toBe('invalid_response');
    expect(useEntitlements.getState().removeAds).toBe(false);
    backend.subscription.mockRejectedValue(new Error('SECRET provider key'));
    await useSubscription.getState().sync();
    expect(useSubscription.getState().error).toBe('billing_unavailable');
  });

  test('Yandex Games builds disable all billing calls and timed no-ads grants', async () => {
    require('@/core/platform/yandexGames').isYandexGamesBuild.mockReturnValue(true);
    const { useSubscription, useEntitlements, backend } = setup({
      schemaVersion: 2, permanentRemoveAds: false,
      subscriptionOwnerId: profile.userId, subscriptionUntil: now + day, subscriptionExpiresAt: now + day,
    });
    await useSubscription.getState().sync();
    expect(await useSubscription.getState().checkout('player@example.ru', true, true)).toBe(false);
    expect(useSubscription.getState().error).toBe('billing_disabled');
    expect(backend.billingCatalog).not.toHaveBeenCalled();
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(useEntitlements.getState().removeAds).toBe(false);
  });
});

describe('production subscription funnel telemetry', () => {
  const devDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  const originalQA = process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE;
  const originalAdsQA = process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
  const liveCatalog = { ...catalog, merchantLogin: 'slova', mode: 'live' as const };

  function checkoutObservation(interactionId = 'si_checkout_1_test') {
    return { interactionId, consentIdentity: require('../checkoutValidation').subscriptionConsentIdentity(liveCatalog) };
  }

  function liveSetup(savedSubscription?: unknown, savedAnalytics?: string) {
    const result = setup(undefined, savedSubscription);
    result.backend.billingCatalog.mockResolvedValue(liveCatalog);
    result.backend.subscriptionCheckout.mockResolvedValue({ ...pending, pendingPaymentId: '101', paymentId: '101', confirmationUrl, recoveryCode });
    if (savedAnalytics) result.storage.set('analytics.outbox.v2', savedAnalytics);
    const native = require('@/core/native/appmetrica');
    const events = (event?: string): any[] => native.reportEvent.mock.calls.filter(([name]: [string]) =>
      name.startsWith('subscription_') && (event === undefined || name === event));
    const checkoutActions = (): any[] => native.reportEvent.mock.calls.filter(([event, payload]: [string, { element_id?: string }]) =>
      event === 'ui_action' && payload.element_id === 'subscription_checkout');
    return { ...result, native, events, checkoutActions };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(now);
    Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
    delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE;
    delete process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
  });
  afterEach(() => {
    jest.useRealTimers();
    if (devDescriptor) Object.defineProperty(globalThis, '__DEV__', devDescriptor);
    if (originalQA === undefined) delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE;
    else process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE = originalQA;
    if (originalAdsQA === undefined) delete process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
    else process.env.EXPO_PUBLIC_YANDEX_TEST_ADS = originalAdsQA;
  });

  test.each([
    { email: ' \t', consent: true, personal: true, expected: 'empty_email' },
    { email: 'PRIVATE@bad..example', consent: true, personal: true, expected: 'bad_email' },
    { email: 'PRIVATE@example.ru', consent: false, personal: true, expected: 'consent_required' },
    { email: 'PRIVATE@example.ru', consent: true, personal: false, expected: 'personal_data_consent_required' },
  ])('one final press has one linked $expected result and no draft, invoice or payment', async ({ email, consent, personal, expected }) => {
    const { useSubscription, backend, checkoutActions, events, storage, KEYS, native } = liveSetup();
    useSubscription.setState({ catalog: liveCatalog });
    const observation = checkoutObservation();
    require('@/features/analytics/subscription').trackSubscriptionCheckoutAction({ ...observation, mode: 'live', source: 'settings' });
    expect(await useSubscription.getState().checkout(email, consent, personal, 'settings', observation)).toBe(false);
    expect(checkoutActions().map(([, payload]) => [payload.action, payload.outcome, payload.blocked_reason])).toEqual([
      ['press', 'started', undefined], ['validate', 'rejected', expected],
    ]);
    expect(checkoutActions().every(([, payload]) => payload.interaction_id === observation.interactionId)).toBe(true);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(backend.billingCatalog).not.toHaveBeenCalled();
    expect(storage.getString(KEYS.subscription)).toBeUndefined();
    expect(events()).toHaveLength(0);
    expect(JSON.stringify(native.reportEvent.mock.calls)).not.toMatch(/PRIVATE|example\.ru|test-token|player-one|consentIdentity/);
  });

  test('a missing profile is created by explicit checkout before accepted validation', async () => {
    const { useSubscription, useProfile, backend, checkoutActions } = liveSetup();
    useSubscription.setState({ catalog: liveCatalog });
    const ensure = jest.fn(async () => {
      useProfile.setState({ profile });
      return true;
    });
    useProfile.setState({ profile: null, ensure });
    expect(await useSubscription.getState().checkout('player@example.ru', true, true, 'settings', checkoutObservation())).toBe(true);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(checkoutActions()).toHaveLength(1);
    expect(checkoutActions()[0][1]).toMatchObject({ action: 'validate', outcome: 'accepted', interaction_id: 'si_checkout_1_test' });
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
  });

  test('only the explicit failed profile preflight emits its linked unavailable validation', async () => {
    const { useSubscription, useProfile, backend, checkoutActions, events, storage, KEYS, native } = liveSetup();
    useSubscription.setState({ catalog: liveCatalog });
    useProfile.setState({ profile: null, ensure: jest.fn(async () => false) });
    expect(await useSubscription.getState().checkout('PRIVATE@example.ru', true, true, 'settings', checkoutObservation())).toBe(false);
    expect(checkoutActions()).toHaveLength(1);
    expect(checkoutActions()[0][1]).toMatchObject({ action: 'validate', outcome: 'rejected',
      blocked_reason: 'profile_unavailable', interaction_id: 'si_checkout_1_test' });
    expect(events('subscription_error')[0][1]).toMatchObject({ stage: 'checkout', reason: 'profile_unavailable', interaction_id: 'si_checkout_1_test' });
    await useSubscription.getState().sync();
    expect(checkoutActions()).toHaveLength(1);
    const syncError = events('subscription_error').find(([, payload]) => payload.stage === 'sync')![1];
    expect(syncError).not.toHaveProperty('interaction_id');
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
    expect(JSON.stringify(native.reportEvent.mock.calls)).not.toMatch(/PRIVATE|test-token|player-one|consentIdentity/);
  });

  test.each(['network', 'malformed', 'unavailable'])(
    'actual catalog %s preflight failure is linked to checkout, while later sync stays separate', async (kind) => {
      const { useSubscription, backend, checkoutActions, events, storage, KEYS, native } = liveSetup();
      if (kind === 'network') backend.billingCatalog.mockRejectedValue(new Error('PRIVATE@example.ru provider body'));
      if (kind === 'malformed') backend.billingCatalog.mockResolvedValue({ ...liveCatalog, plan: null } as never);
      if (kind === 'unavailable') backend.billingCatalog.mockResolvedValue({ ...liveCatalog, available: false });
      expect(await useSubscription.getState().checkout('PRIVATE@example.ru', true, true, 'settings', checkoutObservation())).toBe(false);
      expect(checkoutActions()).toHaveLength(1);
      expect(checkoutActions()[0][1]).toMatchObject({ action: 'validate', outcome: 'rejected',
        blocked_reason: 'catalog_unavailable', interaction_id: 'si_checkout_1_test' });
      expect(events('subscription_error')[0][1]).toMatchObject({ stage: 'checkout', interaction_id: 'si_checkout_1_test' });
      backend.subscription.mockRejectedValue(new Error('network'));
      await useSubscription.getState().sync();
      expect(checkoutActions()).toHaveLength(1);
      expect(events('subscription_error').find(([, payload]) => payload.stage === 'sync')![1]).not.toHaveProperty('interaction_id');
      expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
      expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
      expect(events('subscription_checkout_started')).toHaveLength(0);
      expect(events('subscription_invoice_created')).toHaveLength(0);
      expect(events('subscription_payment_failed')).toHaveLength(0);
      expect(JSON.stringify(native.reportEvent.mock.calls)).not.toMatch(/PRIVATE|provider body|test-token|player-one|consentIdentity/);
    },
  );

  test.each([{ amount: '149.00' }, { termsVersion: 'new-terms' }, { personalDataConsentVersion: 'new-data' }, { id: 'new-plan' }])(
    'catalog change during account preflight cannot reuse the accepted identity: %j', async (change) => {
      const { useSubscription, useProfile, backend, checkoutActions, events, storage, KEYS } = liveSetup();
      useSubscription.setState({ catalog: liveCatalog });
      let finish!: (ok: boolean) => void;
      useProfile.setState({ ensure: jest.fn(() => new Promise((resolve) => { finish = resolve; })) });
      const checkout = useSubscription.getState().checkout('player@example.ru', true, true, 'settings', checkoutObservation());
      const changed = { ...liveCatalog, plan: { ...liveCatalog.plan, ...change } };
      useSubscription.setState({ catalog: changed });
      finish(true);
      expect(await checkout).toBe(false);
      expect(useSubscription.getState().error).toBe('billing_consent_required');
      expect(checkoutActions()).toHaveLength(1);
      expect(checkoutActions()[0][1]).toMatchObject({ action: 'validate', outcome: 'rejected', blocked_reason: 'consent_required' });
      expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
      expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
      expect(events('subscription_checkout_started')).toHaveLength(0);
      expect(events('subscription_payment_failed')).toHaveLength(0);
    },
  );

  test('owner change during catalog preflight cannot accept validation or create an invoice', async () => {
    const { useSubscription, useProfile, backend, checkoutActions, events, storage, KEYS } = liveSetup();
    let finish!: (value: BillingCatalog) => void;
    backend.billingCatalog.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const checkout = useSubscription.getState().checkout('player@example.ru', true, true, 'settings', checkoutObservation());
    await jest.advanceTimersByTimeAsync(0);
    useProfile.setState({ profile: { ...profile, userId: 'replacement' } });
    finish(liveCatalog);
    expect(await checkout).toBe(false);
    expect(checkoutActions()).toHaveLength(0);
    expect(events('subscription_checkout_started')).toHaveLength(0);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
  });

  test('shared in-flight guard admits only one validation, draft and backend checkout', async () => {
    const { useSubscription, backend, checkoutActions, events } = liveSetup();
    let finish!: (value: BillingCatalog) => void;
    backend.billingCatalog.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = useSubscription.getState().checkout('player@example.ru', true, true, 'settings', checkoutObservation());
    expect(await useSubscription.getState().checkout('player@example.ru', true, true, 'settings', checkoutObservation('si_checkout_2_test'))).toBe(false);
    await jest.advanceTimersByTimeAsync(0);
    finish(liveCatalog);
    expect(await first).toBe(true);
    expect(checkoutActions()).toHaveLength(1);
    expect(checkoutActions()[0][1]).toMatchObject({ action: 'validate', outcome: 'accepted', interaction_id: 'si_checkout_1_test' });
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(events('subscription_checkout_started')).toHaveLength(1);
    expect(events('subscription_invoice_created')).toHaveLength(1);
  });

  test('records the checkout funnel once per invoice and keeps source outside payment requests', async () => {
    const { useSubscription, backend, events, checkoutActions, storage, KEYS } = liveSetup();
    const observation = checkoutObservation();
    require('@/features/analytics/subscription').trackSubscriptionCheckoutAction({ ...observation, mode: 'live', source: 'post_ad' });
    expect(await useSubscription.getState().checkout('player@example.ru', true, true, 'post_ad', observation)).toBe(true);
    const request = backend.subscriptionCheckout.mock.calls[0][1];
    expect(request).not.toHaveProperty('source');
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending.source).toBe('post_ad');
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toMatchObject({ analyticsAmount: 99, analyticsPeriodDays: 30 });
    backend.subscription.mockResolvedValue({ ...pending, pendingPaymentId: '101',
      checkoutResolution: { requestId: request.requestId, paymentId: '101', state: 'pending' } });
    await useSubscription.getState().sync();
    await useSubscription.getState().sync();
    expect(events('subscription_payment_confirmed')).toHaveLength(0);
    backend.subscription.mockResolvedValue({ ...active,
      checkoutResolution: { requestId: request.requestId, paymentId: '101', state: 'succeeded' } });
    await useSubscription.getState().sync();
    await useSubscription.getState().sync();
    for (const name of ['checkout_started', 'invoice_created', 'browser_opened', 'payment_pending', 'payment_confirmed']) {
      expect(events(`subscription_${name}`)).toHaveLength(1);
      expect(events(`subscription_${name}`)[0][1]).toMatchObject({ source: 'post_ad', mode: 'live', amount: 99, periodDays: 30,
        interaction_id: observation.interactionId });
    }
    expect(checkoutActions().map(([, payload]) => [payload.action, payload.outcome, payload.interaction_id])).toEqual([
      ['press', 'started', observation.interactionId], ['validate', 'accepted', observation.interactionId],
    ]);
    expect(request).not.toHaveProperty('interactionId');
    expect(request).not.toHaveProperty('consentIdentity');
    const sent = JSON.stringify(events());
    for (const secret of ['player@example.ru', profile.authToken, profile.userId, recoveryCode, 'SignatureValue', confirmationUrl]) expect(sent).not.toContain(secret);
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
  });

  test('a lost response and restart recover source, invoice and confirmation without a duplicate purchase', async () => {
    const first = liveSetup();
    first.backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    await first.useSubscription.getState().checkout('player@example.ru', true, true, 'home_card', checkoutObservation());
    const saved = JSON.parse(first.storage.getString(first.KEYS.subscription));
    const savedAnalytics = first.storage.getString('analytics.outbox.v2');
    expect(first.events('subscription_checkout_started')).toHaveLength(1);
    expect(first.events('subscription_invoice_created')).toHaveLength(0);
    jest.resetModules();
    const next = liveSetup(saved, savedAnalytics);
    next.backend.subscription.mockResolvedValue({ ...pending, pendingPaymentId: '101',
      checkoutResolution: { requestId: saved.pending.requestId, paymentId: '101', state: 'pending' } });
    await next.useSubscription.getState().sync();
    await next.useSubscription.getState().sync();
    next.backend.subscription.mockResolvedValue({ ...active,
      checkoutResolution: { requestId: saved.pending.requestId, paymentId: '101', state: 'succeeded' } });
    await next.useSubscription.getState().sync();
    await next.useSubscription.getState().sync();
    expect(next.events('subscription_invoice_created')).toHaveLength(1);
    expect(next.events('subscription_payment_pending')).toHaveLength(1);
    expect(next.events('subscription_payment_confirmed')).toHaveLength(1);
    expect(next.events('subscription_payment_confirmed')[0][1].source).toBe('home_card');
    expect(next.events('subscription_payment_confirmed')[0][1].interaction_id).toBe('si_checkout_1_test');
    expect(next.backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(next.openURL).not.toHaveBeenCalled();
  });

  test('cached active access and recovery never masquerade as a new payment', async () => {
    const { useSubscription, backend, events } = liveSetup();
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    await useSubscription.getState().restore(recoveryCode);
    await useSubscription.getState().sync();
    expect(events('subscription_payment_confirmed')).toHaveLength(0);
    expect(events('subscription_invoice_created')).toHaveLength(0);
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test('confirmation keeps the consented price snapshot if the later catalog changes', async () => {
    const { useSubscription, backend, events } = liveSetup();
    await useSubscription.getState().checkout('player@example.ru', true, true, 'post_ad');
    const requestId = backend.subscriptionCheckout.mock.calls[0][1].requestId;
    backend.billingCatalog.mockResolvedValue({ ...liveCatalog, plan: { ...liveCatalog.plan, amount: '149.00', periodDays: 365 } });
    backend.subscription.mockResolvedValue({ ...active, checkoutResolution: { requestId, paymentId: '101', state: 'succeeded' } });
    await useSubscription.getState().sync();
    expect(events('subscription_payment_confirmed')[0][1]).toMatchObject({ amount: 99, periodDays: 30 });
    expect(backend.subscriptionCheckout.mock.calls[0][1]).not.toHaveProperty('analyticsAmount');
    expect(backend.subscriptionCheckout.mock.calls[0][1]).not.toHaveProperty('analyticsPeriodDays');
  });

  test('an old pending draft without a validated price snapshot never borrows the current catalog price', async () => {
    const draft = { ...legacyDraft, ...acceptedConsents, provider: 'robokassa', protocol: 'robokassa-v3',
      merchantLogin: 'slova', mode: 'live', consentVersion: catalog.plan.consentVersion,
      paymentId: '101', confirmationUrl, source: 'settings' };
    const { useSubscription, backend, events } = liveSetup({ userId: profile.userId, pending: draft, recoveryCode: null });
    backend.subscription.mockResolvedValue({ ...active,
      checkoutResolution: { requestId: draft.requestId, paymentId: '101', state: 'succeeded' } });
    await useSubscription.getState().sync();
    expect(events('subscription_payment_confirmed')).toHaveLength(1);
    expect(events('subscription_payment_confirmed')[0][1]).toMatchObject({ source: 'settings', mode: 'live', stage: 'status', result: 'confirmed' });
  });

  test('a successful authenticated checkout replay counts only its returned invoice', async () => {
    const { useSubscription, backend, events } = liveSetup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    await useSubscription.getState().checkout('player@example.ru', true, true, 'settings');
    backend.subscriptionCheckout.mockResolvedValue({ ...active, paymentId: '101', confirmationUrl, recoveryCode });
    await useSubscription.getState().checkout('player@example.ru', true, true, 'direct');
    await useSubscription.getState().sync();
    expect(events('subscription_checkout_started')).toHaveLength(1);
    expect(events('subscription_payment_confirmed')).toHaveLength(1);
    expect(events('subscription_payment_confirmed')[0][1].source).toBe('settings');
  });

  test('a response for a replaced profile cannot count a purchase for its new owner', async () => {
    const { useSubscription, useProfile, backend, events, native } = liveSetup();
    await useSubscription.getState().checkout('player@example.ru', true, true, 'home_card');
    const requestId = backend.subscriptionCheckout.mock.calls[0][1].requestId;
    let finish!: (value: unknown) => void;
    backend.subscription.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const sync = useSubscription.getState().sync();
    await jest.advanceTimersByTimeAsync(0);
    useProfile.setState({ profile: { ...profile, userId: 'replacement' } });
    native.reportEvent.mockClear();
    finish({ ...active, checkoutResolution: { requestId, paymentId: '101', state: 'succeeded' } });
    await sync;
    expect(events('subscription_payment_confirmed')).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });

  test('a foreign request correlation and a generic old active status cannot count the unknown attempt', async () => {
    const { useSubscription, backend, events } = liveSetup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('network'));
    await useSubscription.getState().checkout('player@example.ru', true, true, 'settings');
    backend.subscription.mockResolvedValue({ ...active, checkoutResolution: {
      requestId: '12345678-1234-4123-8123-123456789abc', paymentId: '101', state: 'succeeded',
    } });
    await useSubscription.getState().sync();
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    expect(events('subscription_payment_confirmed')).toHaveLength(0);
  });

  test.each(['canceled', 'failed'] as const)('records an authoritative %s invoice once, without a purchase', async (state) => {
    const { useSubscription, backend, events } = liveSetup();
    await useSubscription.getState().checkout('player@example.ru', true, true, 'settings');
    const requestId = backend.subscriptionCheckout.mock.calls[0][1].requestId;
    backend.subscription.mockResolvedValue({ ...inactive, checkoutResolution: { requestId, paymentId: '101', state } });
    await useSubscription.getState().sync();
    await useSubscription.getState().sync();
    expect(events(`subscription_payment_${state}`)).toHaveLength(1);
    expect(events('subscription_payment_confirmed')).toHaveLength(0);
  });

  test('browser failure is safe and explicit resume retains the original source and counts its opening once', async () => {
    const { useSubscription, backend, openURL, events } = liveSetup();
    openURL.mockRejectedValueOnce(new Error('secret signed checkout URL'));
    expect(await useSubscription.getState().checkout('private@example.ru', true, true, 'post_ad')).toBe(false);
    expect(events('subscription_browser_opened')).toHaveLength(0);
    expect(events('subscription_error')[0][1]).toMatchObject({ stage: 'browser', reason: 'browser_unavailable', source: 'post_ad' });
    backend.subscription.mockResolvedValue({ ...pending, pendingPaymentId: '101' });
    await useSubscription.getState().resumeCheckout();
    await useSubscription.getState().resumeCheckout();
    expect(events('subscription_browser_opened')).toHaveLength(1);
    expect(events('subscription_browser_opened')[0][1]).toMatchObject({ source: 'post_ad', trigger: 'resume', result: 'resumed' });
    expect(JSON.stringify(events())).not.toMatch(/private@example|secret signed|SignatureValue/);
  });

  test('repeated polling errors are bounded and cannot include raw exception details', async () => {
    const { useSubscription, backend, events } = liveSetup();
    await useSubscription.getState().checkout('player@example.ru', true, true, 'settings');
    backend.subscription.mockRejectedValue(new Error('private@example.ru secret provider body'));
    await useSubscription.getState().sync();
    await useSubscription.getState().sync();
    expect(events('subscription_error')).toHaveLength(1);
    expect(events('subscription_error')[0][1]).toMatchObject({ source: 'settings', mode: 'live', stage: 'sync', reason: 'billing_unavailable' });
    expect(JSON.stringify(events())).not.toMatch(/private@example|secret provider/);
  });

  test.each(['test_billing', 'native_qa', 'opt_out'])('does not pollute production purchase events for %s', async (kind) => {
    const { useSubscription, backend, native, events } = liveSetup();
    if (kind === 'test_billing') backend.billingCatalog.mockResolvedValue(catalog);
    if (kind === 'native_qa') native.isAppMetricaTestDevice.mockReturnValue(true);
    if (kind === 'opt_out') require('@/features/analytics').useAnalyticsPrefs.getState().setOptOut(true);
    await useSubscription.getState().checkout('player@example.ru', true, true, 'settings');
    const requestId = backend.subscriptionCheckout.mock.calls[0][1].requestId;
    backend.subscription.mockResolvedValue({ ...active, checkoutResolution: { requestId, paymentId: '101', state: 'succeeded' } });
    await useSubscription.getState().sync();
    expect(events()).toHaveLength(0);
  });
});

describe('billing HTTP transport', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
  });

  test('encodes optional checkout correlation in an authenticated GET without a payment mutation', async () => {
    const backend = jest.requireActual('@/core/net').getBackend();
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => inactive });
    await backend.subscription('test-token', 'request &?');
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('?checkoutRequestId=request%20%26%3F'),
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ authorization: 'Bearer test-token' }) }));
  });

  test('bootstrap aborts stalled networking and does not leave a timeout after successful retry', async () => {
    const backend = jest.requireActual('@/core/net').getBackend();
    globalThis.fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
    const request = backend.bootstrap('Игрок');
    const rejection = expect(request).rejects.toThrow('timeout');
    jest.advanceTimersByTime(15_000);
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ profile, authToken: 'token' }) });
    await expect(backend.bootstrap('Игрок')).resolves.toEqual({ profile, authToken: 'token' });
    expect(jest.getTimerCount()).toBe(0);
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(backend.bootstrap('Игрок')).rejects.toThrow('http_503');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('bootstrap rejects a late response even if the transport ignores abort', async () => {
    const backend = jest.requireActual('@/core/net').getBackend();
    let finish!: (value: Response) => void;
    globalThis.fetch = jest.fn(() => new Promise((resolve) => { finish = resolve; })) as typeof fetch;
    const request = backend.bootstrap('Игрок');
    const rejection = expect(request).rejects.toThrow('timeout');
    jest.advanceTimersByTime(15_000);
    finish({ ok: true, json: async () => ({ profile, authToken: 'late' }) } as Response);
    await rejection;
  });

  test('posts authenticated checkout with an abortable request and parses only approved error codes', async () => {
    const backend = jest.requireActual('@/core/net').getBackend();
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'billing_receipt_email_required' }) });
    globalThis.fetch = fetchMock;
    const request = { ...acceptedConsents, provider: catalog.provider, protocol: catalog.protocol, merchantLogin: catalog.merchantLogin,
      mode: catalog.mode, requestId: 'id', email: 'email', consentVersion: catalog.plan.consentVersion };
    await expect(backend.subscriptionCheckout('test-token', request))
      .rejects.toThrow('billing_receipt_email_required');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.authorization).toBe('Bearer test-token');
    expect(options.headers['X-Slova-Billing-Protocol']).toBe('robokassa-v3');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.body).toBe(JSON.stringify(request));
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'private_provider_credentials' }) });
    await expect(backend.billingCatalog()).rejects.toThrow('billing_unavailable');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('all billing calls include protocol negotiation, including the public catalog', async () => {
    const backend = jest.requireActual('@/core/net').getBackend();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => active });
    globalThis.fetch = fetchMock;
    await backend.billingCatalog();
    await backend.subscription('test-token');
    await backend.cancelSubscription('test-token');
    await backend.restoreSubscription('test-token', recoveryCode);
    await backend.subscriptionRecovery('test-token');
    await backend.updateSubscriptionEmail('test-token', 'corrected@example.ru');
    await backend.resolveSubscriptionMigration('test-token', migrationDraft);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    for (const [, options] of fetchMock.mock.calls) expect(options.headers['X-Slova-Billing-Protocol']).toBe('robokassa-v3');
  });

  test('migration resolution submits only the frozen draft identity to the authenticated endpoint', async () => {
    const backend = jest.requireActual('@/core/net').getBackend();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => resolution });
    globalThis.fetch = fetchMock;
    await expect(backend.resolveSubscriptionMigration('test-token', migrationDraft)).resolves.toEqual(resolution);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/billing\/migration\/resolve$/);
    expect(options.headers.authorization).toBe('Bearer test-token');
    expect(options.headers['X-Slova-Billing-Protocol']).toBe('robokassa-v3');
    expect(options.body).toBe(JSON.stringify(migrationDraft));
  });

  test('aborts billing at 15 seconds and reports a safe timeout code', async () => {
    const backend = jest.requireActual('@/core/net').getBackend();
    globalThis.fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('native network detail')));
    })) as typeof fetch;
    const request = backend.subscription('test-token');
    const rejection = expect(request).rejects.toThrow('timeout');
    jest.advanceTimersByTime(15_000);
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
  });

  test('posts an authenticated email correction without creating a payment', async () => {
    const backend = jest.requireActual('@/core/net').getBackend();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => active });
    globalThis.fetch = fetchMock;
    await expect(backend.updateSubscriptionEmail('test-token', 'corrected@example.ru')).resolves.toEqual(active);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/billing\/email$/);
    expect(options.method).toBe('POST');
    expect(options.headers.authorization).toBe('Bearer test-token');
    expect(options.body).toBe(JSON.stringify({ email: 'corrected@example.ru' }));
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test.each(['billing_mode_conflict', 'billing_notification_rate_limited', 'billing_email_change_pending', 'billing_provider_migration_required', 'billing_client_update_required', 'billing_migration_unresolved', 'billing_personal_data_consent_required'])('preserves approved billing code %s', async (code) => {
    const backend = jest.requireActual('@/core/net').getBackend();
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: code }) });
    await expect(backend.subscription('test-token')).rejects.toThrow(code);
  });
});
