import { Platform } from 'react-native';
import { create } from 'zustand';

import app from '../../../app.json';
import { ECONOMY } from '@/core/config/economy';
import { MONETIZATION } from '@/core/config/monetization';
import { RETENTION } from '@/core/config/retention';
import * as native from '@/core/native/appmetrica';
import { getJSON, getString, KEYS, removeKey, setJSON } from '@/core/storage';
import { analyticsKeyToken, clearAnalyticsOnce, readAnalyticsOnce, removeAnalyticsOnce, writeAnalyticsOnce } from './dedupe';
import { ANALYTICS_SCHEMA_VERSION, type AnalyticsValue, EVENT_CONTRACTS, safeAnalyticsId, safeEventName, validateEventProperties } from './schema';
import { getSdkIdentitySnapshot, invalidateSdkIdentity, primeSdkIdentity, setSdkIdentityGate, validSdkPlayerId } from './sdkIdentity';

/** Storage remains v2; payload schema and storage format are deliberately independent. */
const STATE_KEY = 'analytics.outbox.v2';
const SESSION_KEY = 'analytics.session.v1';
const CONSENT_EPOCH_KEY = 'analytics.consent-epoch.v1';
const MAX_OUTBOX = 512;
const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HANDOFF_ATTEMPTS = 8;
const MAX_HANDOFFS_PER_FLUSH = 32;
const MAX_RETRY_DELAY_MS = 60_000;
const CLOCK_SKEW_MS = 60_000;
const MAX_RECENT_ONCE = 4096;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const QA_DEVICE_KEY = 'analytics.subscription-test-device.v1';
const REMINDERS = new Set(['reminder_scheduled', 'reminder_delivered', 'reminder_opened', 'reminder_gameplay', 'reminder_consent']);
const TRANSIENT_ONCE = new Set(['game_session_start', 'puzzle_resumed', 'screen_viewed', 'app_ready',
  'gameplay_session_summary', 'puzzle_checkpoint', 'technical_operation', 'analytics_health_summary', 'wheel_opened']);
const CRITICAL_EVENTS = new Set(['first_open', 'puzzle_started', 'puzzle_completed', 'first_level_completed',
  'fifth_level_completed', 'independent_level_completed', 'intro_completed', 'campaign_completed',
  'wallet_transaction', 'wallet_balance_observed', 'reward_granted', 'daily_completed', 'daily_repeat_completed',
  'quest_completed', 'quest_set_completed', 'weekly_milestone_granted', 'event_milestone_granted',
  'collectible_unlocked', 'album_completed', 'marathon_reward_granted', 'experiment_assigned',
  'subscription_payment_confirmed', 'subscription_payment_failed', 'subscription_payment_canceled']);

type AnalyticsContext = {
  configVersion: string; contentVersion: string; onboardingVersion: string;
  variantId: string; experimentVariants: Record<string, string>;
};
export type AnalyticsHealth = {
  queue_dropped: number; schema_rejected: number; handoff_failures: number; durable_write_failures: number;
  queue_expired: number; handoff_exhausted: number;
  /** Field counts, including invalid required values in both diagnostic categories. */
  missing_required: number; dropped_properties: number;
  /** Locally suppressed once-calls/duplicate queue records; not duplicates delivered by the SDK. */
  dedupe_hits: number;
};
type Envelope = Record<string, AnalyticsValue | null> & {
  event_id: string; schema_version: number; occurred_at: string; sdk_handoff_at: string | null;
  player_id: string; session_id: string; analytics_session_id: string;
};
type DeliveryState = { queuedAtMs: number; handoffAttempts: number; lastAttemptAtMs: number | null; nextAttemptAtMs: number };
type PendingEvent = DeliveryState & { name: string; envelope: Envelope; dedupeKey?: string };
type DedupeEntry = { key: string; eventId: string };
type State = {
  version: 2; playerId: string; sessionId: string; lastActivityAt: number; outbox: PendingEvent[];
  dedupe: DedupeEntry[]; context: AnalyticsContext; health: AnalyticsHealth;
};
type SessionState = { version: 1; sessionId: string; lastActivityAt: number; sessionCount: number };

const emptyHealth = (): AnalyticsHealth => ({ queue_dropped: 0, schema_rejected: 0, handoff_failures: 0,
  durable_write_failures: 0, queue_expired: 0, handoff_exhausted: 0,
  missing_required: 0, dropped_properties: 0, dedupe_hits: 0 });
// These transport dimensions are validated/restored separately from business properties.
const ENVELOPE_METADATA = new Set(`event_id schema_version sdk_handoff_at time_trust player_id session_id
  analytics_session_id app_version app_build platform environment release_channel consent_state producer consent_epoch_at
  config_version content_version onboarding_version variant_id device_key install_key identity_binding_state migrated_from_schema`.split(/\s+/));
const defaultContext: AnalyticsContext = {
  configVersion: 'config-' + analyticsKeyToken(JSON.stringify({ ECONOMY, MONETIZATION, RETENTION })),
  contentVersion: 'unknown', onboardingVersion: 'unknown', variantId: 'unassigned', experimentVariants: {},
};
let state: State | null = null;
let healthWindow = '';
let policyApplied = false;
let flushing = false;
const health = emptyHealth();

