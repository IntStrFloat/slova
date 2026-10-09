/* eslint-disable @typescript-eslint/no-require-imports */

import type { BillingCatalog, SubscriptionStatus } from '@/core/net';

jest.mock('expo-linking', () => ({ openURL: jest.fn(() => Promise.resolve(true)) }));
jest.mock('@/core/platform/yandexGames', () => ({ isYandexGamesBuild: jest.fn(() => false) }));
jest.mock('@/core/net', () => ({ ...jest.requireActual('@/core/net'), getBackend: jest.fn() }));

const now = 1_800_000_000_000;
const day = 86_400_000;
const profile = { userId: 'player-one', authToken: 'test-token', nickname: 'Игрок', tag: '#1' };
const recoveryCode = 'abcdefghijklmnopqrstuvwx12345678';
const confirmationUrl = 'https://yoomoney.ru/api-pages/v2/payment-confirm/epl?orderId=test-payment';
const catalog: BillingCatalog = {
  available: true,
  mode: 'test',
  plan: { id: 'no_ads_30', title: 'Без рекламных пауз', amount: '99.00', currency: 'RUB', periodDays: 30, consentVersion: 'no-ads-30-v1' },
};
const inactive: SubscriptionStatus = {
  active: false, activeUntil: null, autoRenew: false, nextPaymentAt: null,
  pendingPaymentId: null, serverTime: now,
};
const pending = { ...inactive, pendingPaymentId: 'test-payment' };
const active = { ...inactive, active: true, activeUntil: now + day, autoRenew: true, nextPaymentAt: now + day };

