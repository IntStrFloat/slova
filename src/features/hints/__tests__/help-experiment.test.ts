/* eslint-disable @typescript-eslint/no-require-imports */
import { helpExperimentFixture } from './help-experiment-fixture';
import type { HelpFlow } from '../help-flow';
import type { CapturedHelpRequest } from '../help-experiment';

jest.mock('@/core/native/appmetrica', () => ({ reportEvent: jest.fn(() => false), isAppMetricaAvailable: () => false,
  isAppMetricaTestDevice: jest.fn(() => false), setDataSendingEnabled: jest.fn(() => true), getDataSendingPreference: () => null,
  getSoftwareBuildInfo: () => ({ versionName: '0.1.29', versionCode: '33' }),
  getAppMetricaIdentifiers: jest.fn(async () => ({ deviceId: '18446744073709551615', installationId: 'fixture_install' })) }));
const T = Date.parse('2026-11-03T09:00:00Z');
function flow(id = 'fixture:origin', createdAtMs = T): HelpFlow {
  return { version: 1, id, attemptId: 'fixture:attempt', levelKey: 'campaign:6', levelId: 6, mode: 'campaign',
    contentVersion: 'fixture_content', contentFingerprint: 'fp_0123456789abcdef', requestedHint: 'letter', displayedCost: 50,
    balance: 20, entrySource: 'game_help', createdAtMs, previouslyCompleted: false, uxVariant: 'clarity', status: 'requested' };
}
async function fixture(deviceId = '18446744073709551615') {
  jest.resetModules(); Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
  delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE; delete process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
  const store = require('@/core/storage') as typeof import('@/core/storage'); store.storage.clearAll();
  require('@/core/native/appmetrica').getAppMetricaIdentifiers.mockResolvedValue({ deviceId, installationId: 'fixture_install' });
  require('react-native').Platform.OS = 'android';
  const analytics = require('@/features/analytics') as typeof import('@/features/analytics');
  const sdk = require('@/features/analytics/sdkIdentity') as typeof import('@/features/analytics/sdkIdentity'); await sdk.primeSdkIdentity();
  const runtime = require('../help-experiment') as typeof import('../help-experiment');
  const definition = helpExperimentFixture();
  const event = jest.fn<string | null, Parameters<typeof analytics.trackOnce>>(() => 'fixture_event'), restoreFlow = jest.fn();
  const gate = { enabled: true, connected: true, enrollmentAllowed: true, disabledVariants: [] as ('control' | 'treatment')[], token: 'fixture_owner' as string | null };
  const write = jest.fn((key: string, raw: string) => { store.storage.set(key, raw); return store.getString(key) === raw; });
  const deps = { ...definition, read: store.getString, write, remove: store.removeKey, identity: sdk.getSdkIdentitySnapshot,
    collectionEnabled: () => gate.enabled && analytics.isAnalyticsCollectionEnabled(), consentEpoch: analytics.getAnalyticsConsentEpoch,
    profileToken: () => gate.token, now: Date.now, capture: analytics.captureHelpEnrollmentFact, enqueue: analytics.enqueueCapturedHelpFact,
    restoreFlow, event, changed: () => {}, stopControl: () => gate };
  const controller = runtime.createHelpExperimentController(deps);
  jest.setSystemTime(new Date('2026-10-19T09:00:00Z')); controller.observeIdentity(); jest.setSystemTime(T);
  const input: CapturedHelpRequest = { flow: flow(), requestedAtMs: T, interactionId: 'fixture:origin', isAvailable: true,
    alreadyOwned: false, free: false, previouslyCompleted: false };
  return { ...store, ...definition, ...analytics, sdk, runtime, controller, deps, gate, write, event, restoreFlow, input };
}
beforeEach(() => { jest.useFakeTimers().setSystemTime(T); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: true }); });

