import { HELP_EXPERIMENT_ID } from '@/core/config/helpExperiment';
import { createHelpExperimentStopAdapter, HELP_STOP_LEASE_MS, HELP_STOP_POLL_MS, HELP_STOP_TIMEOUT_MS,
  parseHelpExperimentStopDocument, type HelpExperimentStopAdapterOptions, type StopContext, type StopFact,
  type StopScope, type StopVariant } from '../helpExperimentStop';
import type { HelpExperimentControlFetchResult } from '../../../../modules/rustore-remote-config';

const mockNativeFetch = jest.fn<Promise<HelpExperimentControlFetchResult>, []>();
const mockSharedAllowed = jest.fn();
const mockLegacyFetch = jest.fn();
jest.mock('../../../../modules/rustore-remote-config', () => ({ fetchHelpExperimentControl: () => mockNativeFetch(),
  setRemoteConfigAllowed: (...args: unknown[]) => mockSharedAllowed(...args), fetchRemotePolicy: () => mockLegacyFetch() }));

const scope: StopScope = { experimentId: HELP_EXPERIMENT_ID, eligibilityEpoch: 'fixture-trial-v1', allocationVersion: 1 };
const context: StopContext = { active: true, foreground: true, consentGranted: true, scope, consentGeneration: 1 };
const payload = (change: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 1, ...scope, revision: 1, disabledVariants: [], ...change });
const success = (change: Record<string, unknown> = {}): HelpExperimentControlFetchResult => ({ status: 'success', source: 'actual_sdk_fetch', json: payload(change) });
const scopeKey = (value: StopScope) => `${value.eligibilityEpoch}:${value.allocationVersion}`;
const adapters: ReturnType<typeof createHelpExperimentStopAdapter>[] = [];
function fixture(overrides: Partial<HelpExperimentStopAdapterOptions> = {}, saved = new Map<string, readonly StopVariant[]>()) {
  const fetch = jest.fn<Promise<HelpExperimentControlFetchResult>, []>().mockResolvedValue(success());
  const readStopped = jest.fn((value: StopScope) => saved.get(scopeKey(value)) ?? []);
  const onStop = jest.fn((fact: StopFact) => { saved.set(scopeKey(fact.scope), fact.disabledVariants); return true; });
  const adapter = createHelpExperimentStopAdapter({ fetch, readStopped, onStop, now: Date.now, ...overrides });
  adapters.push(adapter);
  return { adapter, fetch, readStopped, onStop, saved };
}
function deferred() {
  let resolve!: (result: HelpExperimentControlFetchResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<HelpExperimentControlFetchResult>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }
async function activate(f: ReturnType<typeof fixture>, next = context) { f.adapter.updateContext(next); await f.adapter.refresh(); }
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(1_000_000); jest.clearAllMocks(); mockNativeFetch.mockResolvedValue(success());
});
afterEach(() => { adapters.splice(0).forEach((adapter) => adapter.dispose()); expect(jest.getTimerCount()).toBe(0); jest.useRealTimers(); });

test('strict v1 schema accepts only the declared fixed experiment, bounded numeric versions, and arm enums', () => {
  expect(parseHelpExperimentStopDocument(payload())).toEqual({ schemaVersion: 1, ...scope, revision: 1, disabledVariants: [] });
  expect(parseHelpExperimentStopDocument(payload({ disabledVariants: ['treatment', 'control'] }))?.disabledVariants).toEqual(['control', 'treatment']);
  const json = payload();
  expect(parseHelpExperimentStopDocument(' '.repeat(16_384 - json.length) + json)).not.toBeNull();
  expect(parseHelpExperimentStopDocument(' '.repeat(16_385 - json.length) + json)).toBeNull();
});

