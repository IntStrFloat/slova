/* eslint-disable @typescript-eslint/no-require-imports */
const mockReport = jest.fn<boolean, unknown[]>(() => true);
const mockRead = jest.fn<Promise<import('../nativeRewardJournal').NativeRewardReceipt[]>, []>(async () => []);
const mockAck = jest.fn<Promise<void>, [string]>(async () => {});
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: (...args: unknown[]) => mockReport(...args), isAppMetricaAvailable: () => true,
  isAppMetricaTestDevice: () => false, setDataSendingEnabled: () => true, getDataSendingPreference: () => null,
}));
jest.mock('../nativeRewardJournal', () => ({
  readNativeEarnedRewards: () => mockRead(), acknowledgeNativeReward: (id: string) => mockAck(id),
}));

function runtime(alreadyApplied = false) {
  const saved = require('@/core/storage') as typeof import('@/core/storage');
  saved.storage.clearAll();
  saved.storage.set(saved.KEYS.currency, JSON.stringify({ version: 2, coins: alreadyApplied ? 60 : 0, gems: 0,
    newProfile: false, appliedRewards: alreadyApplied ? { reward1: 1 } : {} }));
  return { saved, analytics: require('@/features/analytics') as typeof import('@/features/analytics'),
    wallet: require('@/features/currency') as typeof import('@/features/currency'),
    wheel: require('@/features/wheel') as typeof import('@/features/wheel'),
    recovery: require('../rewardRecovery') as typeof import('../rewardRecovery'),
    telemetry: require('../adTelemetry') as typeof import('../adTelemetry') };
}
function facts(stage: string) {
  return mockReport.mock.calls.filter(([name, props]) => name === 'ad_lifecycle'
    && (props as Record<string, unknown>).stage === stage).map(([, props]) => props as Record<string, unknown>);
}
const receipt = () => ({ version: 1 as const, kind: 'coins' as const, rewardId: 'reward1', amount: 60,
  offerDay: '2026-11-04', createdAtMs: Date.now() - 10_000, earnedAtMs: Date.now(),
  flowContext: { opportunity_id: 'ao1', request_id: 'ar1', interaction_id: 'tap1', origin_interaction_id: 'origin1' } });

beforeEach(() => {
  jest.resetModules(); jest.useFakeTimers().setSystemTime(new Date('2026-11-04T10:00:00Z'));
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
  mockReport.mockReset().mockReturnValue(true); mockRead.mockReset(); mockAck.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks(); jest.useRealTimers();
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: true });
});

test.each([false, true])('old ack retry cannot resurrect a pre-consent grant (private proof purged=%s)', async (purge) => {
  const app = runtime(); const earned = receipt();
  mockRead.mockResolvedValue([earned]); mockAck.mockRejectedValueOnce(new Error('ack unavailable'));
  await app.recovery.recoverRewardedGrants();
  const transaction = app.wallet.useCurrency.getState().getTransaction('reward1')!;
  expect(app.wallet.useCurrency.getState().coins).toBe(60);
  expect(facts('grant_persisted')).toHaveLength(1);
  expect(facts('grant_persisted')[0]).toMatchObject({ transaction_id: transaction.id,
    occurredAtMs: transaction.occurredAtMs, occurred_at: '2026-11-04T10:00:00.000Z', recovery: true, timeKnown: true });
  app.analytics.useAnalyticsPrefs.getState().setOptOut(true);
  if (purge) app.wallet.flushWalletAnalytics();
  jest.setSystemTime(Date.now() + 60_000);
  app.analytics.useAnalyticsPrefs.getState().setOptOut(false);
  mockReport.mockClear();
  await app.recovery.recoverRewardedGrants();
  expect(facts('reward')).toHaveLength(0);
  expect(facts('grant_persisted')).toHaveLength(0);
  expect(app.wallet.useCurrency.getState().coins).toBe(60);
  expect(mockAck).toHaveBeenCalledTimes(2);
});

test('a genuine new wallet commit after opt-in keeps its actual grant time even when earned was earlier', async () => {
  const app = runtime(); const earned = receipt();
  app.analytics.useAnalyticsPrefs.getState().setOptOut(true);
  jest.setSystemTime(Date.now() + 60_000);
  app.analytics.useAnalyticsPrefs.getState().setOptOut(false);
  mockRead.mockResolvedValue([earned]); mockReport.mockClear();
  await app.recovery.recoverRewardedGrants();
  const transaction = app.wallet.useCurrency.getState().getTransaction('reward1')!;
  expect(app.wallet.useCurrency.getState().coins).toBe(60);
  expect(facts('reward')).toHaveLength(0);
  expect(facts('grant_persisted')).toHaveLength(1);
  expect(facts('grant_persisted')[0]).toMatchObject({ transaction_id: transaction.id,
    occurred_at: '2026-11-04T10:01:00.000Z', occurredAtMs: transaction.occurredAtMs });
});