function newId(prefix: string): string {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}
function safeVersion(value: unknown, fallback: string): string {
  return typeof value === 'string' && safeAnalyticsId(value) ? value : fallback;
}
function recordValidationQuality(event: string, checked: ReturnType<typeof validateEventProperties>): void {
  health.missing_required = Math.min(Number.MAX_SAFE_INTEGER, health.missing_required + checked.missing.length);
  // An unknown event returns a rejection sentinel, not a count of discarded input fields.
  if (Object.hasOwn(EVENT_CONTRACTS, event)) health.dropped_properties = Math.min(Number.MAX_SAFE_INTEGER,
    health.dropped_properties + checked.rejected);
}
function deliveryState(entry: Partial<DeliveryState>, envelope: Record<string, unknown>, now: number): DeliveryState {
  const timestamp = (value: unknown): value is number => typeof value === 'number'
    && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
  const fields = [entry.queuedAtMs, entry.handoffAttempts, entry.lastAttemptAtMs, entry.nextAttemptAtMs];
  if (fields.every((value) => value === undefined)) {
    const observed = typeof envelope.observed_at === 'string' ? Date.parse(envelope.observed_at) : NaN;
    return { queuedAtMs: timestamp(observed) ? observed : now, handoffAttempts: 0, lastAttemptAtMs: null, nextAttemptAtMs: 0 };
  }
  if (timestamp(entry.queuedAtMs) && Number.isSafeInteger(entry.handoffAttempts)
      && entry.handoffAttempts! >= 0 && entry.handoffAttempts! <= MAX_HANDOFF_ATTEMPTS
      && timestamp(entry.nextAttemptAtMs) && (entry.handoffAttempts === 0
        ? entry.lastAttemptAtMs === null && entry.nextAttemptAtMs === 0
        : timestamp(entry.lastAttemptAtMs) && entry.nextAttemptAtMs >= entry.lastAttemptAtMs
          && entry.nextAttemptAtMs - entry.lastAttemptAtMs <= MAX_RETRY_DELAY_MS)) {
    return { queuedAtMs: entry.queuedAtMs, handoffAttempts: entry.handoffAttempts!,
      lastAttemptAtMs: entry.lastAttemptAtMs ?? null, nextAttemptAtMs: entry.nextAttemptAtMs };
  }
  // Corrupt retry metadata cannot reset a bounded retry budget on every restart.
  return { queuedAtMs: now, handoffAttempts: MAX_HANDOFF_ATTEMPTS, lastAttemptAtMs: null, nextAttemptAtMs: 0 };
}
function readPreferences(): { optOut: boolean } {
  const previous = getJSON<unknown>(KEYS.analytics, {});
  const optOut = !!previous && typeof previous === 'object' && (previous as { optOut?: unknown }).optOut === true;
  if (previous && typeof previous === 'object' && Object.keys(previous).some((key) => key !== 'optOut')) setJSON(KEYS.analytics, { optOut });
  return { optOut };
}
const initialPreferences = readPreferences();
try {
  // A persisted native denial survives a failed/cleared JS preference write. Only an explicit opt-in can revoke it.
  if (typeof native.getDataSendingPreference === 'function' && native.getDataSendingPreference() === false) {
    initialPreferences.optOut = true;
    setJSON(KEYS.analytics, initialPreferences);
  }
} catch { initialPreferences.optOut = true; }

/** Null denotes the existing pre-epoch consent migration, not a fabricated first opt-in time. */
export function getAnalyticsConsentEpoch(): number | null {
  const value = getJSON<{ version?: number; startedAtMs?: number }>(CONSENT_EPOCH_KEY, {});
  return value.version === 1 && typeof value.startedAtMs === 'number' && Number.isFinite(value.startedAtMs)
    && value.startedAtMs >= 0 ? value.startedAtMs : null;
}
function allowedByConsentEpoch(properties: Record<string, unknown>): boolean {
  const epoch = getAnalyticsConsentEpoch();
  if (epoch === null) return true;
  if (properties.timeKnown === false) return false;
  const original = typeof properties.occurredAtMs === 'number' ? properties.occurredAtMs
    : typeof properties.occurred_at === 'string' ? Date.parse(properties.occurred_at) : null;
  if (properties.recovery === true && (original === null || !Number.isFinite(original))) return false;
  return original === null || Number.isFinite(original) && original >= epoch;
}

function syncNativePolicy(enabled: boolean): void {
  try {
    // Optional only for older unit-test mocks; production bridges enforce the policy independently.
    policyApplied = typeof native.setDataSendingEnabled === 'function' ? native.setDataSendingEnabled(enabled) : true;
  } catch { policyApplied = false; }
}
syncNativePolicy(!initialPreferences.optOut);
if (initialPreferences.optOut) { invalidateSdkIdentity(); removeKey(STATE_KEY); clearAnalyticsOnce(); }

