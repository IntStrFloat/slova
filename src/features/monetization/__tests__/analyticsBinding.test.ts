/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/features/analytics', () => {
  const state = { optOut: false };
  return { useAnalyticsPrefs: { getState: () => state, subscribe: jest.fn() },
    isAnalyticsCollectionEnabled: jest.fn(() => !state.optOut) };
});
jest.mock('@/core/native/appmetrica', () => ({
  isAppMetricaTestDevice: jest.fn(() => false),
  getAppMetricaIdentifiers: jest.fn(async () => ({ deviceId: '18446744073709551615', installationId: 'sdk-install-1' })),
}));
jest.mock('@/features/profile', () => ({ useProfile: { getState: () => ({
  profile: { userId: 'player-one', authToken: 'PRIVATE_AUTH', nickname: 'PRIVATE_NAME' },
}) } }));
jest.mock('@/core/net', () => ({ getBackend: jest.fn() }));

const devDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
type Binding = { consent: boolean; deviceId?: string; installationId?: string };
type BindingResult = { consent: boolean; bound: boolean };
function fixture() {
  jest.resetModules();
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  const backend = { bindSubscriptionAnalytics: jest.fn<Promise<BindingResult>, [string, Binding]>(
    async () => ({ consent: true, bound: true })) };
  require('@/core/net').getBackend.mockReturnValue(backend);
  const native = require('@/core/native/appmetrica');
  const analytics = require('@/features/analytics');
  const prefs = analytics.useAnalyticsPrefs;
  const { syncSubscriptionAnalyticsBinding: sync } = require('../analyticsBinding');
  const changeConsent = (optOut: boolean) => {
    const previous = { ...prefs.getState() };
    prefs.getState().optOut = optOut;
    prefs.subscribe.mock.calls[0][0](prefs.getState(), previous);
  };
  return { backend, native, prefs, analytics, sync, changeConsent };
}
afterEach(() => {
  if (devDescriptor) Object.defineProperty(globalThis, '__DEV__', devDescriptor);
});

test('binds only the consent and SDK identities, preserving UInt64 as a string', async () => {
  const { backend, sync } = fixture();
  await sync(); await sync();
  expect(backend.bindSubscriptionAnalytics).toHaveBeenCalledTimes(1);
  expect(backend.bindSubscriptionAnalytics).toHaveBeenCalledWith('PRIVATE_AUTH', {
    consent: true, deviceId: '18446744073709551615', installationId: 'sdk-install-1',
  });
  expect(JSON.stringify(backend.bindSubscriptionAnalytics.mock.calls[0][1])).not.toMatch(/PRIVATE_AUTH|PRIVATE_NAME|player-one/);
});

test('opt-out during an ID lookup sends only a revoked binding', async () => {
  const { backend, native, sync, changeConsent } = fixture();
  let finish!: (value: unknown) => void;
  native.getAppMetricaIdentifiers.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = sync();
  await Promise.resolve(); await Promise.resolve();
  changeConsent(true);
  finish({ deviceId: '123', installationId: 'private-install' });
  backend.bindSubscriptionAnalytics.mockResolvedValue({ consent: false, bound: false });
  await first; await sync();
  expect(backend.bindSubscriptionAnalytics).toHaveBeenCalledTimes(1);
  expect(backend.bindSubscriptionAnalytics.mock.calls[0][1]).toEqual({ consent: false });
});

test('a pending opt-in request cannot overwrite the later opt-out', async () => {
  const { backend, sync, changeConsent } = fixture();
  let finish!: (value: BindingResult) => void;
  backend.bindSubscriptionAnalytics.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const first = sync();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  changeConsent(true);
  finish({ consent: true, bound: true });
  backend.bindSubscriptionAnalytics.mockResolvedValue({ consent: false, bound: false });
  await first; await sync();
  expect(backend.bindSubscriptionAnalytics.mock.calls.map((call: [string, { consent: boolean }]) => call[1].consent)).toEqual([true, false]);
});

test('binding failure is non-fatal and is retried on the next synchronization', async () => {
  const { backend, sync } = fixture();
  backend.bindSubscriptionAnalytics.mockRejectedValueOnce(new Error('offline'));
  await expect(sync()).resolves.toBeUndefined();
  await sync();
  expect(backend.bindSubscriptionAnalytics).toHaveBeenCalledTimes(2);
});

test('QA devices clear an association and never request analytics identities', async () => {
  const { backend, native, analytics, sync } = fixture();
  native.isAppMetricaTestDevice.mockReturnValue(true);
  analytics.isAnalyticsCollectionEnabled.mockReturnValue(false);
  backend.bindSubscriptionAnalytics.mockResolvedValue({ consent: false, bound: false });
  await sync();
  expect(native.getAppMetricaIdentifiers).not.toHaveBeenCalled();
  expect(backend.bindSubscriptionAnalytics.mock.calls[0][1]).toEqual({ consent: false });
});

test('concurrent billing polls share bounded work instead of queuing a request per poll', async () => {
  const { backend, native, sync } = fixture();
  let finish!: (value: unknown) => void;
  native.getAppMetricaIdentifiers.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = sync();
  for (let i = 0; i < 100; i += 1) expect(sync()).toBe(first);
  finish({ deviceId: '123', installationId: 'installation-1' });
  await first;
  expect(backend.bindSubscriptionAnalytics).toHaveBeenCalledTimes(1);
  expect(native.getAppMetricaIdentifiers.mock.calls.length).toBeLessThanOrEqual(2);
});
