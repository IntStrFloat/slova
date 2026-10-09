import { create } from 'zustand';

import app from '../../../app.json';
import { isAppMetricaAvailable, reportEvent } from '@/core/native/appmetrica';
import { getJSON, KEYS, removeKey, setJSON } from '@/core/storage';
import { safeAnalyticsId, safeEventName, sanitizeProperties } from './privacy';

/** Local acceptance by AppMetrica is observable; server acknowledgement is not exposed by its adapter. */
const STATE_KEY = 'analytics.outbox.v2';
const SESSION_KEY = 'analytics.session.v1';
const SCHEMA_VERSION = 2;
const MAX_OUTBOX = 128;
const MAX_DEDUPE = 512;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const REMINDER_EVENTS = new Set([
  'reminder_scheduled', 'reminder_delivered', 'reminder_opened', 'reminder_gameplay', 'reminder_consent',
]);
const ESSENTIAL_EVENTS = new Set([
  'first_open', 'puzzle_started', 'puzzle_completed', 'level_completed', 'reward_granted',
  'first_level_completed', 'fifth_level_completed', 'daily_repeat_completed',
  'weekly_milestone_granted', 'quest_completed', 'intro_milestone_completed',
]);

type AnalyticsContext = {
  configVersion: string;
  contentVersion: string;
  onboardingVersion: string;
  variantId: string;
  experimentVariants: Record<string, string>;
};

type EventEnvelope = {
  event_id: string;
  schema_version: number;
  player_id: string;
  session_id: string;
  occurred_at: string;
  received_at: string | null;
  time_trust: 'client_unverified';
  app_version: string;
  config_version: string;
  content_version: string;
  onboarding_version: string;
  variant_id: string;
  experiment_variants: Record<string, string>;
  properties: Record<string, string | number | boolean>;
};

type PendingEvent = { name: string; envelope: EventEnvelope };
type DedupeEntry = { key: string; eventId: string };

type State = {
  version: 2;
  playerId: string;
  sessionId: string;
  lastActivityAt: number;
  outbox: PendingEvent[];
  dedupe: DedupeEntry[];
  context: AnalyticsContext;
};

type SessionState = {
  version: 1;
  sessionId: string;
  lastActivityAt: number;
  sessionCount: number;
};

const defaultContext: AnalyticsContext = {
  configVersion: 'local-v1',
  contentVersion: 'unknown',
  onboardingVersion: '1',
  variantId: 'unassigned',
  experimentVariants: {},
};

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
}

function readSession(): SessionState {
  const stored = getJSON<Partial<SessionState> | null>(SESSION_KEY, null);
  if (stored?.version === 1 && typeof stored.sessionId === 'string' &&
      safeAnalyticsId(stored.sessionId) && typeof stored.lastActivityAt === 'number' &&
      Number.isFinite(stored.lastActivityAt) && Number.isInteger(stored.sessionCount) &&
      (stored.sessionCount ?? -1) >= 0) {
    return stored as SessionState;
  }
  // Migration from the first v2 outbox, which kept session metadata with the events.
  const previous = getJSON<Partial<State> | null>(STATE_KEY, null);
  const sessionId = typeof previous?.sessionId === 'string' && safeAnalyticsId(previous.sessionId)
    ? previous.sessionId : newId('s');
  const lastActivityAt = typeof previous?.lastActivityAt === 'number' &&
    Number.isFinite(previous.lastActivityAt) ? previous.lastActivityAt : 0;
  return { version: 1, sessionId, lastActivityAt, sessionCount: lastActivityAt ? 1 : 0 };
}

function touchPersistentSession(now: number): SessionState {
  const current = readSession();
  if (!current.lastActivityAt) {
    current.sessionCount = Math.max(1, current.sessionCount);
  } else if (now < current.lastActivityAt || now - current.lastActivityAt >= SESSION_IDLE_MS) {
    current.sessionId = newId('s');
    current.sessionCount = Math.max(1, current.sessionCount) + 1;
  }
  current.lastActivityAt = now;
  setJSON(SESSION_KEY, current);
  return current;
}

