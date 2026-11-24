/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: jest.fn(() => true),
  isAppMetricaAvailable: jest.fn(() => true),
  isAppMetricaTestDevice: jest.fn(() => false),
}));

const devDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
const originalQA = process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE;
const originalAdsQA = process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;

function setup() {
  jest.resetModules();
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE;
  delete process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
  const storage = require('@/core/storage') as typeof import('@/core/storage');
  storage.storage.clearAll();
  const native = require('@/core/native/appmetrica');
  const analytics = require('@/features/analytics') as typeof import('@/features/analytics');
  const helper = require('../subscription') as typeof import('../subscription');
  return { ...helper, ...storage, native, analytics };
}

afterEach(() => {
  if (devDescriptor) Object.defineProperty(globalThis, '__DEV__', devDescriptor);
  if (originalQA === undefined) delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE;
  else process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE = originalQA;
  if (originalAdsQA === undefined) delete process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
  else process.env.EXPO_PUBLIC_YANDEX_TEST_ADS = originalAdsQA;
});

test('sends a production funnel event with the existing anonymous envelope and bounded properties', () => {
  const { trackSubscription, native } = setup();
  trackSubscription('subscription_form_opened', { source: 'settings', mode: 'live', stage: 'form', amount: 99, periodDays: 30 });
  expect(native.reportEvent).toHaveBeenCalledWith('subscription_form_opened', expect.objectContaining({
    app_version: expect.any(String),
    source: 'settings', mode: 'live', stage: 'form', amount: 99, periodDays: 30,
  }));
});

test.each(['development', 'explicit_qa', 'test_ads', 'native_test_device', 'persisted_qa', 'opt_out', 'test_billing'])(
  'never queues or sends production subscription events for %s', (kind) => {
    const { trackSubscription, trackSubscriptionCheckoutAction, native, analytics, setSubscriptionAnalyticsTestDevice, getString } = setup();
    if (kind === 'development') Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
    if (kind === 'explicit_qa') process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE = '1';
    if (kind === 'test_ads') process.env.EXPO_PUBLIC_YANDEX_TEST_ADS = '1';
    if (kind === 'native_test_device') native.isAppMetricaTestDevice.mockReturnValue(true);
    if (kind === 'persisted_qa') setSubscriptionAnalyticsTestDevice(true);
    if (kind === 'opt_out') analytics.useAnalyticsPrefs.getState().setOptOut(true);
    trackSubscription('subscription_payment_confirmed', { source: 'home_card', mode: kind === 'test_billing' ? 'test' : 'live' }, 'invoice:7');
    const checkout = { interactionId: 'si_checkout_1_test', source: 'settings', mode: kind === 'test_billing' ? 'test' : 'live' };
    trackSubscriptionCheckoutAction(checkout);
    trackSubscriptionCheckoutAction(checkout, 'accepted');
    expect(native.reportEvent).not.toHaveBeenCalled();
    expect(getString('analytics.outbox.v2') ?? '').not.toContain('subscription_payment_confirmed');
    expect(getString('analytics.outbox.v2') ?? '').not.toContain('subscription_checkout');
  },
);

test('counts real production unavailability while keeping test billing excluded', () => {
  const { trackSubscription, native } = setup();
  trackSubscription('subscription_error', { mode: 'disabled', stage: 'shop', reason: 'catalog_unavailable' });
  expect(native.reportEvent).toHaveBeenCalledWith('subscription_error', expect.objectContaining({
    source: 'direct', mode: 'disabled', stage: 'shop', reason: 'catalog_unavailable',
  }));
});

