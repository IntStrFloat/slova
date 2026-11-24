import { DEFAULT_POLICY, getAttemptPolicy, getConfiguredPolicy, getRuntimePolicy, policyId, setAttemptPolicy,
  setConfiguredPolicy, setRuntimePolicyGuard, type PolicyAssignment, type PolicyParameter,
  type RuntimePolicySnapshot } from '@/core/config/runtimePolicy';
import { parseRemotePolicy, selectRemotePolicy, type RemotePolicyDocument } from './policy';

export const REMOTE_CONFIG_CACHE_KEY = 'remote-config.document.v1';
export const REMOTE_CONFIG_ACTIVE_KEY = 'remote-config.active.v1';
const CACHE_TTL = 7 * 86_400_000;
const FETCH_TTL = 15 * 60_000;
const FETCH_TIMEOUT = 4000;
export type ConfigFetchResult = { status: 'success'; json: string }
  | { status: 'unavailable' | 'retryable' | 'terminal' | 'cancelled'; reason: string };
type Event = 'config_fetch_result' | 'config_apply_result';
type Diagnostics = { result: string; reason: string; fallback_used: boolean; config_schema_version: number; config_version?: string; age_bucket: string };
type Cache = { version: 1; scope: string; fetchedAt: number; document: RemotePolicyDocument };
let activeOwner: object | null = null;
export interface RemoteConfigDependencies {
  enabled: boolean; now(): number; scope(): string; consent(): boolean;
  assignment(id: string, allocationVersion: number): PolicyAssignment | null;
  pinnedAssignment?(assignment: PolicyAssignment): boolean;
  fetch(): Promise<ConfigFetchResult>;
  read(key: string): string | null; write(key: string, value: string): boolean; remove(key: string): void;
  event(event: Event, properties: Diagnostics): void;
  exposure(snapshot: RuntimePolicySnapshot, parameter: PolicyParameter, point: string): boolean | void;
  context?(snapshot: RuntimePolicySnapshot): void;
}