const invalidNegativeJournals = [
  { key: 'helpEnrollmentBlocks', raw: '{', case: 'blocks JSON' },
  { key: 'helpEnrollmentBlocks', raw: 'null', case: 'blocks JSON null' },
  { key: 'helpEnrollmentBlocks', raw: 'false', case: 'blocks boolean' },
  { key: 'helpEnrollmentBlocks', raw: '{}', case: 'blocks object' },
  { key: 'helpEnrollmentBlocks', raw: '[{"phase":"trial","epoch":42}]', case: 'blocks invalid epoch' },
  { key: 'helpEnrollmentBlocks', raw: '[{"phase":"trial","epoch":"ok","extra":1}]', case: 'blocks extra field' },
  { key: 'helpTrialSafety', raw: '{', case: 'safety JSON' },
  { key: 'helpTrialSafety', raw: 'null', case: 'safety JSON null' },
  { key: 'helpTrialSafety', raw: 'false', case: 'safety boolean' },
  { key: 'helpTrialSafety', raw: '0', case: 'safety number' },
  { key: 'helpTrialSafety', raw: '[]', case: 'safety array' },
  { key: 'helpTrialSafety', raw: '{}', case: 'safety object' },
  { key: 'helpTrialSafety', raw: '{"version":1,"experimentId":"slova_wheel_help_clarity_20261104","epoch":42,"reason":"broken_checkout"}', case: 'safety invalid epoch' },
  { key: 'helpTrialSafety', raw: '{"version":1,"experimentId":"slova_wheel_help_clarity_20261104","epoch":"ok","reason":"cancelled"}', case: 'safety unknown incident' },
] as const;

test.each(invalidNegativeJournals)('R1 the first enrollment call rejects $case before allocation or capture', async ({ key, raw }) => {
  const f = await fixture(); const storageKey = f.KEYS[key];
  const capture = jest.fn(f.deps.capture), enqueue = jest.fn(f.deps.enqueue);
  const allocate = jest.spyOn(require('@/features/analytics/experiments'), 'chooseExperimentVariant');
  const controller = f.runtime.createHelpExperimentController({ ...f.deps, capture, enqueue });
  f.storage.set(storageKey, raw);
  expect(controller.prepare(f.input)).toMatchObject({ status: 'unknown', uxVariant: 'control', captured: false });
  expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toHaveLength(0);
  expect(capture).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled(); expect(allocate).not.toHaveBeenCalled();
  expect(f.getString(storageKey)).toBe(raw); // Unknown denial/incident history is never rewritten as an empty journal.
  f.removeKey(storageKey);
  expect(controller.prepare(f.input).captured).toBe(false); // A successful later read cannot whitewash the failed continuity proof.
});

test.each(invalidNegativeJournals)('R1 first resolve/exposure reads reject $case on an existing treatment', async ({ key, raw }) => {
  const f = await fixture(); expect(f.controller.prepare(f.input).captured).toBe(true);
  expect(f.controller.resolve(f.input.flow)).toBe('clarity');
  const original = f.getString(f.KEYS.helpEnrollment);
  f.storage.set(f.KEYS[key], raw);
  for (const action of ['resolve', 'expose']) {
    const controller = f.runtime.createHelpExperimentController(f.deps);
    if (action === 'resolve') expect(controller.resolve(f.input.flow)).toBe('control');
    else controller.exposed(f.input.flow, 'no_coins', T, { layoutReady: true, routeFocused: true, windowFocused: true, active: true });
    expect(f.event).not.toHaveBeenCalled();
  }
  expect(f.getString(f.KEYS.helpEnrollment)).toBe(original); // Preserve original ITT; only presentation is clamped.
});

test.each(['helpEnrollmentBlocks', 'helpTrialSafety'] as const)('R1 a first read error on %s never allocates even if later reads succeed', async (key) => {
  const f = await fixture(); let failed = false;
  const capture = jest.fn(f.deps.capture), enqueue = jest.fn(f.deps.enqueue);
  const controller = f.runtime.createHelpExperimentController({ ...f.deps, capture, enqueue, read: (storageKey) => {
    if (!failed && storageKey === f.KEYS[key]) { failed = true; throw new Error('fixture read failure'); }
    return f.deps.read(storageKey);
  } });
  expect(controller.prepare(f.input)).toMatchObject({ status: 'unknown', captured: false, uxVariant: 'control' });
  expect(capture).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled();
  expect(controller.prepare(f.input).captured).toBe(false);
});