test('drops contacts, identifiers, signed URLs, exceptions and arbitrary category values before persistence', () => {
  const { trackSubscription, native, getString, normalizeSubscriptionReason, normalizeSubscriptionSource } = setup();
  native.isAppMetricaAvailable.mockReturnValue(false);
  trackSubscription('subscription_error', {
    source: 'owner@example.ru', mode: 'https://private.example.ru', stage: 'my_secret', reason: 'Bearer_auth_token',
    result: 'my_recovery_code', trigger: 'my_invoice', email: 'owner@example.ru',
    url: 'https://auth.robokassa.ru/Merchant/Index.aspx?SignatureValue=secret',
    requestId: 'secret_request_id', error: new Error('private body'), amount: Number.NaN, periodDays: -1,
  });
  const saved = getString('analytics.outbox.v2')!;
  expect(saved).not.toMatch(/owner@example|private\.example|Bearer|recovery_code|my_invoice|secret|private body/);
  const queued = JSON.parse(saved).outbox[0];
  expect(queued.envelope).toMatchObject({ source: 'direct', mode: 'unknown', stage: 'unknown', reason: 'unknown', result: 'unknown', trigger: 'unknown' });
  expect(normalizeSubscriptionReason(new Error('network'))).toBe('unknown');
  expect(normalizeSubscriptionReason('billing_gateway_unavailable')).toBe('billing_gateway_unavailable');
  expect(normalizeSubscriptionSource(['settings'])).toBe('direct');
});

test('confirmed invoice dedupe survives restart and does not expose invoice IDs in event properties', () => {
  const { trackSubscription, native, storage: localStore } = setup();
  const id = trackSubscription('subscription_payment_confirmed', { source: 'post_ad', mode: 'live', amount: 99 }, 'invoice:7');
  expect(id).toMatch(/^e_/);
  expect(trackSubscription('subscription_payment_confirmed', { mode: 'live' }, 'invoice:7')).toBe(id);
  expect(native.reportEvent).toHaveBeenCalledTimes(1);
  const saved = localStore.getAllKeys().map((key) => [key, localStore.getString(key)] as const);
  jest.isolateModules(() => {
    const storage = require('@/core/storage') as typeof import('@/core/storage');
    for (const [key, value] of saved) if (value !== undefined) storage.setString(key, value);
    const again = require('../subscription') as typeof import('../subscription');
    const reloadedNative = require('@/core/native/appmetrica');
    const sentBefore = reloadedNative.reportEvent.mock.calls.length;
    expect(again.trackSubscription('subscription_payment_confirmed', { mode: 'live' }, 'invoice:7')).toBe(id);
    expect(reloadedNative.reportEvent).toHaveBeenCalledTimes(sentBefore);
  });
  expect(native.reportEvent.mock.calls[0][1]).toMatchObject({ source: 'post_ad', mode: 'live', amount: 99 });
});

test('an invalid dedupe key and unavailable native telemetry cannot affect payment execution', () => {
  const { trackSubscription, native } = setup();
  expect(() => trackSubscription('subscription_error', { reason: 'network' }, 'email@example.ru')).not.toThrow();
  expect(native.reportEvent).not.toHaveBeenCalled();
  native.isAppMetricaTestDevice.mockImplementation(() => { throw new Error('native unavailable'); });
  expect(() => trackSubscription('subscription_checkout_started', { mode: 'live' })).not.toThrow();
  expect(native.reportEvent).not.toHaveBeenCalled();
});

test('new management and entitlement contracts survive both privacy boundaries as flat v3 events', () => {
  const { trackSubscription, native } = setup();
  trackSubscription('subscription_manage_action', { mode: 'live', source: 'settings',
    operation_id: 'operation_1', action: 'cancel_auto_renew', stage: 'cancel', result: 'succeeded',
    normalized_reason: 'unknown', email: 'PRIVATE@example.ru' });
  trackSubscription('subscription_entitlement_changed', { mode: 'live', entitlement_revision: 'entitlement_1',
    old_status: 'inactive', new_status: 'active', policy_version: 'server_verified_v1' });
  expect(native.reportEvent).toHaveBeenCalledWith('subscription_manage_action', expect.objectContaining({
    schema_version: 3, operation_id: 'operation_1', action: 'cancel_auto_renew', stage: 'cancel', result: 'succeeded',
  }));
  expect(native.reportEvent).toHaveBeenCalledWith('subscription_entitlement_changed', expect.objectContaining({
    schema_version: 3, entitlement_revision: 'entitlement_1', old_status: 'inactive', new_status: 'active',
  }));
  expect(JSON.stringify(native.reportEvent.mock.calls)).not.toContain('PRIVATE@example.ru');
});