export function createRemoteConfigCoordinator(deps: RemoteConfigDependencies) {
  const owner = {};
  let scope = '', generation = 0, pending: Cache | null = null, nextFetch = 0;
  let inFlight: Promise<void> | null = null;
  let activeCache: Cache | null = null, suppressedCache: Cache | null = null;
  let running = false;
  const exposed = new Set<string>();
  const enabled = () => activeOwner === owner && running && deps.enabled && deps.consent() && policyId(deps.scope());
  const assignmentFor = (document: RemotePolicyDocument) => document.fetch_enabled
    ? deps.assignment(document.experiment_id, document.allocation_version) : null;
  const diagnostics = (event: Event, result: string, reason: string, snapshot?: RuntimePolicySnapshot, fetchedAt?: number) => {
    const age = fetchedAt === undefined ? null : Math.max(0, deps.now() - fetchedAt);
    try { deps.event(event, { result, reason, config_schema_version: 1, fallback_used: !snapshot?.assignment,
      ...(snapshot ? { config_version: snapshot.configVersion } : {}),
      age_bucket: age === null ? 'unknown' : age < 86_400_000 ? 'under_day' : age < CACHE_TTL ? 'under_week' : 'expired' }); } catch { /* telemetry never gates gameplay */ }
  };
  const setContext = () => { try { deps.context?.(getRuntimePolicy()); } catch { /* optional telemetry */ } };
  const fresh = (cache: Cache) => Number.isFinite(cache.fetchedAt) && cache.fetchedAt >= 0
    && deps.now() - cache.fetchedAt >= -60_000 && deps.now() - cache.fetchedAt < CACHE_TTL;
  const selection = (cache: Cache) => cache.scope === deps.scope() && fresh(cache)
    ? selectRemotePolicy(cache.document, assignmentFor(cache.document), cache.scope) : null;
  function readCache(key: string): Cache | null {
    try {
      const raw = deps.read(key);
      if (!raw || raw.length > 20_000) return null;
      const value = JSON.parse(raw) as Partial<Cache>;
      const parsed = parseRemotePolicy(JSON.stringify(value.document));
      return value.version === 1 && value.scope === scope && typeof value.fetchedAt === 'number' && parsed.ok
        ? { version: 1, scope, fetchedAt: value.fetchedAt, document: parsed.document } : null;
    } catch { return null; }
  }
  function writeCache(key: string, cache: Cache): boolean {
    try { return deps.write(key, JSON.stringify(cache)); } catch { return false; }
  }
  function clear() {
    generation += 1; pending = null; activeCache = null; suppressedCache = null; inFlight = null; nextFetch = 0; exposed.clear();
    setConfiguredPolicy(DEFAULT_POLICY); setAttemptPolicy(undefined);
    for (const key of [REMOTE_CONFIG_CACHE_KEY, REMOTE_CONFIG_ACTIVE_KEY]) {
      try { deps.remove(key); } catch { /* mismatched scope/consent still prevents reads */ }
    }
    setContext();
  }
  function start() {
    activeOwner = owner;
    running = true;
    scope = deps.scope();
    pending = null; activeCache = null; suppressedCache = null;
    setConfiguredPolicy(DEFAULT_POLICY);
    setRuntimePolicyGuard((snapshot) => {
      if (!enabled() || snapshot.profileScope !== deps.scope() || !snapshot.assignment) return false;
      if (getAttemptPolicy() === snapshot && deps.pinnedAssignment?.(snapshot.assignment)) return true;
      if (!activeCache || !fresh(activeCache)) return false;
      const current = deps.assignment(snapshot.assignment.experiment_id, snapshot.assignment.allocation_version);
      return current?.assignment_id === snapshot.assignment.assignment_id && current.variant === snapshot.assignment.variant;
    });
    if (!enabled()) { clear(); return; }
    const active = readCache(REMOTE_CONFIG_ACTIVE_KEY);
    if (active) {
      const snapshot = selection(active);
      if (snapshot) { activeCache = active; setConfiguredPolicy(snapshot); }
    }
    const cached = readCache(REMOTE_CONFIG_CACHE_KEY);
    if (cached && selection(cached)) pending = cached;
    suppressedCache = [active, cached].filter((cache): cache is Cache => !!cache && fresh(cache) && !cache.document.fetch_enabled)
      .sort((left, right) => right.fetchedAt - left.fetchedAt)[0] ?? null;
    setContext();
  }
  function identityChanged() {
    if (activeOwner !== owner) return;
    const nextScope = deps.scope();
    if (nextScope !== scope || !enabled()) { clear(); scope = nextScope; }
  }
  function refresh(): Promise<void> {
    identityChanged();
    if (suppressedCache && !fresh(suppressedCache)) suppressedCache = null;
    if (nextFetch - deps.now() > FETCH_TTL) nextFetch = 0;
    if (!enabled() || suppressedCache || deps.now() < nextFetch) return Promise.resolve();
    if (inFlight) return inFlight;
    const requestScope = scope, requestGeneration = generation;
    nextFetch = deps.now() + FETCH_TTL;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
      let result: ConfigFetchResult | { status: 'timeout'; reason: 'timeout' };
      try {
        result = await Promise.race([deps.fetch(), new Promise<{ status: 'timeout'; reason: 'timeout' }>((resolve) => {
          timer = setTimeout(() => resolve({ status: 'timeout', reason: 'timeout' }), FETCH_TIMEOUT);
        })]);
      } catch { result = { status: 'retryable', reason: 'gateway_error' }; }
      finally { if (timer) clearTimeout(timer); }
      if (requestGeneration !== generation || requestScope !== deps.scope() || !enabled()) return;
      if (result.status !== 'success') {
        const reasons = ['timeout', 'network', 'restart_required', 'missing_capability', 'not_initialized', 'missing_parameter', 'disabled', 'invalid_payload', 'oversized_payload'];
        diagnostics('config_fetch_result', result.status, reasons.includes(result.reason) ? result.reason : 'unavailable'); return;
      }
      const parsed = parseRemotePolicy(result.json);
      if (!parsed.ok) { diagnostics('config_fetch_result', 'rejected', 'invalid_payload'); return; }
      const cache: Cache = { version: 1, scope, fetchedAt: deps.now(), document: parsed.document };
      const snapshot = selection(cache);
      if (!snapshot) { diagnostics('config_fetch_result', 'rejected', 'assignment_missing'); return; }
      if (!writeCache(REMOTE_CONFIG_CACHE_KEY, cache)) { diagnostics('config_fetch_result', 'error', 'storage_failed'); return; }
      pending = cache;
      if (!cache.document.fetch_enabled) suppressedCache = cache;
      diagnostics('config_fetch_result', 'success', 'fetched', snapshot, cache.fetchedAt);
    })().catch(() => { diagnostics('config_fetch_result', 'error', 'unavailable'); });
    inFlight = work;
    void work.finally(() => { if (inFlight === work) inFlight = null; });
    return work;
  }
  function applyAtSafePoint(safe: boolean): boolean {
    identityChanged();
    if (!safe || !enabled()) return false;
    let expired = false;
    if (activeCache && !fresh(activeCache)) {
      const fetchedAt = activeCache.fetchedAt;
      activeCache = null;
      try { deps.remove(REMOTE_CONFIG_ACTIVE_KEY); } catch { /* freshness guard still prevents reuse */ }
      setConfiguredPolicy(DEFAULT_POLICY); setContext();
      diagnostics('config_apply_result', 'fallback', 'cache_expired', DEFAULT_POLICY, fetchedAt);
      expired = true;
    }
    if (!pending) return expired;
    const snapshot = selection(pending);
    if (!snapshot) { pending = null; return expired; }
    const unchanged = JSON.stringify(getConfiguredPolicy()) === JSON.stringify(snapshot);
    if (!writeCache(REMOTE_CONFIG_ACTIVE_KEY, pending)) { diagnostics('config_apply_result', 'error', 'storage_failed'); return expired; }
    const fetchedAt = pending.fetchedAt;
    activeCache = pending;
    if (unchanged) {
      pending = null;
      diagnostics('config_apply_result', 'refreshed', 'same_snapshot', snapshot, fetchedAt);
      return expired;
    }
    setConfiguredPolicy(snapshot); pending = null; setContext();
    diagnostics('config_apply_result', 'applied', 'safe_boundary', snapshot, fetchedAt);
    return true;
  }
  function used(parameter: PolicyParameter, point: string): void {
    const snapshot = getRuntimePolicy();
    if (!enabled() || !snapshot.assignment || snapshot.parameter !== parameter || !policyId(point)) return;
    const key = `${snapshot.assignment.assignment_id}:${parameter}`;
    if (exposed.has(key)) return;
    setContext();
    try { if (deps.exposure(snapshot, parameter, point) !== false) exposed.add(key); } catch { /* retry at next real use */ }
  }
  return { start, refresh, applyAtSafePoint, identityChanged, used,
    syncContext: setContext, stop: () => {
      running = false; generation += 1; pending = null; inFlight = null;
      if (activeOwner === owner) { activeOwner = null; setRuntimePolicyGuard(() => false); }
    } };
}
