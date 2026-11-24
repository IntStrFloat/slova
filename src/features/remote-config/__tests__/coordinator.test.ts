import { DEFAULT_POLICY, getRuntimePolicy, resetRuntimePolicy, setAttemptPolicy } from '@/core/config/runtimePolicy';
import { createRemoteConfigCoordinator, REMOTE_CONFIG_ACTIVE_KEY, type RemoteConfigDependencies } from '../coordinator';

const assignment = { experiment_id: 'ad_delay', assignment_id: 'exp_test', variant: 'candidate', allocation_version: 1 };
const json = JSON.stringify({ schema_version: 1, config_version: 'test_v1', fetch_enabled: true,
  experiment_id: 'ad_delay', allocation_version: 1,
  variants: { control: { ads_interstitial_interval_seconds: 300 }, candidate: { ads_interstitial_interval_seconds: 600 } } });

function setup(overrides: Partial<RemoteConfigDependencies> = {}) {
  const data = new Map<string, string>();
  const deps: RemoteConfigDependencies = {
    enabled: true, now: () => Date.now(), scope: () => 'profile_a', consent: () => true,
    assignment: () => assignment,
    fetch: jest.fn(async () => ({ status: 'success' as const, json })),
    read: (key) => data.get(key) ?? null,
    write: (key, value) => { data.set(key, value); return data.get(key) === value; },
    remove: (key) => { data.delete(key); }, event: jest.fn(), exposure: jest.fn(), ...overrides,
  };
  return { data, deps, controller: createRemoteConfigCoordinator(deps) };
}