test('R1 a negative-key change during the paired read fails the current decision', async () => {
  const f = await fixture(); const capture = jest.fn(f.deps.capture); let changed = false;
  const controller = f.runtime.createHelpExperimentController({ ...f.deps, capture, read: (key) => {
    if (!changed && key === f.KEYS.helpTrialSafety) { changed = true; f.storage.set(f.KEYS.helpEnrollmentBlocks, '{'); }
    return f.deps.read(key);
  } });
  expect(controller.prepare(f.input)).toMatchObject({ captured: false, uxVariant: 'control' });
  expect(capture).not.toHaveBeenCalled(); expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toHaveLength(0);
});

test('R1 transaction callbacks cannot reenter assignment or expose a claim before commit acknowledgment', async () => {
  const f = await fixture(); const capture = jest.fn(f.deps.capture), enqueue = jest.fn(f.deps.enqueue);
  let controller!: ReturnType<typeof f.runtime.createHelpExperimentController>;
  let reentered = false; const observations: string[] = [];
  controller = f.runtime.createHelpExperimentController({ ...f.deps, capture, enqueue, write: (key, value) => {
    const ok = f.deps.write(key, value);
    if (key === f.KEYS.helpEnrollment && !reentered) {
      reentered = true;
      observations.push(controller.prepare(f.input).captured ? 'allocated' : 'denied');
      observations.push(controller.resolve(f.input.flow));
      controller.exposed(f.input.flow, 'no_coins', T, { layoutReady: true, routeFocused: true, windowFocused: true, active: true });
    }
    return ok;
  } });
  expect(controller.prepare(f.input).captured).toBe(true);
  expect(observations).toEqual(['denied', 'control']); expect(capture).toHaveBeenCalledTimes(3);
  expect(enqueue).toHaveBeenCalledTimes(3); expect(f.event).not.toHaveBeenCalled();
  expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toHaveLength(1);
});

test('R1 negative corruption during staging never persists or enqueues the provisional first facts', async () => {
  const f = await fixture(); const enqueue = jest.fn(f.deps.enqueue); let changed = false;
  const controller = f.runtime.createHelpExperimentController({ ...f.deps, enqueue, capture: (name, key, properties) => {
    if (!changed) { changed = true; f.storage.set(f.KEYS.helpTrialSafety, '{'); }
    return f.deps.capture(name, key, properties);
  } });
  expect(controller.prepare(f.input)).toMatchObject({ captured: false, uxVariant: 'control' });
  expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toHaveLength(0); expect(enqueue).not.toHaveBeenCalled();
});

test('R1 invalid negative journals hold pending facts while a valid safety stop preserves lawful original ITT delivery', async () => {
  const f = await fixture();
  const pending = f.runtime.createHelpExperimentController({ ...f.deps, enqueue: () => 'blocked' });
  expect(pending.prepare(f.input).captured).toBe(true);
  f.storage.set(f.KEYS.helpTrialSafety, '{'); const enqueue = jest.fn(f.deps.enqueue);
  const reader = f.runtime.createHelpExperimentController({ ...f.deps, enqueue }); reader.flush();
  expect(enqueue).not.toHaveBeenCalled();
  f.storage.set(f.KEYS.helpTrialSafety, JSON.stringify({ version: 1, experimentId: f.config.experimentId,
    epoch: f.config.trial.eligibilityEpoch, reason: 'broken_checkout' }));
  const lawful = f.runtime.createHelpExperimentController({ ...f.deps, enqueue }); lawful.flush();
  expect(enqueue).toHaveBeenCalledTimes(3); expect(lawful.resolve(f.input.flow)).toBe('control');
  expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toHaveLength(1);
});