function freshState(): State {
  const session = readSession();
  return {
    version: 2,
    playerId: newId('p'),
    sessionId: session.sessionId,
    lastActivityAt: session.lastActivityAt,
    outbox: [],
    dedupe: [],
    context: { ...defaultContext },
  };
}

function validPending(value: unknown): value is PendingEvent {
  if (!value || typeof value !== 'object') return false;
  const entry = value as PendingEvent;
  return safeEventName(entry.name) && typeof entry.envelope?.event_id === 'string' &&
    safeAnalyticsId(entry.envelope.event_id) && entry.envelope.schema_version === SCHEMA_VERSION &&
    typeof entry.envelope.occurred_at === 'string' &&
    !Number.isNaN(Date.parse(entry.envelope.occurred_at));
}

function safeVersion(value: unknown, fallback: string): string {
  return typeof value === 'string' && safeAnalyticsId(value) ? value : fallback;
}

function safeVariants(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, variant]) => safeAnalyticsId(key) &&
        typeof variant === 'string' && safeAnalyticsId(variant))
      .slice(0, 16),
  );
}

function restoreContext(value: unknown): AnalyticsContext {
  if (!value || typeof value !== 'object') return { ...defaultContext };
  const previous = value as Partial<AnalyticsContext>;
  return {
    configVersion: safeVersion(previous.configVersion, defaultContext.configVersion),
    contentVersion: safeVersion(previous.contentVersion, defaultContext.contentVersion),
    onboardingVersion: safeVersion(previous.onboardingVersion, defaultContext.onboardingVersion),
    variantId: safeVersion(previous.variantId, defaultContext.variantId),
    experimentVariants: safeVariants(previous.experimentVariants),
  };
}

/** Old analytics.v1 held preferences only. Ignore any legacy queue instead of replaying unfiltered data. */
function readPreferences(): { optOut: boolean } {
  const legacy = getJSON<unknown>(KEYS.analytics, {});
  const optOut = !!legacy && typeof legacy === 'object' &&
    (legacy as { optOut?: unknown }).optOut === true;
  if (legacy && typeof legacy === 'object' && Object.keys(legacy).some((key) => key !== 'optOut')) {
    setJSON(KEYS.analytics, { optOut });
  }
  return { optOut };
}

let state: State | null = null;

function getState(): State {
  if (state) return state;
  const stored = getJSON<Partial<State> | null>(STATE_KEY, null);
  if (stored?.version !== SCHEMA_VERSION || typeof stored.playerId !== 'string' ||
      typeof stored.sessionId !== 'string' || !safeAnalyticsId(stored.playerId) ||
      !safeAnalyticsId(stored.sessionId)) {
    state = freshState();
    return state;
  }
  // Validate persisted envelopes. A damaged or older queue cannot bypass privacy filtering.
  const outbox = Array.isArray(stored.outbox) ? stored.outbox.filter(validPending).slice(-MAX_OUTBOX) : [];
  state = {
    version: 2,
    playerId: stored.playerId,
    sessionId: stored.sessionId,
    lastActivityAt: typeof stored.lastActivityAt === 'number' && Number.isFinite(stored.lastActivityAt)
      ? stored.lastActivityAt : 0,
    outbox: outbox.map(({ name, envelope }) => ({
      name,
      envelope: {
        event_id: envelope.event_id,
        schema_version: SCHEMA_VERSION,
        player_id: stored.playerId!,
        session_id: safeVersion(envelope.session_id, stored.sessionId!),
        occurred_at: new Date(envelope.occurred_at).toISOString(),
        received_at: typeof envelope.received_at === 'string' &&
          !Number.isNaN(Date.parse(envelope.received_at))
          ? new Date(envelope.received_at).toISOString() : null,
        time_trust: 'client_unverified' as const,
        app_version: safeVersion(envelope.app_version, app.expo.version),
        config_version: safeVersion(envelope.config_version, defaultContext.configVersion),
        content_version: safeVersion(envelope.content_version, defaultContext.contentVersion),
        onboarding_version: safeVersion(envelope.onboarding_version, defaultContext.onboardingVersion),
        variant_id: safeVersion(envelope.variant_id, defaultContext.variantId),
        experiment_variants: safeVariants(envelope.experiment_variants),
        properties: sanitizeProperties(envelope.properties),
      },
    })),
    dedupe: Array.isArray(stored.dedupe) ? stored.dedupe.filter((entry) =>
      typeof entry?.key === 'string' && safeAnalyticsId(entry.key) &&
      typeof entry?.eventId === 'string' && safeAnalyticsId(entry.eventId)).slice(-MAX_DEDUPE) : [],
    context: restoreContext(stored.context),
  };
  return state;
}