test.each(['empty_email', 'bad_email', 'consent_required', 'personal_data_consent_required', 'profile_unavailable', 'catalog_unavailable', 'accepted'] as const)(
  'final intent and %s validation survive the schema with one press identity', (validation) => {
    const { trackSubscriptionCheckoutAction, native } = setup();
    const context = { interactionId: 'si_checkout_1_test', source: 'post_ad', mode: 'live',
      email: 'PRIVATE@example.ru', consentIdentity: 'PRIVATE catalog/legal identity', profileId: 'PRIVATE-owner',
      url: 'https://private.example.ru/token', serverText: 'PRIVATE server body' };
    trackSubscriptionCheckoutAction(context);
    trackSubscriptionCheckoutAction(context, validation);
    const actions = native.reportEvent.mock.calls.filter(([event]: [string]) => event === 'ui_action');
    expect(actions).toHaveLength(2);
    expect(actions[0][1]).toMatchObject({ schema_version: 3, interaction_id: context.interactionId,
      screen: 'shop', element_id: 'subscription_checkout', action: 'press', outcome: 'started', entry_source: 'post_ad' });
    expect(actions[1][1]).toMatchObject({ schema_version: 3, interaction_id: context.interactionId,
      screen: 'shop', element_id: 'subscription_checkout', action: 'validate',
      outcome: validation === 'accepted' ? 'accepted' : 'rejected', entry_source: 'post_ad' });
    if (validation === 'accepted') expect(actions[1][1]).not.toHaveProperty('blocked_reason');
    else expect(actions[1][1].blocked_reason).toBe(validation);
    expect(actions.filter(([, payload]: [string, { action: string }]) => payload.action === 'press')).toHaveLength(1);
    expect(JSON.stringify(native.reportEvent.mock.calls)).not.toMatch(/PRIVATE|example\.ru|serverText|consentIdentity|profileId|https:/);
  },
);

test('only generated subscription interaction IDs may cross the checkout telemetry boundary', () => {
  const { trackSubscription, trackSubscriptionCheckoutAction, native, getString } = setup();
  native.isAppMetricaAvailable.mockReturnValue(false);
  trackSubscription('subscription_checkout_started', { mode: 'live', interaction_id: 'si_checkout_1_test' });
  const saved = getString('analytics.outbox.v2')!;
  expect(JSON.parse(saved).outbox[0].envelope.interaction_id).toBe('si_checkout_1_test');
  for (const interactionId of ['PRIVATE-owner', 'token', 'payer@example.ru', 'https://private/token', 'si_bad_1_private secret']) {
    trackSubscription('subscription_error', { mode: 'live', reason: 'network', interaction_id: interactionId });
    trackSubscriptionCheckoutAction({ interactionId, mode: 'live' });
  }
  trackSubscriptionCheckoutAction({ interactionId: 'si_checkout_1_test', mode: 'live' }, 'PRIVATE reason' as never);
  const all = getString('analytics.outbox.v2')!;
  expect(all).not.toMatch(/PRIVATE|token|payer@example|https:|private secret/);
  expect(JSON.parse(all).outbox.filter(({ event }: { event: string }) => event === 'ui_action')).toHaveLength(0);
  expect(native.reportEvent).not.toHaveBeenCalled();
});

test('a native telemetry failure cannot break final-button validation', () => {
  const { trackSubscriptionCheckoutAction, native } = setup();
  native.isAppMetricaTestDevice.mockImplementation(() => { throw new Error('PRIVATE native exception'); });
  expect(() => trackSubscriptionCheckoutAction({ interactionId: 'si_checkout_1_test', mode: 'live' }, 'empty_email')).not.toThrow();
  expect(native.reportEvent).not.toHaveBeenCalled();
});