test.each([
  '', '{', 'null', 'true', '[]', '1', '"{}"',
  payload({ schemaVersion: 2 }), payload({ schemaVersion: '1' }), payload({ experimentId: 'other-experiment' }),
  payload({ eligibilityEpoch: '' }), payload({ eligibilityEpoch: '../private' }), payload({ eligibilityEpoch: 'a'.repeat(193) }),
  payload({ allocationVersion: 0 }), payload({ allocationVersion: -1 }), payload({ allocationVersion: '1' }),
  payload({ allocationVersion: 1.1 }), payload({ allocationVersion: Number.MAX_SAFE_INTEGER + 1 }),
  payload({ revision: 0 }), payload({ revision: null }), payload({ revision: true }), payload({ revision: 1.1 }),
  payload({ revision: Number.MAX_SAFE_INTEGER + 1 }), payload({ disabledVariants: null }), payload({ disabledVariants: 'treatment' }),
  payload({ disabledVariants: ['clarity'] }), payload({ disabledVariants: ['treatment', 'treatment'] }),
  payload({ disabledVariants: ['control', 'treatment', 'control'] }), payload({ disabledVariants: [{}] }),
  payload({ remoteId: 'unknown' }), payload({ enabled: true }), payload({ ttl: 999999 }), payload({ stop: false }),
  payload({ revision: { value: 1 } }), payload({ disabledVariants: { treatment: true } }),
  payload().replace(',"revision":1', ''), payload().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
  payload().replace('"revision":1', '"revision":1,"revi\\u0073ion":2'),
  payload().replace('"eligibilityEpoch":"fixture-trial-v1"', '"eligibilityEpoch":"fixture-trial-v1","eligibilityEpoch":"other"'),
  payload().replace('{', '{"__proto__":{},'), payload({ unknown: 'я'.repeat(9_000) }),
])('malformed, duplicate, missing, unknown, or out-of-contract control is denied (%#)', (json) => {
  expect(parseHelpExperimentStopDocument(json)).toBeNull();
});

test('JSON-looking text inside a string cannot hide a duplicate or introduce a valid unknown key', () => {
  expect(parseHelpExperimentStopDocument(payload({ eligibilityEpoch: 'quote:"revision":9' }))).toBeNull();
  expect(parseHelpExperimentStopDocument(payload().replace('"revision":1', '"revision":1,"revision":1'))).toBeNull();
  expect(parseHelpExperimentStopDocument(payload().replace('"revision"', '"revi\\u0073ion"'))?.revision).toBe(1);
});

test.each([
  { active: false }, { foreground: false }, { consentGranted: false }, { scope: null },
  { scope: { ...scope, experimentId: 'other' } }, { scope: { ...scope, eligibilityEpoch: '' } },
  { scope: { ...scope, allocationVersion: 0 } }, { scope: { ...scope, allocationVersion: null } },
  { consentGeneration: -1 }, { consentGeneration: NaN },
])('inactive/invalid context never starts a help fetch, SDK permission change, or stop write (%#)', async (change) => {
  const f = fixture(); await activate(f, { ...context, ...change } as StopContext);
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, disabledVariants: ['control', 'treatment'] });
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.onStop).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
  expect(mockSharedAllowed).not.toHaveBeenCalled(); expect(mockLegacyFetch).not.toHaveBeenCalled();
});

test('all-off production path stays dormant; enabled default adapter calls the separate real bridge capability', async () => {
  const adapter = createHelpExperimentStopAdapter({ readStopped: () => [], onStop: () => true }); adapters.push(adapter);
  await adapter.refresh(); adapter.updateContext({ ...context, active: false }); await adapter.refresh();
  expect(mockNativeFetch).not.toHaveBeenCalled();
  adapter.updateContext(context);
  expect(adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'pending' });
  await adapter.refresh();
  expect(mockNativeFetch).toHaveBeenCalledTimes(1);
  expect(adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: true, disabledVariants: [] });
  expect(mockSharedAllowed).not.toHaveBeenCalled(); expect(mockLegacyFetch).not.toHaveBeenCalled();
});

test('foreground lost before the queued fetch starts prevents transport invocation', async () => {
  const f = fixture(); f.adapter.updateContext(context); const work = f.adapter.refresh();
  f.adapter.updateContext({ ...context, foreground: false }); await work; await settle();
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.onStop).not.toHaveBeenCalled();
});

test('fresh SDK success is scoped and authorizes only a memory lease; identical concurrent refreshes share one request', async () => {
  const d = deferred(), f = fixture({ fetch: jest.fn(() => d.promise) });
  f.adapter.updateContext(context); const first = f.adapter.refresh(), second = f.adapter.refresh();
  expect(first).toBe(second); expect(f.adapter.getSnapshot().connected).toBe(false);
  d.resolve(success()); await first;
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: true, disabledVariants: [],
    scope, revision: 1, leaseExpiresAt: Date.now() + HELP_STOP_LEASE_MS, reason: 'ready' });
  expect(f.onStop).not.toHaveBeenCalled(); expect(f.saved.size).toBe(0);
});