test('R1 the production storage port preserves read errors and typed-value corruption instead of masking absence', async () => {
  const f = await fixture(); const key = f.KEYS.helpEnrollmentBlocks;
  expect(f.runtime.readHelpExperimentJournal(key)).toBeNull();
  f.storage.set(key, false);
  expect(() => f.runtime.readHelpExperimentJournal(key)).toThrow('journal type');
  const typed = f.runtime.createHelpExperimentController({ ...f.deps, read: f.runtime.readHelpExperimentJournal });
  expect(typed.prepare(f.input)).toMatchObject({ captured: false, uxVariant: 'control' });
  expect(f.storage.getBoolean(key)).toBe(false);
  f.removeKey(key);
  const originalGet = f.storage.getString.bind(f.storage);
  jest.spyOn(f.storage, 'getString').mockImplementation((candidate) => {
    if (candidate === key) throw new Error('fixture MMKV read failed');
    return originalGet(candidate);
  });
  expect(f.getString(key)).toBeNull(); // Existing ordinary-UI helper intentionally masks failures.
  expect(() => f.runtime.readHelpExperimentJournal(key)).toThrow('fixture MMKV read failed');
  const direct = f.runtime.createHelpExperimentController({ ...f.deps, read: f.runtime.readHelpExperimentJournal });
  const wallet = f.getString(f.KEYS.currency);
  expect(direct.prepare(f.input)).toMatchObject({ captured: false, uxVariant: 'control' });
  expect(f.getString(f.KEYS.currency)).toBe(wallet);
  expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toHaveLength(0);
});

test('trial commits SDK-player first origin and exact-time captured envelopes atomically before exposure', async () => {
  const f = await fixture();
  expect(require('@/core/config/helpExperiment').validateHelpExperimentReadiness(f.config, f.evidence).trialReady).toBe(true);
  const result = f.controller.prepare(f.input);
  expect(result).toMatchObject({ status: 'trial_first', captured: true });
  const j = JSON.parse(f.getString(f.KEYS.helpEnrollment)!);
  expect(j.claims).toHaveLength(1); expect(j.claims[0].origin.attemptId).toBe('fixture:attempt');
  expect(j.claims[0].facts.map((v: { fact: { envelope: { occurredAtMs: number } } }) => v.fact.envelope.occurredAtMs)).toEqual([T, T, T]);
  const assignment = j.claims[0].facts[2].fact.envelope;
  expect(assignment).toMatchObject({ unit_type: 'sdk_player', measurement_phase: 'trial', eligibility_epoch: 'trial_fixture_v1',
    origin_interaction_id: 'fixture:origin', occurredAtMs: T, trial_plan_fingerprint: j.claims[0].planFingerprint });
  expect(j.claims[0].facts.every((entry: { fact: { envelope: { trial_plan_fingerprint: string } } }) => entry.fact.envelope.trial_plan_fingerprint === j.claims[0].planFingerprint)).toBe(true);
  expect(f.event).not.toHaveBeenCalled();
  f.controller.exposed(f.input.flow, 'no_coins', T, { layoutReady: true, routeFocused: true, windowFocused: true, active: true });
  expect(f.event).toHaveBeenCalledWith('experiment_exposed', expect.any(String), expect.objectContaining({ occurredAtMs: T, origin_interaction_id: 'fixture:origin' }));
  expect(f.event.mock.calls[0][2]).toHaveProperty('trial_plan_fingerprint', j.claims[0].planFingerprint);
  // Equal actual milliseconds are honest; the P5 analyzer retains its independent ordering test.
  expect(JSON.stringify(j)).not.toContain('email');
});

test('baseline collection works with trial disabled and no baseline review, sample, MDE or n', async () => {
  const f = await fixture(); f.config.trial.enabled = false; f.config.trial.nPerArm = null; f.config.trial.mdePp = null;
  f.config.frozenAt = '2026-10-20T00:00:00Z';
  f.evidence.baselineReview = null; f.evidence.samplePlan = null; f.config.baseline.analysisWindowMinutes = null;
  const now = Date.parse('2026-10-22T09:00:00Z'); jest.setSystemTime(now);
  const input = { ...f.input, flow: flow('baseline:origin', now), interactionId: 'baseline:origin', requestedAtMs: now };
  expect(f.controller.prepare(input)).toMatchObject({ status: 'baseline_first', uxVariant: 'control', captured: true });
  const j = JSON.parse(f.getString(f.KEYS.helpEnrollment)!);
  expect(j.claims[0].facts).toHaveLength(2); expect(j.claims[0].assignmentId).toBeNull();
  expect(j.claims[0].facts.every((entry: { fact: { envelope: Record<string, unknown> } }) => entry.fact.envelope.trial_plan_fingerprint === undefined)).toBe(true);
});

