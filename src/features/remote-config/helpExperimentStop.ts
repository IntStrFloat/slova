import { HELP_EXPERIMENT_ID, helpSafeId } from '@/core/config/helpExperiment';
import type { HelpExperimentControlFetchResult } from '../../../modules/rustore-remote-config';

export const HELP_EXPERIMENT_STOP_KEY = 'slova_help_experiment_stop_v1' as const;
export const HELP_STOP_POLL_MS = 30_000;
export const HELP_STOP_LEASE_MS = 60_000;
export const HELP_STOP_TIMEOUT_MS = 4_000;
const MAX_PAYLOAD_BYTES = 16_384;
const ARMS = Object.freeze(['control', 'treatment'] as const);
export type StopVariant = typeof ARMS[number];
export type StopScope = Readonly<{ experimentId: typeof HELP_EXPERIMENT_ID; eligibilityEpoch: string; allocationVersion: number }>;
export type StopContext = Readonly<{ active: boolean; foreground: boolean; consentGranted: boolean;
  scope: StopScope | null; consentGeneration?: number }>;
export type StopFact = Readonly<{ scope: StopScope; revision: number; disabledVariants: readonly StopVariant[] }>;
export type StopSnapshot = Readonly<{ connected: boolean; enrollmentAllowed: boolean; disabledVariants: readonly StopVariant[];
  scope: StopScope | null; revision: number | null; leaseExpiresAt: number | null; reason: string }>;
export type HelpExperimentStopDocument = Readonly<StopScope & { schemaVersion: 1; revision: number; disabledVariants: readonly StopVariant[] }>;
export type HelpExperimentStopAdapterOptions = {
  readStopped(scope: StopScope): readonly StopVariant[];
  /** Return true only after durable, identifier-free arm-union readback. */
  onStop(fact: StopFact): boolean;
  fetch?(): Promise<HelpExperimentControlFetchResult>;
  now?(): number;
  /** Elapsed milliseconds independent of wall-clock changes; production uses performance.now(). */
  monotonicNow?(): number;
};
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validScope = (scope: StopScope | null): scope is StopScope => !!scope && scope.experimentId === HELP_EXPERIMENT_ID
  && helpSafeId(scope.eligibilityEpoch) && positive(scope.allocationVersion);
const keyOf = (scope: StopScope) => `${scope.experimentId}:${scope.eligibilityEpoch}:${scope.allocationVersion}`;
const variantsValid = (value: unknown): value is readonly StopVariant[] => Array.isArray(value) && value.length <= 2
  && value.every((arm) => ARMS.includes(arm)) && new Set(value).size === value.length;
const union = (...values: readonly (readonly StopVariant[])[]) => Object.freeze(ARMS.filter((arm) => values.some((value) => value.includes(arm))));

function payloadBytes(json: string): number {
  let length = 0;
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = json.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return Infinity;
      length += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) return Infinity;
    else length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
  }
  return length;
}

/** Flat v1 schema. Scan complete JSON string tokens so escaped duplicate property names are rejected too. */
export function parseHelpExperimentStopDocument(json: string): HelpExperimentStopDocument | null {
  if (typeof json !== 'string' || json.length > MAX_PAYLOAD_BYTES || payloadBytes(json) > MAX_PAYLOAD_BYTES) return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const seen = new Set<string>();
    for (const token of json.matchAll(/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/g)) {
      if (!/^\s*:/.test(json.slice(token.index! + token[0].length))) continue;
      const name = JSON.parse(token[0]) as string;
      if (seen.has(name)) return null;
      seen.add(name);
    }
  } catch { return null; }
  const keys = ['schemaVersion', 'experimentId', 'eligibilityEpoch', 'allocationVersion', 'revision', 'disabledVariants'];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))
    || value.schemaVersion !== 1 || value.experimentId !== HELP_EXPERIMENT_ID || !helpSafeId(value.eligibilityEpoch)
    || !positive(value.allocationVersion) || !positive(value.revision) || !variantsValid(value.disabledVariants)) return null;
  return Object.freeze({ schemaVersion: 1, experimentId: HELP_EXPERIMENT_ID, eligibilityEpoch: value.eligibilityEpoch,
    allocationVersion: value.allocationVersion, revision: value.revision, disabledVariants: union(value.disabledVariants) });
}