test.each([{ eligibilityEpoch: 'other-epoch' }, { allocationVersion: 2 }])('a successful SDK fetch for another declared scope remains disconnected (%#)', async (change) => {
  const f = fixture(); f.fetch.mockResolvedValue(success(change)); await activate(f);
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'wrong_scope' });
  expect(f.onStop).not.toHaveBeenCalled();
});

test.each([
  { status: 'unavailable', reason: 'missing_capability' }, { status: 'unavailable', reason: 'missing_parameter' },
  { status: 'unavailable', reason: 'restart_required' }, { status: 'retryable', reason: 'network' },
  { status: 'cancelled', reason: 'disabled' }, { status: 'terminal', reason: 'invalid_payload' },
  { status: 'success', json: payload(), source: 'cache' }, { status: 'success', json: payload() },
  { status: 'success', json: payload({ enabled: true }), source: 'actual_sdk_fetch' }, null,
])('no failure/unknown source can preserve a prior allow lease or create a durable stop (%#)', async (result) => {
  const f = fixture(); await activate(f); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
  f.fetch.mockResolvedValue(result as HelpExperimentControlFetchResult); await f.adapter.refresh();
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, leaseExpiresAt: null });
  expect(f.onStop).not.toHaveBeenCalled();
  f.fetch.mockResolvedValue(success()); await f.adapter.refresh();
  expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
});

test('rejected native work is normalized and revokes a lease without logging or latching exception data', async () => {
  const f = fixture(); await activate(f); f.fetch.mockRejectedValue(new Error('do-not-return@example.com')); await f.adapter.refresh();
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'unavailable' });
  expect(f.onStop).not.toHaveBeenCalled();
});

test.each(['background', 'consent', 'scope', 'consent-generation'] as const)('late allow/stop after a %s generation change cannot authorize or persist', async (change) => {
  const old = deferred(), fresh = deferred();
  const fetch = jest.fn<Promise<HelpExperimentControlFetchResult>, []>().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const f = fixture({ fetch }); f.adapter.updateContext(context); const oldWork = f.adapter.refresh(); await settle();
  const changed = change === 'background' ? { ...context, foreground: false }
    : change === 'consent' ? { ...context, consentGranted: false }
      : change === 'scope' ? { ...context, scope: { ...scope, eligibilityEpoch: 'new-reviewed-epoch' } }
        : { ...context, consentGeneration: 2 };
  f.adapter.updateContext(changed); await oldWork;
  if (change === 'background' || change === 'consent') f.adapter.updateContext(context);
  const newWork = f.adapter.refresh(); await settle();
  old.resolve(success({ disabledVariants: ['treatment'] })); await settle();
  expect(f.adapter.getSnapshot().connected).toBe(false); expect(f.onStop).not.toHaveBeenCalled();
  fresh.resolve(success(change === 'scope' ? { eligibilityEpoch: 'new-reviewed-epoch' } : {})); await newWork;
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: true, disabledVariants: [] });
});

test('4s timeout revokes a lease; an old success after a newer request cannot restore or stop it', async () => {
  const f = fixture(); await activate(f); const old = deferred(); f.fetch.mockReturnValueOnce(old.promise);
  const pending = f.adapter.refresh(); await settle(); jest.advanceTimersByTime(HELP_STOP_TIMEOUT_MS); await pending;
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'timeout' });
  await f.adapter.refresh(); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
  old.resolve(success({ revision: 99, disabledVariants: ['control', 'treatment'] })); await settle();
  expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true); expect(f.onStop).not.toHaveBeenCalled();
});

test('partial wall rollback plus delayed timers cannot extend the actual elapsed lease', async () => {
  let wall = 1_000_000, elapsed = 0;
  const clocks = { now: () => wall, monotonicNow: () => elapsed };
  const f = fixture(clocks); await activate(f);
  wall += 20_000; elapsed += 20_000; expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
  wall -= 15_000;
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'clock_invalid' });
  wall += 50_000; elapsed += 50_000;
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false });
  expect(f.onStop).not.toHaveBeenCalled();
  await f.adapter.refresh(); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
});