test('an applied legacy reward without an original transaction clock is acknowledged without inventing a new grant', async () => {
  const app = runtime(true);
  mockRead.mockResolvedValue([receipt()]);
  await app.recovery.recoverRewardedGrants();
  expect(app.wallet.useCurrency.getState().getTransaction('reward1')).toBeNull();
  expect(facts('grant_persisted')).toHaveLength(0);
  expect(app.wallet.useCurrency.getState().coins).toBe(60);
  expect(mockAck).toHaveBeenCalledWith('reward1');
});

test('a receipt with unknown earned time stays unknown rather than being stamped as a fresh reward', () => {
  const app = runtime();
  app.telemetry.trackRewardReceipt({ ...receipt(), earnedAtMs: undefined }, 'reward');
  expect(facts('reward')).toHaveLength(1);
  expect(facts('reward')[0]).toMatchObject({ recovery: true, timeKnown: false, time_trust: 'occurrence_unknown' });
});

test.each([false, true])('old wallet credit cannot become a fresh wheel revision2 after failed claim (proof purged=%s)', async (purge) => {
  const app = runtime(); app.wheel.useWheel.getState().reset();
  const prepared = app.wheel.useWheel.getState().prepareRewarded({
    ...receipt().flowContext, attemptId: 'attempt1', requested_hint: 'letter', displayed_cost: 50,
  })!;
  const earned = { ...prepared, earnedAtMs: Date.now() };
  mockRead.mockResolvedValue([earned]);
  const write = app.saved.storage.set.bind(app.saved.storage);
  const failure = jest.spyOn(app.saved.storage, 'set').mockImplementation((key, value) => {
    if (key === app.saved.KEYS.wheel && typeof value === 'string' && JSON.parse(value).grantedSpins?.[earned.rewardId])
      throw new Error('claim unavailable');
    return write(key, value);
  });
  expect((await app.recovery.recoverRewardedGrants()).pending).toHaveLength(1);
  expect(app.wallet.useCurrency.getState().coins).toBe(earned.amount);
  expect(app.wheel.useWheel.getState().pendingSpin?.effectId).toBe(earned.rewardId);
  expect(mockAck).not.toHaveBeenCalled(); failure.mockRestore();
  app.analytics.useAnalyticsPrefs.getState().setOptOut(true);
  if (purge) app.wallet.flushWalletAnalytics();
  jest.setSystemTime(Date.now() + 60_000);
  app.analytics.useAnalyticsPrefs.getState().setOptOut(false); mockReport.mockClear();
  expect((await app.recovery.recoverRewardedGrants()).pending).toHaveLength(0);
  expect(app.wallet.useCurrency.getState().coins).toBe(earned.amount);
  expect(app.wheel.useWheel.getState().pendingSpin).toBeNull();
  expect(facts('grant_persisted')).toHaveLength(0);
  expect(mockReport.mock.calls.filter(([name, props]) => name === 'wheel_spin_result'
    && (props as Record<string, unknown>).result_revision === 2)).toHaveLength(0);
  expect(mockAck).toHaveBeenCalledWith(earned.rewardId);
});

test('a legacy wheel receipt with unknown earned clock cannot backfill start/pending after opt-in', async () => {
  const app = runtime(); app.wheel.useWheel.getState().reset();
  const unknownEarned = app.wheel.useWheel.getState().prepareRewarded({ ...receipt().flowContext })!;
  expect(unknownEarned.earnedAtMs).toBeUndefined();
  app.analytics.useAnalyticsPrefs.getState().setOptOut(true);
  jest.setSystemTime(Date.now() + 60_000);
  app.analytics.useAnalyticsPrefs.getState().setOptOut(false);
  mockRead.mockResolvedValue([unknownEarned]); mockReport.mockClear();
  await app.recovery.recoverRewardedGrants();
  expect(app.wallet.useCurrency.getState().coins).toBe(unknownEarned.amount);
  expect(mockReport.mock.calls.filter(([name]) => name === 'wheel_spin_started')).toHaveLength(0);
  expect(mockReport.mock.calls.filter(([name, props]) => name === 'wheel_spin_result'
    && (props as Record<string, unknown>).result_revision === 1)).toHaveLength(0);
  expect(facts('reward')).toHaveLength(0);
  expect(facts('grant_persisted')).toHaveLength(1);
  expect(mockAck).toHaveBeenCalledWith(unknownEarned.rewardId);
});