/** One common gate for every custom event, not only the payment funnel. Unknown native devices fail closed. */
export function isAnalyticsCollectionEnabled(): boolean {
  try {
    return !useAnalyticsPrefs.getState().optOut && policyApplied && !__DEV__
      && process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE !== '1'
      && process.env.EXPO_PUBLIC_YANDEX_TEST_ADS !== '1'
      && getString(QA_DEVICE_KEY) !== '1'
      && typeof native.isAppMetricaTestDevice === 'function' && native.isAppMetricaTestDevice() === false;
  } catch { return false; }
}
export const useAnalyticsPrefs = create<{ optOut: boolean; setOptOut: (value: boolean) => void }>((set) => ({
  optOut: initialPreferences.optOut,
  setOptOut: (value) => {
    if (!value && useAnalyticsPrefs.getState().optOut) {
      const epoch = { version: 1, startedAtMs: Date.now() };
      setJSON(CONSENT_EPOCH_KEY, epoch);
      // Never enable collection without the durable boundary that excludes actions made during refusal.
      if (getString(CONSENT_EPOCH_KEY) !== JSON.stringify(epoch)) return;
    }
    // The native gate is applied synchronously, before another callback can enqueue/flush.
    syncNativePolicy(!value);
    set({ optOut: value });
    setJSON(KEYS.analytics, { optOut: value });
    if (value) {
      invalidateSdkIdentity(); state = null; healthWindow = '';
      removeKey(STATE_KEY); clearAnalyticsOnce();
      Object.assign(health, emptyHealth());
    }
  },
}));
setSdkIdentityGate(isAnalyticsCollectionEnabled);