test('elapsed request age rejects a late response when wall rollback and delayed timers conceal its age', async () => {
  let wall = 1_000_000, elapsed = 0;
  const clocks = { now: () => wall, monotonicNow: () => elapsed };
  const old = deferred(), f = fixture(clocks); f.fetch.mockReturnValueOnce(old.promise);
  f.adapter.updateContext(context); const work = f.adapter.refresh(); await settle();
  elapsed += 5_000; wall += 3_000;
  old.resolve(success()); await work;
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'timeout' });
  expect(f.onStop).not.toHaveBeenCalled();
  await f.adapter.refresh(); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
});

test('elapsed lease age denies at 60s without an intermediate wall rollback observation or timer callback', async () => {
  let elapsed = 0;
  const f = fixture({ now: () => 1_000_000 + Math.floor(elapsed * 55 / 70), monotonicNow: () => elapsed });
  await activate(f); elapsed = 70_000;
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'lease_expired' });
  expect(f.onStop).not.toHaveBeenCalled();
});

test('fractional monotonic timestamps enforce the exact lease boundary independently of wall progression', async () => {
  let elapsed = 0.25;
  const f = fixture({ now: () => 1_000_000, monotonicNow: () => elapsed }); await activate(f);
  elapsed = 60_000.24; expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
  elapsed = 60_000.25;
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'lease_expired' });
  expect(f.onStop).not.toHaveBeenCalled();
});

test.each([3_999.99, 4_000])('SDK completion age %sms is checked before delayed timeout delivery', async (age) => {
  let elapsed = 0.25;
  const old = deferred(), f = fixture({ now: () => 1_000_000, monotonicNow: () => elapsed });
  f.fetch.mockReturnValueOnce(old.promise); f.adapter.updateContext(context); const work = f.adapter.refresh(); await settle();
  elapsed += age; old.resolve(success({ disabledVariants: ['treatment'] })); await work;
  expect(f.adapter.getSnapshot().connected).toBe(age < HELP_STOP_TIMEOUT_MS);
  expect(f.onStop).toHaveBeenCalledTimes(age < HELP_STOP_TIMEOUT_MS ? 1 : 0);
});

test.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, undefined])('invalid monotonic capability %s cannot fall back to wall-only authorization', async (value) => {
  const f = fixture({ monotonicNow: () => value as number }); await activate(f);
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'clock_invalid' });
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.onStop).not.toHaveBeenCalled();
});

test('throwing monotonic capability denies without exposing its error or creating a functional stop', async () => {
  const f = fixture({ monotonicNow: () => { throw new Error('do-not-return@example.com'); } }); await activate(f);
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'clock_invalid' });
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.onStop).not.toHaveBeenCalled();
});

test('default production clock uses performance.now for elapsed expiry without a wall-only fallback', async () => {
  let elapsed = 0;
  const clock = jest.spyOn(globalThis.performance, 'now').mockImplementation(() => elapsed);
  try {
    const f = fixture({ now: () => 1_000_000 }); await activate(f);
    expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
    elapsed = HELP_STOP_LEASE_MS;
    expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, reason: 'lease_expired' });
    expect(f.onStop).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); }
});

test('missing production performance capability revokes an allow and a fresh valid clock may recover temporarily denied presentation', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')!;
  const f = fixture(); await activate(f);
  try {
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: undefined });
    expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'clock_invalid' });
    await f.adapter.refresh(); expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.onStop).not.toHaveBeenCalled();
  } finally { Object.defineProperty(globalThis, 'performance', descriptor); }
  await f.adapter.refresh(); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
});

test.each(['wall', 'monotonic'] as const)('observed %s rollback fences pending SDK work without a durable stop', async (which) => {
  let wall = 1_000_000, elapsed = 20_000;
  const f = fixture({ now: () => wall, monotonicNow: () => elapsed }); await activate(f);
  const old = deferred(); f.fetch.mockReturnValueOnce(old.promise); const work = f.adapter.refresh(); await settle();
  if (which === 'wall') wall -= 1; else elapsed -= 1;
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'clock_invalid' }); await work;
  await f.adapter.refresh(); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
  old.resolve(success({ revision: 99, disabledVariants: ['control', 'treatment'] })); await settle();
  expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true); expect(f.onStop).not.toHaveBeenCalled();
});