function save(): void {
  if (state) setJSON(STATE_KEY, state);
}

function touchSession(current: State, now: number): void {
  const session = touchPersistentSession(now);
  current.sessionId = session.sessionId;
  current.lastActivityAt = session.lastActivityAt;
}

/** Shared session gate for ads; it contains no player ID or event payload. */
export function getAnalyticsSession(): { sessionId: string; isFirstSession: boolean } {
  const session = touchPersistentSession(Date.now());
  return { sessionId: session.sessionId, isFirstSession: session.sessionCount === 1 };
}

const initialPreferences = readPreferences();
if (initialPreferences.optOut) removeKey(STATE_KEY);

/** Opting out immediately clears unsent events and rotates the anonymous identity. */
export const useAnalyticsPrefs = create<{ optOut: boolean; setOptOut: (value: boolean) => void }>((set) => ({
  optOut: initialPreferences.optOut,
  setOptOut: (value) => {
    set({ optOut: value });
    setJSON(KEYS.analytics, { optOut: value });
    if (value) {
      state = null;
      removeKey(STATE_KEY);
    }
  },
}));

/** Variants are stored with the local outbox so delayed delivery retains assignment context. */
export function setAnalyticsContext(next: Partial<AnalyticsContext>): void {
  if (useAnalyticsPrefs.getState().optOut) return;
  const current = getState();
  const update = (key: 'configVersion' | 'contentVersion' | 'onboardingVersion' | 'variantId') => {
    const value = next[key];
    if (typeof value === 'string' && safeAnalyticsId(value)) current.context[key] = value;
  };
  update('configVersion');
  update('contentVersion');
  update('onboardingVersion');
  update('variantId');
  if (next.experimentVariants && typeof next.experimentVariants === 'object') {
    current.context.experimentVariants = safeVariants(next.experimentVariants);
  }
  save();
}

/** Retry pending events on app start or after connectivity returns. */
export function flushAnalytics(): void {
  if (useAnalyticsPrefs.getState().optOut || !isAppMetricaAvailable()) return;
  const current = getState();
  while (current.outbox.length > 0) {
    const pending = current.outbox[0];
    const envelope = { ...pending.envelope, received_at: new Date().toISOString() };
    let accepted = false;
    try {
      accepted = reportEvent(pending.name, envelope);
    } catch {
      // Keep the original event ID for a later attempt.
      return;
    }
    if (!accepted) return;
    current.outbox.shift();
    save();
  }
}