function readSession(): SessionState {
  const saved = getJSON<Partial<SessionState>>(SESSION_KEY, {});
  if (saved.version === 1 && typeof saved.sessionId === 'string' && safeAnalyticsId(saved.sessionId)
      && typeof saved.lastActivityAt === 'number' && Number.isFinite(saved.lastActivityAt)
      && Number.isInteger(saved.sessionCount) && (saved.sessionCount ?? 0) >= 0) return saved as SessionState;
  const old = getJSON<Partial<State>>(STATE_KEY, {});
  return { version: 1, sessionId: safeVersion(old.sessionId, newId('s')),
    lastActivityAt: typeof old.lastActivityAt === 'number' && Number.isFinite(old.lastActivityAt) ? old.lastActivityAt : 0,
    sessionCount: old.lastActivityAt ? 1 : 0 };
}
function sessionAt(now: number, activity: boolean): SessionState {
  const current = readSession();
  if (!current.lastActivityAt) {
    current.sessionCount = Math.max(1, current.sessionCount);
    current.lastActivityAt = now;
  } else if (now < current.lastActivityAt || now - current.lastActivityAt >= SESSION_IDLE_MS) {
    current.sessionId = newId('s'); current.sessionCount += 1; current.lastActivityAt = now;
  } else if (activity) current.lastActivityAt = now;
  setJSON(SESSION_KEY, current);
  return current;
}
/** Reading the ad gate never extends an existing session. */
export function getAnalyticsSession(): { sessionId: string; isFirstSession: boolean } {
  const session = sessionAt(Date.now(), false);
  return { sessionId: session.sessionId, isFirstSession: session.sessionCount === 1 };
}
/** Foreground/user activity only. Background delivery and health/summary telemetry do not call this. */
export function noteAnalyticsActivity(): void {
  const session = sessionAt(Date.now(), true);
  if (state) { state.sessionId = session.sessionId; state.lastActivityAt = session.lastActivityAt; save(); }
}
function restoreContext(value: unknown): AnalyticsContext {
  const old = value && typeof value === 'object' ? value as Partial<AnalyticsContext> : {};
  const variants = old.experimentVariants && typeof old.experimentVariants === 'object' ? old.experimentVariants : {};
  return {
    configVersion: safeVersion(old.configVersion, defaultContext.configVersion),
    contentVersion: safeVersion(old.contentVersion, defaultContext.contentVersion),
    onboardingVersion: safeVersion(old.onboardingVersion, defaultContext.onboardingVersion),
    variantId: safeVersion(old.variantId, defaultContext.variantId),
    experimentVariants: Object.fromEntries(Object.entries(variants).filter(([key, val]) =>
      safeAnalyticsId(key) && typeof val === 'string' && safeAnalyticsId(val)).slice(0, 16)),
  };
}
function softwareBuild(previous?: Record<string, unknown>): { app_version: string; app_build: string } {
  // Restoring a queued fact must not relabel the software under which it occurred.
  if (previous !== undefined) return { app_version: safeVersion(previous.app_version, 'unknown'),
    app_build: safeVersion(previous.app_build, 'unknown') };
  if (Platform.OS === 'web') return { app_version: safeVersion(app.expo.version, 'unknown'),
    app_build: safeVersion(String(app.expo.android.versionCode), 'unknown') };
  let installed: native.SoftwareBuildInfo | null = null;
  try {
    if (Platform.OS === 'android' && typeof native.getSoftwareBuildInfo === 'function') installed = native.getSoftwareBuildInfo();
  } catch { /* Old or unavailable native metadata must remain explicitly unknown. */ }
  return { app_version: safeVersion(installed?.versionName, 'unknown'),
    app_build: safeVersion(installed?.versionCode, 'unknown') };
}
function baseEnvelope(id: string, current: State, properties: Record<string, AnalyticsValue>, previous?: Record<string, unknown>): Envelope {
  const identity = getSdkIdentitySnapshot();
  const identifiers: { deviceId?: string; installationId?: string } = identity.status === 'ready' ? identity : {};
  const now = Date.now();
  const happened = typeof properties.occurredAtMs === 'number' ? properties.occurredAtMs
    : typeof properties.occurred_at === 'string' ? Date.parse(properties.occurred_at) : now;
  const oldTime = typeof previous?.occurred_at === 'string' && Number.isFinite(Date.parse(previous.occurred_at)) ? previous.occurred_at : null;
  const experimentFields = Object.fromEntries(Object.entries(current.context.experimentVariants).map(([key, val]) => [
    'experiment_variant_' + key.replace(/[^a-z0-9_]/gi, '_').slice(0, 32)
      + (/[^a-z0-9_]/i.test(key) ? '_' + analyticsKeyToken(key).slice(0, 8) : ''), val,
  ]));
  return {
    ...properties, ...experimentFields,
    event_id: id, schema_version: ANALYTICS_SCHEMA_VERSION,
    occurred_at: oldTime ?? new Date(Number.isFinite(happened) ? happened : now).toISOString(),
    observed_at: typeof properties.observedAtMs === 'number' ? new Date(properties.observedAtMs).toISOString()
      : typeof properties.observed_at === 'string' ? properties.observed_at : new Date(now).toISOString(),
    sdk_handoff_at: null, time_trust: properties.timeKnown === false ? 'occurrence_unknown'
      : previous?.time_trust === 'client_clock_anomaly' || (oldTime ? Date.parse(oldTime) : happened) > now + 60_000
        ? 'client_clock_anomaly' : 'client_unverified',
    player_id: current.playerId, session_id: safeVersion(previous?.session_id, current.sessionId),
    analytics_session_id: safeVersion(previous?.analytics_session_id ?? previous?.session_id ?? properties.analytics_session_id, current.sessionId),
    ...softwareBuild(previous),
    platform: Platform.OS, environment: 'production',
    release_channel: safeVersion(process.env.EXPO_PUBLIC_RELEASE_CHANNEL, 'production'),
    consent_state: 'enabled', producer: 'javascript',
    consent_epoch_at: getAnalyticsConsentEpoch() === null ? null : new Date(getAnalyticsConsentEpoch()!).toISOString(),
    config_version: safeVersion(previous?.config_version, current.context.configVersion),
    content_version: safeVersion(previous?.content_version ?? properties.contentVersion ?? properties.content_version, current.context.contentVersion),
    onboarding_version: safeVersion(previous?.onboarding_version ?? properties.onboardingVersion, current.context.onboardingVersion),
    variant_id: safeVersion(previous?.variant_id, current.context.variantId),
    ...(identifiers.deviceId ? { device_key: identifiers.deviceId } : {}),
    ...(identifiers.installationId ? { install_key: identifiers.installationId } : {}),
    identity_binding_state: identifiers.deviceId && identifiers.installationId ? 'linked' : 'unlinked',
    ...(previous?.schema_version === 2 || previous?.migrated_from_schema === 2 ? { migrated_from_schema: 2 } : {}),
  };
}
function getState(): State {
  if (state) return state;
  const old = getJSON<Partial<State>>(STATE_KEY, {});
  const session = readSession();
  const valid = old.version === 2 && typeof old.playerId === 'string' && safeAnalyticsId(old.playerId);
  state = {
    version: 2, playerId: valid ? old.playerId! : newId('p'), sessionId: valid ? safeVersion(old.sessionId, session.sessionId) : session.sessionId,
    lastActivityAt: session.lastActivityAt, outbox: [], dedupe: [],
    context: restoreContext({ ...(valid ? old.context : {}), configVersion: defaultContext.configVersion }),
    health: emptyHealth(),
  };
  if (valid && old.health) for (const key of Object.keys(health) as (keyof AnalyticsHealth)[]) {
    const value = old.health[key]; if (Number.isSafeInteger(value) && value >= 0) health[key] = value;
  }
  if (valid && Array.isArray(old.dedupe)) {
    for (const entry of old.dedupe) {
      if (typeof entry?.key !== 'string' || typeof entry?.eventId !== 'string' || !safeAnalyticsId(entry.eventId)) continue;
      const name = entry.key.split(':')[0];
      if (TRANSIENT_ONCE.has(name)) state.dedupe.push(entry);
      else if (!writeAnalyticsOnce(entry.key, entry.eventId)) {
        state.dedupe.push(entry); health.durable_write_failures += 1;
      }
    }
    state.dedupe = state.dedupe.slice(-MAX_RECENT_ONCE);
  }
  const restoredIds = new Set<string>();
  const restoredOnce = new Set<string>();
  let migratedDelivery = false;
  if (valid && Array.isArray(old.outbox)) for (const entry of old.outbox.slice(-MAX_OUTBOX)) {
    const envelope = entry?.envelope as Record<string, unknown> | undefined;
    if (!envelope || typeof entry.name !== 'string' || !safeEventName(entry.name)
        || typeof envelope.event_id !== 'string' || !safeAnalyticsId(envelope.event_id)
        || ![2, 3].includes(envelope.schema_version as number)
        || typeof envelope.occurred_at !== 'string' || !Number.isFinite(Date.parse(envelope.occurred_at))) continue;
    const input = envelope.schema_version === 2 && envelope.properties && typeof envelope.properties === 'object'
      ? envelope.properties as Record<string, unknown> : envelope;
    if (!allowedByConsentEpoch({ ...input, occurred_at: envelope.occurred_at })) continue;
    const checked = validateEventProperties(entry.name, input);
    const diagnostics = envelope.schema_version === 3 ? validateEventProperties(entry.name, Object.fromEntries(
      Object.entries(input).filter(([key]) => !ENVELOPE_METADATA.has(key) && !/^experiment_variant_[a-z0-9_]{1,48}$/i.test(key)),
    )) : checked;
    recordValidationQuality(entry.name, { ...diagnostics, missing: checked.missing });
    // Persist the sanitized queue and diagnostics together; offline restarts must not recount discarded input.
    if (diagnostics.rejected || checked.missing.length) migratedDelivery = true;
    if (!checked.valid) { health.schema_rejected += 1; continue; }
    if (restoredIds.has(envelope.event_id) || typeof entry.dedupeKey === 'string' && restoredOnce.has(entry.dedupeKey)) {
      health.queue_dropped += 1;
      health.dedupe_hits = Math.min(Number.MAX_SAFE_INTEGER, health.dedupe_hits + 1);
      migratedDelivery = true;
      continue;
    }
    restoredIds.add(envelope.event_id);
    if (typeof entry.dedupeKey === 'string') restoredOnce.add(entry.dedupeKey);
    if (entry.queuedAtMs === undefined) migratedDelivery = true;
    const restored = baseEnvelope(envelope.event_id, state, checked.properties, envelope);
    const savedVariants = envelope.experiment_variants;
    if (savedVariants && typeof savedVariants === 'object' && !Array.isArray(savedVariants)) {
      for (const [key, value] of Object.entries(savedVariants)) if (safeAnalyticsId(key) && typeof value === 'string' && safeAnalyticsId(value)) {
        const dimension = 'experiment_variant_' + key.replace(/[^a-z0-9_]/gi, '_').slice(0, 32)
          + (/[^a-z0-9_]/i.test(key) ? '_' + analyticsKeyToken(key).slice(0, 8) : '');
        restored[dimension] = value;
      }
    }
    if (envelope.schema_version === 3) {
      for (const dimension of Object.keys(restored)) if (dimension.startsWith('experiment_variant_')) delete restored[dimension];
      for (const [dimension, value] of Object.entries(envelope)) {
        if (/^experiment_variant_[a-z0-9_]{1,48}$/i.test(dimension)
            && typeof value === 'string' && safeAnalyticsId(value)) restored[dimension] = value;
      }
    }
    // Already-v3 metadata is restored explicitly, never spread from persisted input.
    for (const key of ['device_key', 'install_key']) if (typeof envelope[key] === 'string' && safeAnalyticsId(envelope[key])) restored[key] = envelope[key];
    restored.identity_binding_state = restored.device_key && restored.install_key ? 'linked' : 'unlinked';
    state.outbox.push({ ...deliveryState(entry, envelope, Date.now()), name: entry.name, envelope: restored,
      ...(typeof entry.dedupeKey === 'string' ? { dedupeKey: entry.dedupeKey } : {}) });
  }
  state.health = { ...health };
  // Freeze the first legacy migration time even if the native SDK remains unavailable.
  if (migratedDelivery) save();
  return state;
}
/** Readback protects callers from MMKV's intentionally non-throwing unavailable-storage helpers. */
function save(): boolean {
  if (!state) return false;
  state.health = { ...health };
  const encoded = JSON.stringify(state);
  setJSON(STATE_KEY, state);
  const success = getString(STATE_KEY) === encoded;
  if (!success) health.durable_write_failures += 1;
  return success;
}
function requestIdentifiers(): void {
  void primeSdkIdentity();
}
export function setAnalyticsContext(next: Partial<AnalyticsContext>): void {
  if (useAnalyticsPrefs.getState().optOut) return;
  const current = getState();
  current.context = restoreContext({ ...current.context, ...next });
  save();
}
function lookupOnce(current: State, name: string, key: string): string | null {
  return current.outbox.find((entry) => entry.dedupeKey === key)?.envelope.event_id
    ?? current.dedupe.find((entry) => entry.key === key)?.eventId
    ?? (TRANSIENT_ONCE.has(name) ? null : readAnalyticsOnce(key))
    ?? null;
}
function rememberOnce(current: State, name: string, key: string, eventId: string): boolean {
  if (!TRANSIENT_ONCE.has(name)) return writeAnalyticsOnce(key, eventId);
  if (!current.dedupe.some((entry) => entry.key === key)) current.dedupe.push({ key, eventId });
  current.dedupe = current.dedupe.slice(-MAX_RECENT_ONCE);
  return save();
}
function retirePending(current: State, index: number, reason: 'expired' | 'exhausted' | 'clock'): boolean {
  const pending = current.outbox[index];
  // A domain journal may already have retired its copy after trackOnce returned this ID.
  // Keep its once tombstone even when this transport's retention/retry budget ends.
  if (pending.dedupeKey && !rememberOnce(current, pending.name, pending.dedupeKey, pending.envelope.event_id)) return false;
  current.outbox.splice(index, 1);
  health.queue_dropped += 1;
  if (reason === 'expired') health.queue_expired += 1;
  if (reason === 'exhausted') health.handoff_exhausted += 1;
  return true;
}
function terminalReason(pending: PendingEvent, now: number): 'expired' | 'exhausted' | 'clock' | null {
  if (pending.handoffAttempts >= MAX_HANDOFF_ATTEMPTS) return 'exhausted';
  if (pending.queuedAtMs > now + CLOCK_SKEW_MS
      || pending.lastAttemptAtMs !== null && pending.lastAttemptAtMs > now + CLOCK_SKEW_MS) return 'clock';
  return now - pending.queuedAtMs >= OUTBOX_TTL_MS ? 'expired' : null;
}
function pruneOutbox(current: State, now: number): void {
  let changed = false;
  for (let index = 0; index < current.outbox.length;) {
    const pending = current.outbox[index];
    const reason = terminalReason(pending, now);
    if (reason && retirePending(current, index, reason)) changed = true;
    else index += 1;
  }
  if (changed) save();
}
/** Local SDK acceptance only: no server acknowledgement is implied. */
export function flushAnalytics(): void {
  if (!isAnalyticsCollectionEnabled() || flushing) return;
  flushing = true;
  try {
    const current = getState();
    pruneOutbox(current, Date.now());
    if (!native.isAppMetricaAvailable()) return;
    requestIdentifiers();
    let calls = 0;
    for (let index = 0; index < current.outbox.length && calls < MAX_HANDOFFS_PER_FLUSH;) {
      const pending = current.outbox[index];
      const now = Date.now();
      if (pending.nextAttemptAtMs > now || terminalReason(pending, now)) { index += 1; continue; }
      if (pending.dedupeKey && !rememberOnce(current, pending.name, pending.dedupeKey, pending.envelope.event_id)) return;
      const previous = { handoffAttempts: pending.handoffAttempts, lastAttemptAtMs: pending.lastAttemptAtMs, nextAttemptAtMs: pending.nextAttemptAtMs };
      pending.handoffAttempts += 1;
      pending.lastAttemptAtMs = now;
      pending.nextAttemptAtMs = now + Math.min(1000 * 2 ** (pending.handoffAttempts - 1), MAX_RETRY_DELAY_MS);
      // Reserve the bounded attempt durably before a native side effect can occur.
      if (!save()) { Object.assign(pending, previous); return; }
      const payload = { ...pending.envelope, sdk_handoff_at: new Date(now).toISOString() };
      let accepted = false;
      calls += 1;
      try { accepted = native.reportEvent(pending.name, payload); } catch { /* retry the same ID after backoff */ }
      if (accepted) current.outbox.splice(index, 1);
      else {
        health.handoff_failures += 1;
        if (pending.handoffAttempts < MAX_HANDOFF_ATTEMPTS || !retirePending(current, index, 'exhausted')) index += 1;
      }
      if (!save()) return;
    }
  } finally {
    flushing = false;
  }
}
function priority(event: PendingEvent): number {
  // Truthy acknowledgement lets domain/native journals retire their copy. No later event may evict that fact.
  if (REMINDERS.has(event.name) || CRITICAL_EVENTS.has(event.name)
      || event.dedupeKey && !TRANSIENT_ONCE.has(event.name)) return 3;
  if (event.name === 'analytics_health_summary' || event.name === 'technical_operation') return 0;
  return event.dedupeKey ? 2 : 1;
}
function enqueue(event: string, props?: Record<string, unknown>, key?: string): string | null {
  if (!isAnalyticsCollectionEnabled() || !safeEventName(event) || event === 'subscription_server_event'
      || props?.is_test === true || props?.mode === 'test') return null;
  if (!allowedByConsentEpoch(props ?? {})) return null;
  const input = event === 'ui_action' && props?.interaction_id === undefined
    ? { ...props, interaction_id: newId('interaction') } : props;
  const current = getState();
  const checked = validateEventProperties(event, input);
  recordValidationQuality(event, checked);
  health.schema_rejected += checked.rejected + checked.missing.length;
  if (!checked.valid) { save(); return null; }
  pruneOutbox(current, Date.now());
  if (key) {
    const existing = lookupOnce(current, event, key);
    if (existing) {
      health.dedupe_hits = Math.min(Number.MAX_SAFE_INTEGER, health.dedupe_hits + 1);
      save(); flushAnalytics(); return existing;
    }
  }
  requestIdentifiers();
  const id = newId('e');
  const pending: PendingEvent = { name: event, envelope: baseEnvelope(id, current, checked.properties),
    queuedAtMs: Date.now(), handoffAttempts: 0, lastAttemptAtMs: null, nextAttemptAtMs: 0, ...(key ? { dedupeKey: key } : {}) };
  if (current.outbox.length >= MAX_OUTBOX) flushAnalytics();
  if (current.outbox.length >= MAX_OUTBOX) {
    const index = current.outbox.findIndex((entry) => priority(entry) < priority(pending));
    health.queue_dropped += 1;
    if (index < 0) { save(); return null; }
    const [dropped] = current.outbox.splice(index, 1);
    if (dropped.dedupeKey) {
      removeAnalyticsOnce(dropped.dedupeKey);
      current.dedupe = current.dedupe.filter((entry) => entry.key !== dropped.dedupeKey);
    }
  }
  current.outbox.push(pending);
  if (!save()) {
    current.outbox = current.outbox.filter((entry) => entry.envelope.event_id !== id);
    return null;
  }
  if (key && !rememberOnce(current, event, key, id)) { health.durable_write_failures += 1; return null; }
  flushAnalytics();
  return id;
}
/** Existing fire-and-forget API; failed telemetry cannot change a game transaction. */
export function track(event: string, props?: Record<string, unknown>): void { enqueue(event, props); }
/** Opaque local domain keys can be long; sharded lookup compares full keys, so hashing cannot merge different facts. */
export function trackOnce(event: string, dedupeKey: string, props?: Record<string, unknown>): string | null {
  if (typeof dedupeKey !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,4095}$/i.test(dedupeKey)) return null;
  return enqueue(event, props, event + ':' + dedupeKey);
}