test('a lease expires at 60s even if timer delivery is delayed; fresh success can recover the original assignment', async () => {
  const f = fixture(); await activate(f); const expiry = f.adapter.getSnapshot().leaseExpiresAt!;
  jest.setSystemTime(expiry - 1); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
  jest.setSystemTime(expiry); expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'lease_expired' });
  expect(f.onStop).not.toHaveBeenCalled(); await f.adapter.refresh(); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
});

test('clock rollback cannot extend a lease; no allow survives background, restart, or lifecycle stop()', async () => {
  const f = fixture(); await activate(f); jest.setSystemTime(Date.now() - 1);
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, reason: 'clock_invalid' });
  await f.adapter.refresh(); expect(f.adapter.getSnapshot().connected).toBe(true);
  f.adapter.updateContext({ ...context, foreground: false }); expect(f.adapter.getSnapshot().connected).toBe(false);
  f.adapter.updateContext(context); expect(f.adapter.getSnapshot().connected).toBe(false); await f.adapter.refresh();
  expect(f.adapter.getSnapshot().connected).toBe(true);
  f.adapter.stop(); expect(f.adapter.getSnapshot().connected).toBe(false); await f.adapter.refresh();
  expect(f.adapter.getSnapshot().connected).toBe(false);
  await activate(f); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
  const restarted = fixture({}, f.saved); expect(restarted.adapter.getSnapshot().connected).toBe(false);
  expect(f.onStop).not.toHaveBeenCalled(); expect(restarted.onStop).not.toHaveBeenCalled();
});

test('live polling requests the existing transport every 30s while active and cancels timers when inactive', async () => {
  const f = fixture(); await activate(f); expect(f.fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(HELP_STOP_POLL_MS - 1); await settle(); expect(f.fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1); await settle(); expect(f.fetch).toHaveBeenCalledTimes(2);
  expect(f.adapter.getSnapshot().leaseExpiresAt).toBe(Date.now() + HELP_STOP_LEASE_MS);
  f.adapter.updateContext({ ...context, foreground: false }); expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(HELP_STOP_LEASE_MS * 2); await settle(); expect(f.fetch).toHaveBeenCalledTimes(2);
});

test('any explicitly disabled arm blocks new enrollment; union clamps affected existing presentation and cannot auto-resume', async () => {
  const f = fixture(); await activate(f); f.fetch.mockResolvedValue(success({ revision: 2, disabledVariants: ['treatment'] }));
  await f.adapter.refresh();
  expect(f.onStop).toHaveBeenCalledWith({ scope, revision: 2, disabledVariants: ['treatment'] });
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: false, disabledVariants: ['treatment'], reason: 'remote_stop' });
  f.fetch.mockResolvedValue(success({ revision: 3 })); await f.adapter.refresh();
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: false, disabledVariants: ['treatment'] });
  f.fetch.mockResolvedValue(success({ revision: 4, disabledVariants: ['control'] })); await f.adapter.refresh();
  expect(f.onStop).toHaveBeenLastCalledWith({ scope, revision: 4, disabledVariants: ['control', 'treatment'] });
  expect(f.adapter.getSnapshot().disabledVariants).toEqual(['control', 'treatment']);
  f.adapter.stop(); f.fetch.mockResolvedValue(success({ revision: 5 })); await activate(f);
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: false, disabledVariants: ['control', 'treatment'] });
  const restarted = fixture({}, f.saved); await activate(restarted);
  expect(restarted.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: false, disabledVariants: ['control', 'treatment'] });
});

test('a control-arm stop also blocks enrollment while the treatment assignment remains eligible for presentation', async () => {
  const f = fixture(); f.fetch.mockResolvedValue(success({ disabledVariants: ['control'] })); await activate(f);
  const result = f.adapter.getSnapshot(); expect(result.connected).toBe(true); expect(result.enrollmentAllowed).toBe(false);
  expect(result.disabledVariants.includes('treatment')).toBe(false); expect(f.onStop).toHaveBeenCalledTimes(1);
});