test('a baseline participant can enter the distinct trial epoch; new flows keep the original trial assignment', async () => {
  const f = await fixture(); const baselineTime = Date.parse('2026-10-22T09:00:00Z'); jest.setSystemTime(baselineTime);
  f.config.frozenAt = '2026-10-20T00:00:00Z';
  f.controller.prepare({ ...f.input, flow: flow('baseline:origin', baselineTime), interactionId: 'baseline:origin', requestedAtMs: baselineTime });
  f.config.frozenAt = '2026-11-02T01:00:00Z';
  jest.setSystemTime(T); expect(f.controller.prepare(f.input).status).toBe('trial_first');
  const original = JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims[1];
  jest.setSystemTime(T + 1000);
  const later = flow('later:origin', T + 1000); later.attemptId = 'later:attempt';
  expect(f.controller.prepare({ ...f.input, flow: later, interactionId: later.id, requestedAtMs: later.createdAtMs }).status).toBe('participant');
  const j = JSON.parse(f.getString(f.KEYS.helpEnrollment)!);
  expect(j.claims).toHaveLength(2); expect(j.claims[1]).toEqual(original);
  expect(f.controller.resolve(later)).toBe(f.controller.resolve(f.input.flow));
  expect(f.controller.resolve(flow('legacy:unassigned'))).toBe('control'); expect(f.controller.resolve(null)).toBe('control');
});

test.each([{ free: true }, { alreadyOwned: true }, { isAvailable: false }, { previouslyCompleted: true }])('excludes before claim: %j', async (change) => {
  const f = await fixture(); expect(f.controller.prepare({ ...f.input, ...change }).status).toBe('ineligible');
  expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toHaveLength(0);
});
test.each([{ previouslyCompleted: null }, { interactionId: 'invalid email@example.test' }, { flow: { ...flow(), attemptId: 'private word' } }])('unknown/invalid eligibility never becomes a first claim: %j', async (change) => {
  const f = await fixture(); expect(f.controller.prepare({ ...f.input, ...change }).captured).toBe(false);
  expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toHaveLength(0);
});

test('cold identity, opt-out and lost continuity fail closed and cannot be retroactively enrolled', async () => {
  const f = await fixture(); f.sdk.invalidateSdkIdentity();
  expect(f.controller.prepare(f.input).captured).toBe(false); await f.sdk.primeSdkIdentity();
  expect(f.controller.prepare(f.input).captured).toBe(false);
  const raw = f.getString(f.KEYS.helpEnrollmentBlocks)!;
  expect(raw).not.toContain('184467'); expect(raw).not.toContain('fixture:origin');
  const cold = f.runtime.createHelpExperimentController(f.deps);
  expect(cold.prepare(f.input).captured).toBe(false);
  f.controller.purge(); expect(f.getString(f.KEYS.helpEnrollment)).toBeNull();
});

test('storage readback failure/corrupt journal never exposes a different arm or a replacement first origin', async () => {
  const f = await fixture(); f.write.mockImplementation((key) => key !== f.KEYS.helpEnrollment);
  expect(f.controller.prepare(f.input).captured).toBe(false); expect(f.controller.resolve(f.input.flow)).toBe('control');
  f.storage.set(f.KEYS.helpEnrollment, '{broken');
  const cold = f.runtime.createHelpExperimentController(f.deps);
  expect(cold.prepare(f.input).captured).toBe(false);
});

test.each(['variant', 'assignment', 'origin'])('contradictory persisted %s is never trusted as UI authority', async (kind) => {
  const f = await fixture(); expect(f.controller.prepare(f.input).captured).toBe(true);
  const j = JSON.parse(f.getString(f.KEYS.helpEnrollment)!);
  if (kind === 'variant') j.claims[0].variant = j.claims[0].variant === 'control' ? 'treatment' : 'control';
  if (kind === 'assignment') j.claims[0].assignmentId = 'exp_foreign';
  if (kind === 'origin') j.claims[0].origin.attemptId = 'other:attempt';
  f.storage.set(f.KEYS.helpEnrollment, JSON.stringify(j));
  const cold = f.runtime.createHelpExperimentController(f.deps);
  expect(cold.resolve(f.input.flow)).toBe('control'); expect(cold.prepare(f.input).captured).toBe(false);
});