function enqueue(event: string, props?: Record<string, unknown>, dedupeKey?: string): string | null {
  if (useAnalyticsPrefs.getState().optOut || !safeEventName(event)) return null;
  if (dedupeKey !== undefined && !safeAnalyticsId(dedupeKey)) return null;
  const current = getState();
  if (dedupeKey) {
    const existing = current.dedupe.find((entry) => entry.key === dedupeKey);
    if (existing) {
      flushAnalytics();
      return existing.eventId;
    }
  }
  const now = Date.now();
  touchSession(current, now);
  const eventId = newId('e');
  const properties = sanitizeProperties(props);
  const envelope: EventEnvelope = {
    event_id: eventId,
    schema_version: SCHEMA_VERSION,
    player_id: current.playerId,
    session_id: current.sessionId,
    occurred_at: typeof properties.occurredAtMs === 'number'
      && properties.occurredAtMs >= 0 && properties.occurredAtMs <= now
      ? new Date(properties.occurredAtMs).toISOString() : new Date(now).toISOString(),
    received_at: null,
    time_trust: 'client_unverified',
    app_version: app.expo.version,
    config_version: current.context.configVersion,
    content_version: properties.contentVersion?.toString() ?? current.context.contentVersion,
    onboarding_version: current.context.onboardingVersion,
    variant_id: current.context.variantId,
    experiment_variants: { ...current.context.experimentVariants },
    properties,
  };
  current.outbox.push({ name: event, envelope });
  if (dedupeKey) {
    current.dedupe.push({ key: dedupeKey, eventId });
    if (current.dedupe.length > MAX_DEDUPE) {
      const delivered = current.dedupe.findIndex((entry) =>
        !current.outbox.some((pending) => pending.envelope.event_id === entry.eventId));
      current.dedupe.splice(delivered >= 0 ? delivered : 0, 1);
    }
  }
  if (current.outbox.length > MAX_OUTBOX) {
    let removable = current.outbox.findIndex(({ name }) => !REMINDER_EVENTS.has(name) && !ESSENTIAL_EVENTS.has(name));
    if (removable < 0) removable = current.outbox.findIndex(({ name }) => !REMINDER_EVENTS.has(name));
    // Native reminder ledgers acknowledge trackOnce's return value. Keep older
    // unacknowledged reminders; reject a new one if the entire queue is critical.
    if (removable < 0) removable = current.outbox.length - 1;
    const [dropped] = current.outbox.splice(removable, 1);
    current.dedupe = current.dedupe.filter(({ eventId: id }) => id !== dropped.envelope.event_id);
    if (dropped.envelope.event_id === eventId) {
      save();
      flushAnalytics();
      return null;
    }
  }
  save();
  if (REMINDER_EVENTS.has(event)) {
    const persisted = getJSON<Partial<State> | null>(STATE_KEY, null);
    if (!Array.isArray(persisted?.outbox) || !persisted.outbox.some((pending) => pending.envelope.event_id === eventId)) {
      current.outbox = current.outbox.filter((pending) => pending.envelope.event_id !== eventId);
      current.dedupe = current.dedupe.filter((entry) => entry.eventId !== eventId);
      return null;
    }
  }
  if (__DEV__) console.log('[analytics]', event, properties);
  flushAnalytics();
  return eventId;
}

/** Existing fire-and-forget API. Call only after the corresponding game state is committed. */
export function track(event: string, props?: Record<string, unknown>): void {
  enqueue(event, props);
}

/** Idempotent event for a stable game transaction, such as a reward or puzzle completion. */
export function trackOnce(event: string, dedupeKey: string, props?: Record<string, unknown>): string | null {
  return enqueue(event, props, `${event}:${dedupeKey}`);
}

/** Call only when the app knows this is a new local profile, before showing the first field. */
export function trackFirstOpen(): void {
  trackOnce('first_open', 'local_profile');
}

/** A restart within 30 minutes of activity retains the same analytics session. */
export function trackGameSessionStart(source = 'direct'): void {
  if (useAnalyticsPrefs.getState().optOut) return;
  const current = getState();
  touchSession(current, Date.now());
  save();
  trackOnce('game_session_start', current.sessionId, { source });
}

/** Only manual word submissions and successful voluntary hints count as D_n_play. */
export function trackGameplayAction(action: 'letters_connected' | 'word_submitted' | 'hint_used', props?: Record<string, unknown>): void {
  track('gameplay_action', { ...props, action });
}