/** Live transport lease only. It never enables the shared SDK, allocates players, or persists an allow. */
export function createHelpExperimentStopAdapter(options: HelpExperimentStopAdapterOptions) {
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : NaN);
  const fetch = options.fetch ?? (async () => {
    // Dormant with all-off config. Application.onCreate remains the only SDK singleton owner.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bridge = require('../../../modules/rustore-remote-config') as typeof import('../../../modules/rustore-remote-config');
    return bridge.fetchHelpExperimentControl();
  });
  let context: StopContext = { active: false, foreground: false, consentGranted: false, scope: null };
  let generation = 0, disposed = false, deniedReason = 'inactive';
  const listeners = new Set<(snapshot: StopSnapshot) => void>();
  const records = new Map<string, { arms: readonly StopVariant[]; revision: number; signature: string;
    durableRevision: number; persistFailed: boolean }>();
  type Clock = { wall: number; elapsed: number };
  let lastClock: Clock | null = null;
  let live: { fetchedAt: number; fetchedElapsed: number; expiresAt: number; revision: number } | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined, expiryTimer: ReturnType<typeof setTimeout> | undefined;
  type Request = { work: Promise<void>; cancel(): void; timer?: ReturnType<typeof setTimeout> };
  let request: Request | null = null;
  let snapshot: StopSnapshot = Object.freeze({ connected: false, enrollmentAllowed: false, disabledVariants: ARMS,
    scope: null, revision: null, leaseExpiresAt: null, reason: 'inactive' });

  function gateReason(): string | null {
    if (disposed) return 'disposed';
    if (!context.active) return 'inactive';
    if (!context.consentGranted) return 'consent_required';
    if (!context.foreground) return 'background';
    if (!validScope(context.scope) || context.consentGeneration !== undefined
      && (!Number.isSafeInteger(context.consentGeneration) || context.consentGeneration < 0)) return 'invalid_scope';
    return null;
  }
  function publish(next: StopSnapshot): void {
    if (snapshot.connected === next.connected && snapshot.enrollmentAllowed === next.enrollmentAllowed
      && snapshot.reason === next.reason && snapshot.revision === next.revision && snapshot.leaseExpiresAt === next.leaseExpiresAt
      && (snapshot.scope ? keyOf(snapshot.scope) : null) === (next.scope ? keyOf(next.scope) : null)
      && snapshot.disabledVariants.join() === next.disabledVariants.join()) return;
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) { try { listener(snapshot); } catch { /* UI observers cannot authorize a lease. */ } }
  }
  function deny(reason: string): void {
    live = null; deniedReason = reason;
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    expiryTimer = undefined;
    publish({ connected: false, enrollmentAllowed: false, disabledVariants: ARMS,
      scope: validScope(context.scope) ? context.scope : null, revision: null, leaseExpiresAt: null, reason });
  }
  function stopped(scope: StopScope): readonly StopVariant[] | null {
    try {
      const stored = options.readStopped(scope);
      if (!variantsValid(stored)) return null;
      let record = records.get(keyOf(scope));
      if (!record && stored.length) {
        record = { arms: union(stored), revision: 0, signature: '', durableRevision: 0, persistFailed: false };
        records.set(keyOf(scope), record);
      }
      if (record) record.arms = union(record.arms, stored);
      return union(record?.arms ?? [], stored);
    } catch { return null; }
  }
  function readClock(): Clock | null {
    let clock: Clock | null = null;
    try {
      const wall = now(), elapsed = monotonicNow();
      if (Number.isSafeInteger(wall) && wall >= 0 && Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= Number.MAX_SAFE_INTEGER
        && (!lastClock || wall >= lastClock.wall && elapsed >= lastClock.elapsed)) clock = { wall, elapsed };
    } catch { /* A clock capability failure cannot be replaced by a wall-only lease. */ }
    if (!clock) {
      generation += 1; cancelRequest(); clearTimers(); lastClock = null;
      deny('clock_invalid');
      if (!request) schedulePoll();
      return null;
    }
    lastClock = clock;
    return clock;
  }
  function getSnapshot(): StopSnapshot {
    const gate = gateReason();
    if (gate) { deny(gate); return snapshot; }
    const arms = stopped(context.scope!);
    if (!arms || records.get(keyOf(context.scope!))?.persistFailed) { deny('storage_failure'); return snapshot; }
    const clock = readClock();
    if (!clock) return snapshot;
    if (live) {
      if (clock.elapsed - live.fetchedElapsed >= HELP_STOP_LEASE_MS || clock.wall >= live.expiresAt) deny('lease_expired');
      else publish({ connected: true, enrollmentAllowed: arms.length === 0, disabledVariants: arms, scope: context.scope,
        revision: live.revision, leaseExpiresAt: live.expiresAt, reason: arms.length ? 'remote_stop' : 'ready' });
    } else deny(deniedReason);
    return snapshot;
  }
  function clearTimers(): void {
    if (pollTimer !== undefined) clearTimeout(pollTimer);
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    pollTimer = undefined; expiryTimer = undefined;
  }
  function cancelRequest(): void {
    const previous = request; request = null;
    if (previous?.timer !== undefined) clearTimeout(previous.timer);
    previous?.cancel();
  }
  function schedulePoll(): void {
    if (pollTimer !== undefined) clearTimeout(pollTimer);
    pollTimer = undefined;
    if (!gateReason()) pollTimer = setTimeout(() => { pollTimer = undefined; void refresh(); }, HELP_STOP_POLL_MS);
  }
  function refresh(): Promise<void> {
    const beforeClockCheck = generation;
    getSnapshot();
    if (gateReason() || beforeClockCheck !== generation) return Promise.resolve();
    if (request) return request.work;
    const startedAt = readClock();
    if (!startedAt) return Promise.resolve();
    const scope = context.scope!, scopeKey = keyOf(scope), requestGeneration = generation;
    let cancel!: () => void;
    const cancelled = new Promise<'context_cancelled'>((resolve) => { cancel = () => resolve('context_cancelled'); });
    const owned: Request = { work: Promise.resolve(), cancel };
    const timeout = new Promise<HelpExperimentControlFetchResult>((resolve) => {
      owned.timer = setTimeout(() => resolve({ status: 'retryable', reason: 'timeout' }), HELP_STOP_TIMEOUT_MS);
    });
    const fetched = Promise.resolve().then(() => {
      if (requestGeneration !== generation || gateReason()) return { status: 'cancelled' as const, reason: 'disabled' };
      return fetch();
    }).catch((): HelpExperimentControlFetchResult => ({ status: 'retryable', reason: 'unavailable' }));
    owned.work = Promise.race([fetched, timeout, cancelled]).then((result) => {
      if (result === 'context_cancelled' || requestGeneration !== generation || gateReason() || !context.scope || keyOf(context.scope) !== scopeKey) return;
      if (!result || typeof result !== 'object') { deny('invalid_payload'); return; }
      const clock = readClock();
      if (!clock) return;
      if (clock.elapsed - startedAt.elapsed >= HELP_STOP_TIMEOUT_MS || clock.wall - startedAt.wall >= HELP_STOP_TIMEOUT_MS) { deny('timeout'); return; }
      if (result.status !== 'success') {
        const reasons = ['timeout', 'network', 'restart_required', 'missing_capability', 'not_initialized', 'missing_parameter', 'disabled',
          'background', 'invalid_payload', 'oversized_payload'];
        deny(reasons.includes(result.reason) ? result.reason : 'unavailable'); return;
      }
      if (result.source !== 'actual_sdk_fetch') { deny('invalid_payload'); return; }
      const document = parseHelpExperimentStopDocument(result.json);
      if (!document) { deny('invalid_payload'); return; }
      if (keyOf(document) !== scopeKey) { deny('wrong_scope'); return; }
      const storedArms = stopped(scope);
      if (!storedArms) { deny('storage_failure'); return; }
      const record = records.get(scopeKey) ?? { arms: storedArms, revision: 0, signature: '', durableRevision: 0, persistFailed: false };
      const signature = document.disabledVariants.join();
      if (document.revision < record.revision) { deny('stale_revision'); return; }
      if (document.revision === record.revision && signature !== record.signature) { deny('revision_conflict'); return; }
      record.revision = document.revision; record.signature = signature;
      record.arms = union(record.arms, storedArms, document.disabledVariants);
      records.set(scopeKey, record);
      if (document.disabledVariants.length && document.revision > record.durableRevision || record.persistFailed
        || record.arms.some((arm) => !storedArms.includes(arm))) {
        // The synchronous durable writer may notify UI observers before it returns its readback result.
        record.persistFailed = true;
        try { record.persistFailed = options.onStop(Object.freeze({ scope, revision: document.revision, disabledVariants: record.arms })) !== true; }
        catch { record.persistFailed = true; }
        if (record.persistFailed) { deny('storage_failure'); return; }
        record.durableRevision = document.revision;
      }
      if (requestGeneration !== generation || gateReason()) return;
      live = { fetchedAt: clock.wall, fetchedElapsed: clock.elapsed, expiresAt: clock.wall + HELP_STOP_LEASE_MS, revision: document.revision };
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => { expiryTimer = undefined; getSnapshot(); }, HELP_STOP_LEASE_MS);
      getSnapshot();
    }).finally(() => {
      if (owned.timer !== undefined) clearTimeout(owned.timer);
      if (request === owned) { request = null; schedulePoll(); }
    });
    request = owned;
    return owned.work;
  }
  function updateContext(next: StopContext): void {
    if (disposed) return;
    const scope = validScope(next.scope) ? Object.freeze({ experimentId: next.scope.experimentId,
      eligibilityEpoch: next.scope.eligibilityEpoch, allocationVersion: next.scope.allocationVersion }) : null;
    const nextContext = { active: next.active === true, foreground: next.foreground === true,
      consentGranted: next.consentGranted === true, scope, consentGeneration: next.consentGeneration };
    if (context.active === nextContext.active && context.foreground === nextContext.foreground
      && context.consentGranted === nextContext.consentGranted && context.consentGeneration === nextContext.consentGeneration
      && (context.scope ? keyOf(context.scope) : null) === (scope ? keyOf(scope) : null)) { getSnapshot(); return; }
    generation += 1; cancelRequest(); clearTimers(); lastClock = null; context = nextContext;
    deny(gateReason() ?? 'pending');
    if (!gateReason()) void refresh();
  }
  function stop(): void {
    if (disposed) return;
    generation += 1; cancelRequest(); clearTimers(); lastClock = null;
    context = { active: false, foreground: false, consentGranted: false, scope: null };
    deny('inactive');
  }
  return { updateContext, getSnapshot, refresh, stop,
    subscribe: (listener: (value: StopSnapshot) => void) => {
      if (disposed) return () => {};
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    dispose: () => { if (disposed) return; stop(); disposed = true; deny('disposed'); listeners.clear(); },
  };
}