test('committed facts survive a crash before first enqueue without new IDs, time, version or origin', async () => {
  const f = await fixture(); const blockedEnqueue = jest.fn(() => 'blocked' as const);
  const first = f.runtime.createHelpExperimentController({ ...f.deps, enqueue: blockedEnqueue });
  expect(first.prepare(f.input).captured).toBe(true);
  const stored = JSON.parse(f.getString(f.KEYS.helpEnrollment)!); const before = stored.claims[0].facts.map((v: { fact: unknown }) => v.fact);
  jest.setSystemTime(T + 10_000);
  const sent = jest.fn(f.enqueueCapturedHelpFact);
  const cold = f.runtime.createHelpExperimentController({ ...f.deps, enqueue: sent }); cold.flush();
  expect(sent.mock.calls.map(([fact]) => fact)).toEqual(before);
  expect(f.restoreFlow).toHaveBeenCalledWith(expect.objectContaining({ id: 'fixture:origin', createdAtMs: T }));
  expect(cold.prepare(f.input).status).toBe('participant');
});

test('a connected fleet stop port is required beyond valid JSON evidence, and revocation preserves the original ITT', async () => {
  const f = await fixture(); f.gate.connected = false;
  expect(f.controller.prepare(f.input).captured).toBe(false); f.gate.connected = true;
  expect(f.controller.prepare(f.input).captured).toBe(false); // Already served control cannot become a retrospective assignment.
  const ready = await fixture(); expect(ready.controller.prepare(ready.input).captured).toBe(true);
  const before = JSON.parse(ready.getString(ready.KEYS.helpEnrollment)!).claims;
  ready.gate.disabledVariants = ['control', 'treatment'];
  expect(ready.controller.resolve(ready.input.flow)).toBe('control');
  expect(JSON.parse(ready.getString(ready.KEYS.helpEnrollment)!).claims).toEqual(before);
});

test('actual durable duplicate credits latch; replayed transaction, pending and missing telemetry do not', async () => {
  const f = await fixture(); f.controller.prepare(f.input);
  const tx = { id: 'wallet:one', currency: 'coins', delta: 60, balanceBefore: 20, balanceAfter: 80,
    source: 'rewarded', rewardId: 'reward:one', occurredAtMs: T };
  f.controller.inspectDurableWallet(JSON.stringify({ version: 2, appliedRewards: { a: 1, b: 1 }, operationTransactions: { a: tx, b: tx } }));
  expect(f.getString(f.KEYS.helpTrialSafety)).toBeNull();
  f.controller.inspectDurableWallet(JSON.stringify({ version: 2, appliedRewards: { a: 1, b: 1 }, operationTransactions: { a: tx, b: { ...tx, id: 'wallet:two', balanceBefore: 80, balanceAfter: 140 } } }));
  expect(JSON.parse(f.getString(f.KEYS.helpTrialSafety)!)).toMatchObject({ reason: 'duplicate_reward_credit' });
  expect(f.controller.resolve(f.input.flow)).toBe('control');
  expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toHaveLength(1);
});

test('actual technical checkout observer excludes validation, cancellation, sync and test mode', async () => {
  const f = await fixture(); const subscription = require('@/features/analytics/subscription') as typeof import('@/features/analytics/subscription');
  const stop = subscription.subscribeCheckoutTechnicalFailure(f.controller.checkoutFailure);
  for (const props of [{ stage: 'checkout', mode: 'live', reason: 'bad_email' }, { stage: 'checkout', mode: 'live', reason: 'payment_canceled' },
    { stage: 'sync', mode: 'live', reason: 'invalid_confirmation_url' }, { stage: 'checkout', mode: 'test', reason: 'invalid_confirmation_url' }])
    subscription.trackSubscription('subscription_error', props);
  expect(f.getString(f.KEYS.helpTrialSafety)).toBeNull();
  subscription.trackSubscription('subscription_error', { stage: 'checkout', mode: 'live', reason: 'invalid_confirmation_url' });
  expect(JSON.parse(f.getString(f.KEYS.helpTrialSafety)!)).toMatchObject({ reason: 'broken_checkout' }); stop();
});

