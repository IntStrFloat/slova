import { getFullscreenSnapshot, releaseFullscreen, tryAcquireFullscreen } from '@/core/fullscreen';
import { analyticsKeyToken } from '@/features/analytics/dedupe';
import { validVersion, type CheckResult, type DownloadEvent, type DownloadState, type FlowResult, type UpdatesGateway } from '../../../modules/rustore-updates/types';

export const UPDATES_STATE_KEY = 'updates.state.v1';
export const UPDATES_RESULT_KEY = 'updates.result-attempt.v1';
export const AVAILABILITY_TTL_MS = 15 * 60_000;
export const OFFER_COOLDOWN_MS = 86_400_000;
const QUERY_TIMEOUT_MS = 4_000;
type EventName = 'update_check_result' | 'update_flow_result' | 'update_download_state' | 'update_version_observed';
type Properties = Record<string, string | number | boolean>;
export interface UpdatesDependencies {
  gateway: UpdatesGateway; enabled(): boolean; foreground(): boolean; scope(): string; now(): number;
  nativeFormBusy(): boolean; nativeRewardedBusy(): Promise<boolean>;
  read(): string | null; write(value: string): boolean;
  readResultMarker(): string | null; writeResultMarker(value: string): boolean;
  event(name: EventName, properties: Properties, onceKey?: string): void;
}
type RecordState = { version: 1; previousVersion: string; targetVersion?: string; attemptNo: number;
  offerUntil: number; installUntil: number; pending: boolean };
export type UpdatesSnapshot = Readonly<{ status: 'idle' | CheckResult['result'] | DownloadEvent['state']; versionCode?: string; busy: boolean; revision: number; canAct: boolean; manualAvailable: boolean }>;
export type UpdateActionResult = FlowResult & { attempted: boolean };
export type UpdateIntent = Readonly<{ versionCode: string; action: 'offer' | 'install' }>;
const validAttempt = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,191}$/i.test(value);
export function isNewerVersion(target: unknown, installed: unknown): boolean {
  return validVersion(target) && validVersion(installed) && (target.length > installed.length || target.length === installed.length && target > installed);
}