test('missing, downgraded, wrong-scope, or conflicting documents cannot undo a received stop', async () => {
  const f = fixture(); f.fetch.mockResolvedValue(success({ revision: 4, disabledVariants: ['treatment'] })); await activate(f);
  for (const result of [success({ revision: 3 }), success({ revision: 4 }), success({ revision: 5, allocationVersion: 2 }),
    { status: 'unavailable', reason: 'missing_parameter' } as const]) {
    f.fetch.mockResolvedValue(result); await f.adapter.refresh(); expect(f.adapter.getSnapshot().connected).toBe(false);
  }
  f.fetch.mockResolvedValue(success({ revision: 6 })); await f.adapter.refresh();
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: false, disabledVariants: ['treatment'] });
  const nextScope = { ...scope, eligibilityEpoch: 'new-reviewed-epoch' };
  f.fetch.mockResolvedValue(success({ revision: 1, eligibilityEpoch: nextScope.eligibilityEpoch }));
  await activate(f, { ...context, scope: nextScope }); expect(f.adapter.getSnapshot().enrollmentAllowed).toBe(true);
});

test('failed durable stop readback remains disconnected and is retried without losing the in-memory revoke', async () => {
  const saved = new Map<string, readonly StopVariant[]>(); let writable = false;
  const onStop = jest.fn((fact: StopFact) => { if (writable) saved.set(scopeKey(fact.scope), fact.disabledVariants); return writable; });
  const f = fixture({ onStop }, saved); f.fetch.mockResolvedValue(success({ revision: 2, disabledVariants: ['treatment'] })); await activate(f);
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'storage_failure' });
  f.fetch.mockResolvedValue(success({ revision: 3 })); await f.adapter.refresh(); expect(f.adapter.getSnapshot().connected).toBe(false);
  writable = true; await f.adapter.refresh();
  expect(onStop).toHaveBeenLastCalledWith({ scope, revision: 3, disabledVariants: ['treatment'] });
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: false, disabledVariants: ['treatment'] });
});

test('reentrant UI reads during stop persistence cannot observe a connection before durable acknowledgement', async () => {
  const duringWrite: boolean[] = [];
  const f = fixture({ onStop: () => { duringWrite.push(f.adapter.getSnapshot().connected); return false; } });
  await activate(f); f.fetch.mockResolvedValue(success({ revision: 2, disabledVariants: ['treatment'] }));
  await f.adapter.refresh();
  expect(duringWrite).toEqual([false]);
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, enrollmentAllowed: false, reason: 'storage_failure' });
});

test('durable corruption/read failure denies without inventing an explicit remote stop', async () => {
  const f = fixture({ readStopped: () => { throw new Error('private'); } }); await activate(f);
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, reason: 'storage_failure' }); expect(f.onStop).not.toHaveBeenCalled();
  const bad = fixture({ readStopped: () => ['unknown'] as unknown as StopVariant[] }); await activate(bad);
  expect(bad.adapter.getSnapshot()).toMatchObject({ connected: false, reason: 'storage_failure' }); expect(bad.onStop).not.toHaveBeenCalled();
  const corruptDeny = fixture({ readStopped: () => ['control', 'treatment'] }); await activate(corruptDeny);
  expect(corruptDeny.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: false, disabledVariants: ['control', 'treatment'] });
});

test('durable arm removal during one adapter lifetime does not silently resume a previously observed stopped phase', async () => {
  const saved = new Map<string, readonly StopVariant[]>([[scopeKey(scope), ['treatment']]]), f = fixture({}, saved);
  await activate(f); saved.clear(); await f.adapter.refresh();
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: true, enrollmentAllowed: false, disabledVariants: ['treatment'] });
});

test('subscriptions isolate observer errors, unsubscribe cleanly, and dispose fences delayed work without timer leaks', async () => {
  const f = fixture(), listener = jest.fn(); const unsubscribe = f.adapter.subscribe(listener);
  f.adapter.subscribe(() => { throw new Error('observer'); }); await activate(f); expect(listener).toHaveBeenCalled();
  unsubscribe(); const before = listener.mock.calls.length; const old = deferred(); f.fetch.mockReturnValueOnce(old.promise);
  const work = f.adapter.refresh(); await settle(); f.adapter.dispose(); await work;
  expect(jest.getTimerCount()).toBe(0); old.resolve(success({ revision: 99, disabledVariants: ['treatment'] })); await settle();
  f.adapter.updateContext(context); await f.adapter.refresh();
  expect(f.adapter.getSnapshot()).toMatchObject({ connected: false, reason: 'disposed' });
  expect(f.onStop).not.toHaveBeenCalled(); expect(listener).toHaveBeenCalledTimes(before);
});
