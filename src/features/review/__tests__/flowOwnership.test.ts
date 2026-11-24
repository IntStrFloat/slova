/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  AppState: { value: { currentState: 'active', addEventListener: jest.fn() } },
}));
jest.mock('../../../../modules/rustore-review', () => ({
  discard: jest.fn(), isAvailable: jest.fn(() => true), hasActiveForm: jest.fn(() => false),
  prepare: jest.fn(async () => true), prepareResult: jest.fn(async () => 'ready'),
  launch: jest.fn(async () => 'completed'),
}));
jest.mock('../config', () => ({ REVIEW_ENABLED: true, REVIEW_DIAGNOSTICS_ENABLED: true }));
jest.mock('@/features/analytics', () => ({ track: jest.fn() }));

const context = { levelId: 10, completedCount: 10, firstCompletion: true, postcardMilestone: true, daily: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}
function fixture() {
  jest.resetModules();
  const storage = require('@/core/storage').storage;
  storage.clearAll();
  const native = require('../../../../modules/rustore-review');
  const { AppState } = require('react-native');
  AppState.currentState = 'active';
  const telemetry = require('@/features/analytics').track;
  return { native, AppState, telemetry, request: require('../index').requestCampaignReview,
    policy: require('../policy'), fullscreen: require('@/core/fullscreen') };
}
beforeEach(() => jest.clearAllMocks());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test.each(['interstitial', 'rewarded', 'checkout', 'update'])('%s suppresses automatic Review without consuming an attempt', async (owner) => {
  const f = fixture();
  const lease = f.fullscreen.tryAcquireFullscreen(owner);
  expect(await f.request(context, () => true)).toBe('unavailable');
  expect(f.policy.readReviewState().attempts).toBe(0);
  expect(f.native.prepareResult).not.toHaveBeenCalled();
  expect(f.telemetry).toHaveBeenCalledWith('review_eligibility', expect.objectContaining({ result: 'suppressed', reason: 'fullscreen_busy' }));
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe(owner);
  f.fullscreen.releaseFullscreen(lease);
});

test('Review owns preparation and the open form across background and arbitrary time', async () => {
  jest.useFakeTimers();
  const f = fixture();
  const terminal = deferred<string>();
  f.native.launch.mockReturnValueOnce(terminal.promise);
  const pending = f.request(context, () => true);
  await jest.advanceTimersByTimeAsync(0);
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('review');
  expect(f.fullscreen.tryAcquireFullscreen('rewarded')).toBeNull();
  f.AppState.currentState = 'background';
  await jest.advanceTimersByTimeAsync(600_000);
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('review');
  terminal.resolve('completed');
  expect(await pending).toBe('completed');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
  expect(f.policy.readReviewState()).toMatchObject({ attempts: 1, handled: true });
  const results = f.telemetry.mock.calls.filter(([name]: [string]) => name === 'review_flow_finished');
  expect(results).toHaveLength(1);
  expect(JSON.stringify(f.telemetry.mock.calls)).not.toMatch(/submitted|posted|stars/);
});

test('safe point is rechecked after preparation and no late form can interrupt a changed game', async () => {
  const f = fixture();
  let safe = true;
  f.native.prepareResult.mockImplementationOnce(async () => { safe = false; return 'ready'; });
  expect(await f.request(context, () => safe)).toBe('unavailable');
  expect(f.native.launch).not.toHaveBeenCalled();
  expect(f.native.discard).toHaveBeenCalled();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
  expect(f.policy.readReviewState().attempts).toBe(1);
});

test('reservation failure and prepare timeout release only their own lease', async () => {
  jest.useFakeTimers();
  const f = fixture();
  const reservation = jest.spyOn(f.policy, 'reserveReviewAttempt').mockImplementationOnce(() => { throw new Error('disk'); });
  expect(await f.request(context, () => true)).toBe('error');
  expect(f.native.prepareResult).not.toHaveBeenCalled();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
  reservation.mockRestore();
  const preparation = deferred<string>();
  f.native.prepareResult.mockReturnValueOnce(preparation.promise);
  const pending = f.request(context, () => true);
  await jest.advanceTimersByTimeAsync(1500);
  expect(await pending).toBe('unavailable');
  const newer = f.fullscreen.tryAcquireFullscreen('checkout');
  preparation.resolve('ready');
  await jest.advanceTimersByTimeAsync(0);
  expect(f.native.launch).not.toHaveBeenCalled();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('checkout');
  f.fullscreen.releaseFullscreen(newer);
});

test('a native form retained by a replaced JS context suppresses a new automatic flow', async () => {
  const f = fixture();
  f.native.hasActiveForm.mockReturnValueOnce(true);
  expect(await f.request(context, () => true)).toBe('unavailable');
  expect(f.policy.readReviewState().attempts).toBe(0);
  expect(f.native.prepareResult).not.toHaveBeenCalled();
});