export function createUpdatesCoordinator(deps: UpdatesDependencies) {
  let running = false, generation = 0, lastQueryAt: number | null = null;
  let operation: { nativeOpen: boolean } | null = null;
  let current: CheckResult | null = null, inFlight: Promise<CheckResult> | null = null;
  let record: RecordState | null = null, storageValid = true, stopListener = () => {};
  let lastDownloadEvent = '';
  let observationRevision = 0;
  let snapshot: UpdatesSnapshot = Object.freeze({ status: 'idle', busy: false, revision: 0, canAct: false, manualAvailable: false });
  const listeners = new Set<() => void>();
  const enabled = () => running && deps.enabled() && deps.gateway.isSupported();
  const nativeBusy = () => { try { return deps.nativeFormBusy(); } catch { return true; } };
  const emit = (name: EventName, properties: Properties, onceKey?: string) => {
    try { deps.event(name, properties, onceKey); } catch { /* Analytics never controls an update or a saved result. */ }
  };
  function publish(status = snapshot.status, versionCode = snapshot.versionCode) {
    const busy = operation !== null;
    const until = current?.result === 'available' && current.state === 'downloaded' ? record?.installUntil : record?.offerUntil;
    snapshot = Object.freeze({ status, ...(versionCode ? { versionCode } : {}), busy, revision: snapshot.revision + 1, manualAvailable: running && deps.enabled(),
      canAct: enabled() && !busy && ['available', 'downloaded', 'failed', 'interrupted'].includes(status) && storageValid && deps.now() >= (until ?? 0) });
    for (const listener of [...listeners]) { try { listener(); } catch { /* Observer cannot own a request. */ } }
  }
  function persist(next: RecordState): boolean {
    try { if (!deps.write(JSON.stringify(next))) return false; record = next; return true; } catch { return false; }
  }
  function stateNeedsRecovery(state: DownloadState, fallback: boolean): boolean {
    if (['pending', 'downloading', 'downloaded', 'installing'].includes(state)) return true;
    if (state === 'failed' || state === 'interrupted') return false;
    return fallback; // UNKNOWN alone never proves remote cancellation.
  }
  function observationNeedsRecovery(result: CheckResult | null, fallback: boolean): boolean {
    if (result?.result === 'none' || result?.result === 'cancelled') return false;
    return result?.result === 'available' ? stateNeedsRecovery(result.state, fallback) : fallback;
  }
  function readRecord(): void {
    storageValid = true;
    try {
      const raw = deps.read();
      if (raw === null) { record = null; return; }
      if (raw.length > 2048) throw Error('size');
      const v = JSON.parse(raw) as Partial<RecordState>;
      if (v.version !== 1 || !validVersion(v.previousVersion) || v.targetVersion !== undefined && !validVersion(v.targetVersion)
        || !Number.isSafeInteger(v.attemptNo) || (v.attemptNo ?? -1) < 0 || (v.attemptNo ?? 0) > 1_000_000
        || typeof v.pending !== 'boolean' || !Number.isSafeInteger(v.offerUntil) || (v.offerUntil ?? -1) < 0
        || !Number.isSafeInteger(v.installUntil) || (v.installUntil ?? -1) < 0) throw Error('schema');
      record = { version: 1, previousVersion: v.previousVersion, ...(v.targetVersion ? { targetVersion: v.targetVersion } : {}),
        attemptNo: v.attemptNo!, pending: v.pending, offerUntil: v.offerUntil!, installUntil: v.installUntil! };
    } catch { record = null; storageValid = false; }
  }
  function observeVersion() {
    const actual = deps.gateway.getNativeVersionCode();
    if (!validVersion(actual) || !storageValid) return;
    if (!record) {
      storageValid = persist({ version: 1, previousVersion: actual, attemptNo: 0, offerUntil: 0, installUntil: 0, pending: false });
    } else if (actual !== record.previousVersion) {
      if (isNewerVersion(actual, record.previousVersion)) emit('update_version_observed', { result: 'version_observed', reason: 'package_manager', source: 'unknown',
        previous_version_code: record.previousVersion, installed_version_code: actual,
        ...(record.targetVersion ? { target_version_code: record.targetVersion } : {}) }, `native-version:${record.previousVersion}:${actual}`);
      storageValid = persist({ version: 1, previousVersion: actual, attemptNo: record.attemptNo, offerUntil: 0, installUntil: 0, pending: false });
      current = null; lastQueryAt = null;
    }
  }
  function markResultAttempt(attemptId: string): boolean {
    if (!validAttempt(attemptId)) return false;
    const encoded = JSON.stringify({ version: 1, attemptId, scope: analyticsKeyToken(deps.scope()) });
    try { return deps.writeResultMarker(encoded) && deps.readResultMarker() === encoded; } catch { return false; }
  }
  function hasResultAttempt(attemptId: string | undefined): boolean {
    if (!validAttempt(attemptId)) return false;
    try {
      const raw = deps.readResultMarker();
      if (!raw || raw.length > 512) return false;
      const marker = JSON.parse(raw) as { version?: unknown; attemptId?: unknown; scope?: unknown };
      return marker.version === 1 && marker.attemptId === attemptId && typeof marker.scope === 'string'
        && /^[0-9a-f]{32}$/.test(marker.scope) && marker.scope === analyticsKeyToken(deps.scope());
    } catch { return false; }
  }
  function download(event: DownloadEvent) {
    if (!enabled() || !record?.targetVersion || event.versionCode !== record.targetVersion) return;
    const key = `${event.versionCode}:${event.state}:${event.errorCode ?? 0}`;
    if (lastDownloadEvent === key) return;
    lastDownloadEvent = key;
    observationRevision += 1;
    emit('update_download_state', { stage: event.state, result: event.state, target_version_code: event.versionCode,
      ...(event.errorCode === undefined ? {} : { error_code: event.errorCode }) });
    if (current?.result === 'available') current = { ...current, state: event.state };
    persist({ ...record, pending: operation?.nativeOpen === true || stateNeedsRecovery(event.state, record.pending) });
    publish(event.state, event.versionCode);
  }
  function start() {
    if (running) return stop;
    running = true; generation += 1; readRecord(); observeVersion();
    if (enabled()) stopListener = deps.gateway.subscribe(download);
    publish();
    return stop;
  }
  function stop() {
    if (!running) return;
    running = false; generation += 1; stopListener(); stopListener = () => {};
    deps.gateway.discard(); current = null; lastQueryAt = null; inFlight = null;
    // An open form keeps its exact JS/native ownership until its actual terminal callback.
  }
  function refresh(force = false): Promise<CheckResult> {
    if (!enabled()) return Promise.resolve({ result: 'unavailable', reason: 'disabled' });
    if (inFlight) return inFlight;
    if (current?.result === 'available' && current.installedVersionCode !== deps.gateway.getNativeVersionCode()) {
      current = null; lastQueryAt = null;
    }
    const age = lastQueryAt === null ? Infinity : deps.now() - lastQueryAt;
    if (!force && !record?.pending && current && age >= 0 && age < AVAILABILITY_TTL_MS) return Promise.resolve(current);
    const requestGeneration = generation, requestScope = deps.scope();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work: Promise<CheckResult> = (async (): Promise<CheckResult> => {
      let result: CheckResult;
      try {
        result = await Promise.race([deps.gateway.checkAvailability(), new Promise<CheckResult>((resolve) => {
          timer = setTimeout(() => {
            if (inFlight === work && generation === requestGeneration && running) deps.gateway.discard();
            resolve({ result: 'retryable_error', reason: 'timeout' });
          }, QUERY_TIMEOUT_MS);
        })]);
      } catch { result = { result: 'retryable_error', reason: 'gateway_error' }; }
      finally { if (timer) clearTimeout(timer); }
      if (!enabled() || generation !== requestGeneration || deps.scope() !== requestScope) return { result: 'unavailable', reason: 'context_changed' };
      if (result.result === 'available' && (!isNewerVersion(result.versionCode, result.installedVersionCode)
        || result.installedVersionCode !== deps.gateway.getNativeVersionCode())) result = { result: 'unavailable', reason: 'invalid_version' };
      current = result; lastQueryAt = deps.now();
      observationRevision += 1;
      if (record) persist({ ...record,
        ...(result.result === 'available' && result.state !== 'unknown' ? { targetVersion: result.versionCode } : {}),
        pending: operation?.nativeOpen === true || observationNeedsRecovery(result, record.pending) });
      publish(result.result === 'available' ? result.state === 'unknown' ? 'available' : result.state : result.result,
        result.result === 'available' ? result.versionCode : undefined);
      emit('update_check_result', { result: result.result, reason: result.result === 'available' ? 'newer_version' : result.reason,
        ...(result.result === 'available' ? { target_version_code: result.versionCode } : {}) });
      return result;
    })();
    inFlight = work;
    void work.finally(() => { if (inFlight === work) inFlight = null; });
    return work;
  }
  async function request(isSafePoint: () => boolean, displayedIntent: UpdateIntent | undefined, resultAttemptId: string): Promise<UpdateActionResult> {
    const refused = (reason: string): UpdateActionResult => ({ result: 'unavailable', reason, attempted: false });
    const safe = () => { try { return isSafePoint() === true && deps.foreground(); } catch { return false; } };
    const intent = displayedIntent ? { ...displayedIntent } : current?.result === 'available'
      ? { versionCode: current.versionCode, action: current.state === 'downloaded' ? 'install' as const : 'offer' as const } : null;
    if (intent && (!validVersion(intent.versionCode) || !['offer', 'install'].includes(intent.action))) return refused('invalid_intent');
    if (!validAttempt(resultAttemptId)) return refused('invalid_result');
    if (!enabled() || operation !== null || !storageValid || !safe() || nativeBusy() || getFullscreenSnapshot().owner !== null) return refused('unsafe_point');
    const lease = tryAcquireFullscreen('update');
    if (!lease) return refused('fullscreen_busy');
    const requestOperation = { nativeOpen: false };
    operation = requestOperation; publish();
    const requestGeneration = generation, requestScope = deps.scope();
    const live = () => enabled() && generation === requestGeneration && deps.scope() === requestScope && safe() && !nativeBusy();
    let attempted = false;
    let refreshAfterTerminal = false;
    try {
      let rewardTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const nativeBusy = await Promise.race([deps.nativeRewardedBusy(), new Promise<boolean>((resolve) => {
          rewardTimer = setTimeout(() => resolve(true), 1000);
        })]);
        if (nativeBusy) return refused('native_rewarded_busy');
      } catch { return refused('native_rewarded_unknown'); }
      finally { if (rewardTimer) clearTimeout(rewardTimer); }
      if (!live()) return refused('context_changed');
      const info = await refresh(true);
      if (!live() || info.result !== 'available' || !record) return refused('not_ready');
      const install = info.state === 'downloaded';
      if (intent ? intent.versionCode !== info.versionCode || intent.action !== (install ? 'install' : 'offer') : install) {
        deps.gateway.discard(); return refused('target_changed');
      }
      if (!install && !['unknown', 'interrupted', 'failed'].includes(info.state)) return refused('download_pending');
      const until = install ? record.installUntil : record.offerUntil;
      if (deps.now() < until) return refused('cooldown');
      const next = { ...record, pending: true, attemptNo: record.attemptNo + 1, targetVersion: info.versionCode,
        ...(install ? { installUntil: deps.now() + OFFER_COOLDOWN_MS } : { offerUntil: deps.now() + OFFER_COOLDOWN_MS }) };
      if (!markResultAttempt(resultAttemptId) || !persist(next) || !live()) return refused('storage_unconfirmed');
      const operation_id = `up_${deps.now().toString(36)}_${next.attemptNo.toString(36)}`;
      attempted = true;
      requestOperation.nativeOpen = true;
      const launchRevision = observationRevision;
      let result: FlowResult;
      try { result = await (install ? deps.gateway.completeFlexible(info.versionCode) : deps.gateway.startFlexible(info.infoToken)); }
      catch { result = { result: 'retryable_error', reason: 'gateway_error' }; }
      requestOperation.nativeOpen = false;
      refreshAfterTerminal = result.result === 'flow_ended_unconfirmed';
      if (generation === requestGeneration && running && deps.scope() === requestScope) {
        const newerObservation = observationRevision > launchRevision;
        const pending = result.result === 'flow_ended_unconfirmed' ? true
          : result.result === 'download_accepted' ? newerObservation ? observationNeedsRecovery(current, true) : true
          : observationNeedsRecovery(current, result.result !== 'cancelled');
        persist({ ...record, pending });
        emit('update_flow_result', { operation_id, attempt_no: next.attemptNo, stage: install ? 'install' : 'offer', result: result.result,
          reason: result.reason, target_version_code: info.versionCode, ...(result.errorCode === undefined ? {} : { error_code: result.errorCode }) });
        if (result.result === 'download_accepted' && !newerObservation) {
          current = { ...info, state: 'downloading' }; publish('downloading', info.versionCode);
        }
        deps.gateway.discard(); lastQueryAt = null;
      }
      return { ...result, attempted };
    } finally {
      const ownsOperation = operation === requestOperation;
      if (ownsOperation) operation = null;
      releaseFullscreen(lease);
      if (running && ownsOperation) {
        publish();
        if (enabled() && deps.foreground() && (refreshAfterTerminal || generation !== requestGeneration && record?.pending)) void refresh(true);
      }
    }
  }
  return { start, stop, refresh, request, markResultAttempt, hasResultAttempt, getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