function setup(savedEntitlements?: unknown) {
  const { storage, KEYS } = require('@/core/storage');
  storage.clearAll();
  storage.set(KEYS.profile, JSON.stringify(profile));
  if (savedEntitlements) storage.set(KEYS.entitlements, JSON.stringify(savedEntitlements));
  const backend = {
    billingCatalog: jest.fn().mockResolvedValue(catalog),
    subscription: jest.fn().mockResolvedValue(inactive),
    subscriptionCheckout: jest.fn().mockResolvedValue({
      ...pending, paymentId: 'test-payment', confirmationUrl, recoveryCode,
    }),
    cancelSubscription: jest.fn().mockResolvedValue({ ...active, autoRenew: false, nextPaymentAt: null }),
    restoreSubscription: jest.fn().mockResolvedValue(active),
    subscriptionRecovery: jest.fn().mockResolvedValue({ recoveryCode }),
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

  test('requires separate consent and a receipt email before creating any payment', async () => {
    const { useSubscription, backend } = setup();
    expect(await useSubscription.getState().checkout('player@example.ru', false)).toBe(false);
    expect(useSubscription.getState().error).toBe('consent_required');
    expect(await useSubscription.getState().checkout('not-an-email', true)).toBe(false);
    expect(useSubscription.getState().error).toBe('bad_email');
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
  });

  test('rejects malformed domain labels locally and lets a corrected email create the first draft', async () => {
    const { useSubscription, backend } = setup();
    expect(await useSubscription.getState().checkout('a@b..com', true)).toBe(false);
    expect(useSubscription.getState().error).toBe('bad_email');
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(await useSubscription.getState().checkout('a@b.com', true)).toBe(true);
    expect(backend.subscriptionCheckout.mock.calls[0][1].email).toBe('a@b.com');
  });

  test.each(['billing_receipt_email_required', 'billing_bad_request_id'])(
    'definitive checkout validation error %s lets the next explicit attempt use a corrected draft', async (code) => {
      const { useSubscription, backend, storage, KEYS } = setup();
      backend.subscriptionCheckout.mockRejectedValueOnce(new Error(code));
      expect(await useSubscription.getState().checkout('first@example.ru', true)).toBe(false);
      const rejectedRequest = backend.subscriptionCheckout.mock.calls[0][1].requestId;
      expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
      expect(await useSubscription.getState().checkout('corrected@example.ru', true)).toBe(true);
      const nextDraft = backend.subscriptionCheckout.mock.calls[1][1];
      expect(nextDraft.requestId).not.toBe(rejectedRequest);
      expect(nextDraft.email).toBe('corrected@example.ru');
    },
  );

  test('stale consent refreshes the catalog and requires another explicit attempt with the new terms', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    await useSubscription.getState().sync();
    const updatedCatalog = { ...catalog, plan: { ...catalog.plan, consentVersion: 'no-ads-30-v2' } };
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('billing_consent_required'));
    backend.billingCatalog.mockResolvedValue(updatedCatalog);
    expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(false);
    const rejectedDraft = backend.subscriptionCheckout.mock.calls[0][1];
    expect(rejectedDraft.consentVersion).toBe('no-ads-30-v1');
    expect(useSubscription.getState().catalog?.plan.consentVersion).toBe('no-ads-30-v2');
    expect(useSubscription.getState().error).toBe('billing_consent_required');
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(true);
    expect(backend.subscriptionCheckout.mock.calls[1][1].consentVersion).toBe('no-ads-30-v2');
    expect(backend.subscriptionCheckout.mock.calls[1][1].requestId).not.toBe(rejectedDraft.requestId);
  });

  test.each(['billing_gateway_unavailable', 'billing_payment_pending', 'billing_payment_mismatch', 'billing_mode_conflict'])(
    'keeps the original checkout ID after non-validation error %s', async (code) => {
      const { useSubscription, backend, storage, KEYS } = setup();
      backend.subscriptionCheckout.mockRejectedValueOnce(new Error(code));
      expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(false);
      const originalDraft = backend.subscriptionCheckout.mock.calls[0][1];
      expect(JSON.parse(storage.getString(KEYS.subscription)).pending.requestId).toBe(originalDraft.requestId);
      expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(true);
      expect(backend.subscriptionCheckout.mock.calls[1][1]).toEqual(originalDraft);
    },
  );

  test('pending checkout and browser return do not grant no-ads or Pro perks', async () => {
    const { useSubscription, useEntitlements, backend, openURL } = setup();
    expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(true);
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
    expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(true);
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
    expect(await useSubscription.getState().checkout('first@example.ru', true)).toBe(false);
    const first = backend.subscriptionCheckout.mock.calls[0][1];
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending.requestId).toBe(first.requestId);
    await useSubscription.getState().sync();
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending.requestId).toBe(first.requestId);
    expect(await useSubscription.getState().checkout('changed@example.ru', true)).toBe(true);
    expect(backend.subscriptionCheckout.mock.calls[1][1]).toEqual(first);
  });

  test('an authoritative canceled checkout clears its ID and allows a fresh explicit purchase', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    backend.subscriptionCheckout.mockRejectedValueOnce(new Error('billing_checkout_canceled'));
    expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(false);
    const first = backend.subscriptionCheckout.mock.calls[0][1].requestId;
    expect(JSON.parse(storage.getString(KEYS.subscription)).pending).toBeNull();
    expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(true);
    expect(backend.subscriptionCheckout.mock.calls[1][1].requestId).not.toBe(first);
  });

  test('a checkout replay without a newly returned recovery code preserves the saved code', async () => {
    const { useSubscription, backend, storage, KEYS } = setup();
    await useSubscription.getState().checkout('player@example.ru', true);
    backend.subscriptionCheckout.mockResolvedValue({ ...pending, paymentId: 'test-payment', confirmationUrl, recoveryCode: null });
    await useSubscription.getState().checkout('player@example.ru', true);
    expect(useSubscription.getState().recoveryCode).toBe(recoveryCode);
    expect(JSON.parse(storage.getString(KEYS.subscription)).recoveryCode).toBe(recoveryCode);
    expect(backend.subscriptionRecovery).not.toHaveBeenCalled();
  });

  test('only explicit resume reopens pending checkout and replays no purchase success from the URL', async () => {
    const { useSubscription, useEntitlements, backend, openURL } = setup();
    await useSubscription.getState().checkout('player@example.ru', true);
    backend.subscription.mockResolvedValue(pending);
    await useSubscription.getState().sync();
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(await useSubscription.getState().resumeCheckout()).toBe(true);
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(backend.subscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(useEntitlements.getState().removeAds).toBe(false);
    backend.subscription.mockResolvedValue(active);
    await useSubscription.getState().sync();
    expect(useSubscription.getState().confirmationUrl).toBeNull();
    expect(openURL).toHaveBeenCalledTimes(2);
  });

  test.each([
    'javascript:alert(1)', 'http://yoomoney.ru/checkout', 'https://yoomoney.ru.evil.example/checkout',
    'https://yoomoney.ru@evil.example/checkout', 'https://name:password@yoomoney.ru/checkout',
    'https://yoomoney.ru:8443/checkout', 'https://yoomoney.ru\\@evil.example/checkout',
  ])('never opens malformed/untrusted confirmation URL %s', async (url) => {
    const { useSubscription, useEntitlements, backend, openURL } = setup();
    backend.subscriptionCheckout.mockResolvedValue({ ...pending, paymentId: 'test-payment', confirmationUrl: url, recoveryCode });
    expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(false);
    expect(useSubscription.getState().error).toBe('invalid_confirmation_url');
    expect(openURL).not.toHaveBeenCalled();
    expect(useEntitlements.getState().removeAds).toBe(false);
  });

  test('shares an in-flight guard across checkout, sync, cancellation, and restore', async () => {
    const { useSubscription, backend } = setup();
    let finish!: (value: unknown) => void;
    backend.subscriptionCheckout.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const purchase = useSubscription.getState().checkout('player@example.ru', true);
    expect(await useSubscription.getState().cancel()).toBe(false);
    expect(await useSubscription.getState().restore(recoveryCode)).toBe(false);
    await useSubscription.getState().sync();
    await Promise.resolve();
    expect(backend.cancelSubscription).not.toHaveBeenCalled();
    expect(backend.restoreSubscription).not.toHaveBeenCalled();
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
    expect(await useSubscription.getState().checkout('player@example.ru', true)).toBe(false);
    expect(useSubscription.getState().error).toBe('billing_disabled');
    expect(backend.billingCatalog).not.toHaveBeenCalled();
    expect(backend.subscriptionCheckout).not.toHaveBeenCalled();
    expect(useEntitlements.getState().removeAds).toBe(false);
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

  test('posts authenticated checkout with an abortable request and parses only approved error codes', async () => {
    const backend = jest.requireActual('@/core/net').getBackend();
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'billing_receipt_email_required' }) });
    globalThis.fetch = fetchMock;
    await expect(backend.subscriptionCheckout('test-token', { requestId: 'id', email: 'email', consentVersion: 'version' }))
      .rejects.toThrow('billing_receipt_email_required');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.authorization).toBe('Bearer test-token');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.body).toBe(JSON.stringify({ requestId: 'id', email: 'email', consentVersion: 'version' }));
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'private_provider_credentials' }) });
    await expect(backend.billingCatalog()).rejects.toThrow('billing_unavailable');
    expect(jest.getTimerCount()).toBe(0);
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

  test.each(['billing_mode_conflict', 'billing_notification_rate_limited'])('preserves approved billing code %s', async (code) => {
    const backend = jest.requireActual('@/core/net').getBackend();
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: code }) });
    await expect(backend.subscription('test-token')).rejects.toThrow(code);
  });
});