type HelpCapturedEvent = 'hint_requested' | 'hint_rejected' | 'experiment_assigned';
export type CapturedHelpFact = { version: 1; name: HelpCapturedEvent; dedupeKey: string; queuedAtMs: number; envelope: Envelope };
const HELP_CAPTURED_EVENTS = new Set(['hint_requested', 'hint_rejected', 'experiment_assigned']);
/** Restricted first-request journal port: captures immutable metadata without enqueue, handoff or exposure. */
export function captureHelpEnrollmentFact(name: HelpCapturedEvent, key: string, properties: Record<string, unknown>): CapturedHelpFact | null {
  if (!isAnalyticsCollectionEnabled() || getSdkIdentitySnapshot().status !== 'ready' || !HELP_CAPTURED_EVENTS.has(name)
    || !/^[a-z0-9][a-z0-9_.:-]{0,511}$/i.test(key) || !allowedByConsentEpoch(properties)) return null;
  const checked = validateEventProperties(name, properties);
  if (!checked.valid || checked.rejected || properties.first_eligible_request !== true && name !== 'experiment_assigned'
    || name === 'experiment_assigned' && (properties.experiment_id !== 'slova_wheel_help_clarity_20261104' || properties.unit_type !== 'sdk_player')
    || !Number.isSafeInteger(properties.occurredAtMs) || Number(properties.occurredAtMs) <= 0) return null;
  return { version: 1, name, dedupeKey: `${name}:${key}`, queuedAtMs: Date.now(),
    envelope: baseEnvelope(newId('e'), getState(), checked.properties) };
}
export function isCapturedHelpFact(value: unknown): value is CapturedHelpFact {
  if (!value || typeof value !== 'object') return false;
  const fact = value as CapturedHelpFact, e = fact.envelope;
  if (Object.keys(fact).some((key) => !['version', 'name', 'dedupeKey', 'queuedAtMs', 'envelope'].includes(key))
    || fact.version !== 1 || !HELP_CAPTURED_EVENTS.has(fact.name) || !e || typeof e !== 'object'
    || typeof fact.dedupeKey !== 'string' || !fact.dedupeKey.startsWith(`${fact.name}:`) || fact.dedupeKey.length > 600
    || !Number.isSafeInteger(fact.queuedAtMs) || fact.queuedAtMs <= 0 || e.schema_version !== 3
    || !safeAnalyticsId(e.event_id) || e.environment !== 'production' || e.consent_state !== 'enabled'
    || e.producer !== 'javascript' || e.time_trust !== 'client_unverified' || e.sdk_handoff_at !== null
    || !validSdkPlayerId(e.device_key)
    || typeof e.install_key !== 'string' || !/^[a-zA-Z0-9_.:-]{1,96}$/.test(e.install_key)
    || e.identity_binding_state !== 'linked'
    || ['app_version', 'app_build', 'config_version', 'content_version', 'onboarding_version', 'variant_id', 'player_id', 'session_id', 'analytics_session_id'].some((key) => typeof e[key] !== 'string' || !safeAnalyticsId(e[key] as string))
    || typeof e.occurred_at !== 'string' || !Number.isFinite(Date.parse(e.occurred_at))
    || typeof e.observed_at !== 'string' || !Number.isFinite(Date.parse(e.observed_at))) return false;
  const business = Object.fromEntries(Object.entries(e).filter(([key]) => !ENVELOPE_METADATA.has(key)
    && !/^experiment_variant_[a-z0-9_]{1,48}$/i.test(key)));
  const checked = validateEventProperties(fact.name, business);
  return checked.valid && checked.rejected === 0 && e.occurredAtMs === Date.parse(e.occurred_at)
    && Object.entries(e).every(([key, value]) => !key.startsWith('experiment_variant_') || typeof value === 'string' && safeAnalyticsId(value))
    && e.eligibility_version === 'help_deficit_v1' && (e.measurement_phase === 'baseline' || e.measurement_phase === 'trial')
    && (e.measurement_phase !== 'trial' || typeof e.trial_plan_fingerprint === 'string' && /^[a-f0-9]{32}$/.test(e.trial_plan_fingerprint))
    && typeof e.eligibility_epoch === 'string' && safeAnalyticsId(e.eligibility_epoch)
    && (fact.name === 'experiment_assigned' ? e.experiment_id === 'slova_wheel_help_clarity_20261104' && e.unit_type === 'sdk_player'
      && e.measurement_phase === 'trial' : e.first_eligible_request === true)
    && (fact.name !== 'hint_rejected' || e.reason === 'insufficient_coins');
}
/** Replays the original envelope. A retry cannot mint a new time, version, identity or delivery budget. */
export function enqueueCapturedHelpFact(fact: CapturedHelpFact): 'accepted' | 'blocked' | 'invalid' | 'expired' {
  if (!isCapturedHelpFact(fact)) return 'invalid';
  const identity = getSdkIdentitySnapshot(), e = fact.envelope;
  if (!isAnalyticsCollectionEnabled() || identity.status !== 'ready' || identity.deviceId !== e.device_key || identity.installationId !== e.install_key
    || !allowedByConsentEpoch(e) || e.consent_epoch_at !== (getAnalyticsConsentEpoch() === null ? null : new Date(getAnalyticsConsentEpoch()!).toISOString())) return 'blocked';
  const now = Date.now();
  if (fact.queuedAtMs > now + CLOCK_SKEW_MS || now - fact.queuedAtMs >= OUTBOX_TTL_MS) return 'expired';
  const current = getState();
  if (lookupOnce(current, fact.name, fact.dedupeKey)) { flushAnalytics(); return 'accepted'; }
  pruneOutbox(current, now);
  if (current.outbox.length >= MAX_OUTBOX) return 'blocked';
  const entry: PendingEvent = { name: fact.name, envelope: JSON.parse(JSON.stringify(e)) as Envelope,
    dedupeKey: fact.dedupeKey, queuedAtMs: fact.queuedAtMs, handoffAttempts: 0, lastAttemptAtMs: null, nextAttemptAtMs: 0 };
  current.outbox.push(entry);
  if (!save()) { current.outbox = current.outbox.filter((v) => v !== entry); return 'blocked'; }
  if (!rememberOnce(current, fact.name, fact.dedupeKey, e.event_id)) return 'blocked';
  flushAnalytics(); return 'accepted';
}
export function trackFirstOpen(): void { trackOnce('first_open', 'local_profile'); }
export function trackGameSessionStart(source = 'direct'): void {
  noteAnalyticsActivity();
  if (useAnalyticsPrefs.getState().optOut) return;
  const current = getState();
  const session = readSession();
  current.sessionId = session.sessionId; current.lastActivityAt = session.lastActivityAt; save();
  trackOnce('game_session_start', current.sessionId, { source });
}
/** Manual submit and successful voluntary help qualify D_n_play. Letter frames are not individually recorded. */
export function trackGameplayAction(action: 'letters_connected' | 'word_submitted' | 'hint_used', props?: Record<string, unknown>): void {
  noteAnalyticsActivity();
  if (action !== 'letters_connected') track('gameplay_action', { ...props, action });
}
export function getAnalyticsHealth(): AnalyticsHealth & { queue_size: number; oldest_pending_ms: number } {
  const current = useAnalyticsPrefs.getState().optOut ? null : getState();
  if (current) pruneOutbox(current, Date.now());
  const first = current?.outbox[0]?.queuedAtMs;
  return { ...health, queue_size: current?.outbox.length ?? 0,
    oldest_pending_ms: first === undefined ? 0 : Math.max(0, Date.now() - first) };
}
export function trackAnalyticsHealthSummary(): void {
  if (!isAnalyticsCollectionEnabled()) return;
  const session = readSession();
  if (healthWindow === session.sessionId) return;
  const id = trackOnce('analytics_health_summary', session.sessionId, { window_id: session.sessionId, ...getAnalyticsHealth() });
  if (id) healthWindow = session.sessionId;
}