test('exposure needs actual focus/layout/activity; no assignment and every hidden state produce no event', async () => {
  const f = await fixture(); const visible = { layoutReady: true, routeFocused: true, windowFocused: true, active: true };
  f.controller.exposed(f.input.flow, 'wheel', T, visible); expect(f.event).not.toHaveBeenCalled();
  f.controller.prepare(f.input);
  for (const key of Object.keys(visible)) f.controller.exposed(f.input.flow, 'wheel', T, { ...visible, [key]: false });
  expect(f.event).not.toHaveBeenCalled();
  f.controller.exposed(f.input.flow, 'wheel', T, visible); expect(f.event).toHaveBeenCalledTimes(1);
});

test('both existing allocator arms are reachable and remain stable over restart with an immutable trial plan', async () => {
  const seed = await fixture();
  const choose = require('@/features/analytics/experiments').chooseExperimentVariant as typeof import('@/features/analytics/experiments').chooseExperimentVariant;
  const spec = { id: seed.config.experimentId, allocationVersion: 1, startsAt: seed.config.trial.enrollmentFrom!,
    endsAt: seed.config.trial.enrollmentToExclusive!, exposureScreens: [], variants: [{ id: 'control', weight: 1 }, { id: 'treatment', weight: 1 }] };
  const units: Record<string, string> = {};
  for (let id = 1; id <= 100 && Object.keys(units).length < 2; id++) units[choose(spec, String(id))!] = String(id);
  expect(Object.keys(units).sort()).toEqual(['control', 'treatment']);
  for (const [variant, unit] of Object.entries(units)) {
    const f = await fixture(unit); expect(f.controller.prepare(f.input).captured).toBe(true);
    expect(f.controller.resolve(f.input.flow)).toBe(variant === 'treatment' ? 'clarity' : 'control');
    const cold = f.runtime.createHelpExperimentController(f.deps);
    expect(cold.resolve(f.input.flow)).toBe(f.controller.resolve(f.input.flow));
    expect(cold.prepare(f.input).captured).toBe(true); // Same original call returns its durable captured decision, no contradictory false-first copy.
    const before = JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims;
    f.config.trial.nPerArm! += 1;
    expect(cold.resolve(f.input.flow)).toBe('control'); expect(cold.prepare(f.input).status).toBe('unknown');
    expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toEqual(before);
  }
});

test('one phase block cannot consume a future declared trial epoch', async () => {
  const f = await fixture(); f.config.frozenAt = '2026-10-20T00:00:00Z';
  jest.setSystemTime(new Date('2026-10-22T09:00:00Z')); f.controller.blockCurrentEpoch();
  const blocks = JSON.parse(f.getString(f.KEYS.helpEnrollmentBlocks)!);
  expect(blocks).toEqual([{ phase: 'baseline', epoch: f.config.baseline.eligibilityEpoch }]);
  f.config.frozenAt = '2026-11-02T01:00:00Z'; jest.setSystemTime(T);
  expect(f.controller.prepare(f.input).status).toBe('trial_first');
});

test('a changed or missing profile owner revokes the current epoch instead of assigning another player', async () => {
  const f = await fixture(); expect(f.controller.prepare(f.input).captured).toBe(true);
  f.gate.token = null; expect(f.controller.resolve(f.input.flow)).toBe('control');
  f.gate.token = 'other_owner'; f.controller.observeIdentity(); expect(f.getString(f.KEYS.helpEnrollment)).toBeNull();
  f.gate.token = 'fixture_owner'; f.controller.observeIdentity();
  expect(f.controller.prepare(f.input).captured).toBe(false);
});

test('changing a declared epoch cannot silently replace an existing same-experiment trial claim', async () => {
  const f = await fixture(); expect(f.controller.prepare(f.input).captured).toBe(true);
  const original = JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims;
  f.config.trial.eligibilityEpoch = 'replacement_epoch'; f.config.trial.allocationVersion = 2;
  expect(f.controller.prepare(f.input)).toMatchObject({ status: 'unknown', captured: false, uxVariant: 'control' });
  expect(JSON.parse(f.getString(f.KEYS.helpEnrollment)!).claims).toEqual(original);
});