beforeEach(() => { resetRuntimePolicy(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-02T12:00:00Z')); });
afterEach(() => jest.useRealTimers());

test('late fetch stages without changing a running attempt; only safe boundary applies then exposure is use-only', async () => {
  let finish!: (result: { status: 'success'; json: string }) => void;
  const { controller, deps } = setup({ fetch: jest.fn(() => new Promise((resolve) => { finish = resolve; })) });
  controller.start();
  const pending = controller.refresh();
  setAttemptPolicy(DEFAULT_POLICY);
  finish({ status: 'success', json }); await pending;
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(300);
  expect(controller.applyAtSafePoint(false)).toBe(false);
  expect(deps.exposure).not.toHaveBeenCalled();
  setAttemptPolicy(null);
  expect(controller.applyAtSafePoint(true)).toBe(true);
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  expect(deps.exposure).not.toHaveBeenCalled();
  controller.used('ads_interstitial_interval_seconds', 'interstitial_policy');
  controller.used('ads_interstitial_interval_seconds', 'interstitial_policy');
  expect(deps.exposure).toHaveBeenCalledTimes(1);
});

test('timeout leaves startup/control available and ignores the eventual callback', async () => {
  let finish!: (result: { status: 'success'; json: string }) => void;
  const { controller, deps } = setup({ fetch: jest.fn(() => new Promise((resolve) => { finish = resolve; })) });
  controller.start(); const pending = controller.refresh();
  await jest.advanceTimersByTimeAsync(4000); await pending;
  finish({ status: 'success', json }); await Promise.resolve();
  expect(controller.applyAtSafePoint(true)).toBe(false);
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  expect(deps.event).toHaveBeenCalledWith('config_fetch_result', expect.objectContaining({ result: 'timeout', fallback_used: true }));
});

test('restart restores durable active policy, fresh cached pending config still waits; expired/corrupt state falls back', async () => {
  const { controller, deps, data } = setup(); controller.start(); await controller.refresh(); controller.applyAtSafePoint(true);
  resetRuntimePolicy(); const next = createRemoteConfigCoordinator(deps); next.start();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  expect(deps.exposure).not.toHaveBeenCalled();
  jest.advanceTimersByTime(7 * 86_400_000 + 1); resetRuntimePolicy(); createRemoteConfigCoordinator(deps).start();
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  for (const key of data.keys()) data.set(key, '{invalid');
  resetRuntimePolicy(); createRemoteConfigCoordinator(deps).start();
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
});

test('profile/consent changes invalidate delayed result, active snapshot and cache; no foreign configuration transfers', async () => {
  let scope = 'profile_a', consent = true;
  let finish!: (result: { status: 'success'; json: string }) => void;
  const { controller, deps } = setup({ scope: () => scope, consent: () => consent,
    fetch: jest.fn(() => new Promise((resolve) => { finish = resolve; })) });
  controller.start(); const pending = controller.refresh(); scope = 'profile_b'; controller.identityChanged();
  finish({ status: 'success', json }); await pending;
  expect(controller.applyAtSafePoint(true)).toBe(false);
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  consent = false; controller.identityChanged(); await controller.refresh();
  expect(deps.fetch).toHaveBeenCalledTimes(1);
});

test('failed durable write never applies new policy; a missing or foreign assignment stays control', async () => {
  const failed = setup({ write: () => false }); failed.controller.start(); await failed.controller.refresh();
  expect(failed.controller.applyAtSafePoint(true)).toBe(false);
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  const unassigned = setup({ assignment: () => null }); unassigned.controller.start(); await unassigned.controller.refresh();
  expect(unassigned.controller.applyAtSafePoint(true)).toBe(false);
});

test('ending an experiment preserves an already pinned attempt, while new attempts return to control', async () => {
  let active = true;
  const { controller } = setup({ assignment: () => active ? assignment : null, pinnedAssignment: () => true });
  controller.start(); await controller.refresh(); controller.applyAtSafePoint(true);
  setAttemptPolicy(getRuntimePolicy()); active = false;
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  setAttemptPolicy(null);
  expect(getRuntimePolicy().values).toEqual(DEFAULT_POLICY.values);
});

test('an older lifecycle owner cannot disable or clear the newer coordinator', async () => {
  const first = setup(); first.controller.start(); await first.controller.refresh(); first.controller.applyAtSafePoint(true);
  const second = createRemoteConfigCoordinator(first.deps); second.start();
  first.controller.stop();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  first.controller.identityChanged(); await first.controller.refresh();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  expect(first.deps.fetch).toHaveBeenCalledTimes(1);
});

test('active snapshot persistence is reserved before apply and can retry without changing current gameplay', async () => {
  const fixture = setup(), originalWrite = fixture.deps.write;
  fixture.deps.write = (key, value) => key !== REMOTE_CONFIG_ACTIVE_KEY && originalWrite(key, value);
  fixture.controller.start(); await fixture.controller.refresh();
  expect(fixture.controller.applyAtSafePoint(true)).toBe(false);
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  fixture.deps.write = originalWrite;
  expect(fixture.controller.applyAtSafePoint(true)).toBe(true);
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
});

test('remote stop-fetch stages control at a safe point and stops further requests across restart', async () => {
  const fixture = setup(); fixture.controller.start(); await fixture.controller.refresh(); fixture.controller.applyAtSafePoint(true);
  jest.advanceTimersByTime(15 * 60_000);
  fixture.deps.fetch = jest.fn(async () => ({ status: 'success' as const,
    json: JSON.stringify({ schema_version: 1, config_version: 'stop_v1', fetch_enabled: false }) }));
  await fixture.controller.refresh();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  fixture.controller.applyAtSafePoint(true);
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  jest.advanceTimersByTime(15 * 60_000); await fixture.controller.refresh();
  expect(fixture.deps.fetch).toHaveBeenCalledTimes(1);
  const restarted = createRemoteConfigCoordinator(fixture.deps); restarted.start();
  await restarted.refresh();
  expect(fixture.deps.fetch).toHaveBeenCalledTimes(1);
});

test('resident process TTL keeps the old pin, then applies control at the next boundary after an offline refresh', async () => {
  const fixture = setup({ pinnedAssignment: () => true }); fixture.controller.start();
  await fixture.controller.refresh(); fixture.controller.applyAtSafePoint(true);
  setAttemptPolicy(getRuntimePolicy());
  jest.advanceTimersByTime(8 * 86_400_000);
  fixture.deps.fetch = jest.fn(async () => ({ status: 'retryable' as const, reason: 'network' }));
  await fixture.controller.refresh();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  setAttemptPolicy(null); fixture.controller.applyAtSafePoint(true);
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  expect(fixture.deps.event).toHaveBeenCalledWith('config_apply_result', expect.objectContaining({ reason: 'cache_expired', age_bucket: 'expired' }));
});

test('an identical day-six refresh renews durable active provenance without replacing the attempt pin', async () => {
  const fixture = setup({ pinnedAssignment: () => true }); fixture.controller.start();
  await fixture.controller.refresh(); fixture.controller.applyAtSafePoint(true);
  setAttemptPolicy(getRuntimePolicy()); const pin = getRuntimePolicy();
  jest.advanceTimersByTime(6 * 86_400_000);
  await fixture.controller.refresh(); fixture.controller.applyAtSafePoint(true);
  expect(getRuntimePolicy()).toBe(pin);
  expect(JSON.parse(fixture.data.get(REMOTE_CONFIG_ACTIVE_KEY)!).fetchedAt).toBe(Date.now());
  expect(fixture.deps.exposure).not.toHaveBeenCalled();
  jest.advanceTimersByTime(2 * 86_400_000);
  fixture.deps.fetch = jest.fn(async () => ({ status: 'retryable' as const, reason: 'network' }));
  await fixture.controller.refresh();
  expect(getRuntimePolicy()).toBe(pin);
  setAttemptPolicy(null); fixture.controller.applyAtSafePoint(true);
  expect(getRuntimePolicy()).toMatchObject({ configVersion: 'test_v1', values: { ads_interstitial_interval_seconds: 600 } });
  expect(fixture.deps.exposure).not.toHaveBeenCalled();
});

test('a resident cached stop-fetch expires after seven days and permits the next bounded request', async () => {
  const fixture = setup({ fetch: jest.fn(async () => ({ status: 'success' as const,
    json: JSON.stringify({ schema_version: 1, config_version: 'stop_v1', fetch_enabled: false }) })) });
  fixture.controller.start(); await fixture.controller.refresh(); fixture.controller.applyAtSafePoint(true);
  jest.advanceTimersByTime(7 * 86_400_000 - 1); await fixture.controller.refresh();
  expect(fixture.deps.fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1); await fixture.controller.refresh();
  expect(fixture.deps.fetch).toHaveBeenCalledTimes(2);
});

test('disabled feature does not fetch or adopt cached values; error retains last valid policy and fetch has TTL', async () => {
  const disabled = setup({ enabled: false }); disabled.controller.start(); await disabled.controller.refresh();
  expect(disabled.deps.fetch).not.toHaveBeenCalled();
  resetRuntimePolicy();
  const live = setup(); live.controller.start(); await live.controller.refresh(); live.controller.applyAtSafePoint(true);
  await live.controller.refresh(); expect(live.deps.fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(15 * 60_000);
  live.deps.fetch = jest.fn(async () => ({ status: 'retryable' as const, reason: 'network' }));
  await live.controller.refresh();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
});
