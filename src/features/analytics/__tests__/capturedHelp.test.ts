/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/core/native/appmetrica', () => ({ reportEvent: jest.fn(() => false), isAppMetricaAvailable: jest.fn(() => false),
  isAppMetricaTestDevice: jest.fn(() => false), setDataSendingEnabled: jest.fn(() => true), getDataSendingPreference: () => null,
  getSoftwareBuildInfo: jest.fn(() => ({ versionName: '0.1.29', versionCode: '33' })),
  getAppMetricaIdentifiers: jest.fn(async () => ({ deviceId: '18446744073709551615', installationId: 'fixture_install' })) }));
const T = Date.parse('2026-11-03T09:00:00Z');
const properties = { interaction_id: 'help:origin', origin_interaction_id: 'help:origin', attemptId: 'attempt:one',
  levelKey: 'campaign:6', levelId: 6, mode: 'campaign', contentVersion: 'fixture_content', hint_type: 'letter', requested_hint: 'letter',
  displayed_cost: 50, balance: 20, is_available: true, already_owned: false, previously_completed: false,
  first_eligible_request: true, eligibility_version: 'help_deficit_v1', measurement_phase: 'baseline', eligibility_epoch: 'baseline_fixture', occurredAtMs: T };
async function fixture() {
  jest.resetModules(); Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
  delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE; delete process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
  const store = require('@/core/storage') as typeof import('@/core/storage'); store.storage.clearAll(); require('react-native').Platform.OS = 'android';
  const api = require('../index') as typeof import('../index');
  const sdk = require('../sdkIdentity') as typeof import('../sdkIdentity'); await sdk.primeSdkIdentity();
  return { ...api, ...store, native: require('@/core/native/appmetrica'), sdk };
}
beforeEach(() => { jest.useFakeTimers().setSystemTime(T); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: true }); });
test('capture performs no handoff; retry after build change enqueues exact original envelope once', async () => {
  const f = await fixture(); const fact = f.captureHelpEnrollmentFact('hint_requested', 'fixture:first', properties)!;
  expect(f.isCapturedHelpFact(fact)).toBe(true); expect(f.native.reportEvent).not.toHaveBeenCalled();
  f.native.getSoftwareBuildInfo.mockReturnValue({ versionName: '0.1.34', versionCode: '34' }); jest.setSystemTime(T + 1000);
  expect(f.enqueueCapturedHelpFact(fact)).toBe('accepted'); expect(f.enqueueCapturedHelpFact(fact)).toBe('accepted');
  const queue = f.getJSON<{ outbox: { envelope: Record<string, unknown>; queuedAtMs: number }[] }>('analytics.outbox.v2', { outbox: [] }).outbox;
  expect(queue).toHaveLength(1); expect(queue[0].envelope).toEqual(fact.envelope);
  expect(queue[0].envelope).toMatchObject({ app_version: '0.1.29', app_build: '33', occurredAtMs: T }); expect(queue[0].queuedAtMs).toBe(T);
});
test('restricted captured DTO rejects private extras, arbitrary events, opt-out epochs and expired replay budgets', async () => {
  const f = await fixture();
  expect(f.captureHelpEnrollmentFact('hint_requested', 'fixture:bad', { ...properties, email: 'private@example.test' })).toBeNull();
  const fact = f.captureHelpEnrollmentFact('hint_requested', 'fixture:first', properties)!;
  expect(f.enqueueCapturedHelpFact({ ...fact, envelope: { ...fact.envelope, email: 'private@example.test' } })).toBe('invalid');
  jest.setSystemTime(T + 7 * 86_400_000); expect(f.enqueueCapturedHelpFact(fact)).toBe('expired');
  jest.setSystemTime(T + 1000); f.useAnalyticsPrefs.getState().setOptOut(true); f.useAnalyticsPrefs.getState().setOptOut(false);
  await f.sdk.primeSdkIdentity(); expect(f.enqueueCapturedHelpFact(fact)).toBe('blocked');
});
test.each(['test_device', 'opt_out', 'unknown_native'])('real collection gate blocks identity/capture before assignment: %s', async (condition) => {
  const f = await fixture();
  if (condition === 'test_device') f.native.isAppMetricaTestDevice.mockReturnValue(true);
  if (condition === 'opt_out') f.useAnalyticsPrefs.getState().setOptOut(true);
  if (condition === 'unknown_native') f.native.isAppMetricaTestDevice.mockReturnValue(undefined);
  expect(f.captureHelpEnrollmentFact('hint_requested', 'fixture:first', properties)).toBeNull();
});
test('trial plan/phase/SDK metadata never widens native operational receipt context', async () => {
  await fixture();
  const { selectHelpContext } = require('../helpContext') as typeof import('../helpContext');
  const { isNativeRewardReceipt } = require('@/features/monetization/nativeRewardJournal') as typeof import('@/features/monetization/nativeRewardJournal');
  const context = selectHelpContext({ ...properties, trial_plan_fingerprint: 'a'.repeat(32), assignment_id: 'exp_fixture', device_key: '18446744073709551615' });
  for (const key of ['measurement_phase', 'eligibility_epoch', 'first_eligible_request', 'trial_plan_fingerprint', 'assignment_id', 'device_key']) expect(context).not.toHaveProperty(key);
  const receipt = { version: 1, rewardId: 'reward:fixture', kind: 'coins', createdAtMs: T, offerDay: '2026-11-03', amount: 60, flowContext: context };
  expect(Object.keys(context).length).toBeLessThanOrEqual(24); expect(JSON.stringify(receipt).length).toBeLessThanOrEqual(8192);
  expect(isNativeRewardReceipt(receipt)).toBe(true);
});
