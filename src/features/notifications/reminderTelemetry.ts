import { AppState, Platform } from 'react-native';

import { getJSON, getString, setJSON } from '@/core/storage';
import { isDayKey } from '@/core/time';
import { trackOnce, useAnalyticsPrefs } from '@/features/analytics';

import RemindersModule from '../../../modules/reminders/src/RemindersModule';

const JOURNAL_KEY = 'daily.reminders.telemetry-ack.v1';
const ATTRIBUTION_MS = 30 * 60 * 1000;
const MAX_ACKS = 256;
const ID_PATTERN = /^daily_\d{4}-\d{2}-\d{2}_\d{1,16}$/;

export interface ReminderTelemetryEvent {
  eventId: string;
  reminderId: string;
  kind: 'scheduled' | 'delivered' | 'opened';
  dateKey: string;
  occurredAtMs: number;
  fireAtMs: number;
}

interface TelemetryJournal {
  version: 1;
  acknowledged: string[];
  opened: { reminderId: string; dateKey: string; openedAtMs: number } | null;
}

function readJournal(): TelemetryJournal {
  const stored = getJSON<Partial<TelemetryJournal> | null>(JOURNAL_KEY, null);
  return {
    version: 1,
    acknowledged: Array.isArray(stored?.acknowledged)
      ? stored.acknowledged.filter((id) => typeof id === 'string').slice(-MAX_ACKS) : [],
    opened: stored?.opened && ID_PATTERN.test(stored.opened.reminderId) &&
      isDayKey(stored.opened.dateKey) && Number.isFinite(stored.opened.openedAtMs)
      ? stored.opened : null,
  };
}

function parseEvents(raw: string): ReminderTelemetryEvent[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ReminderTelemetryEvent =>
      item !== null && typeof item === 'object' &&
      typeof item.reminderId === 'string' && ID_PATTERN.test(item.reminderId) &&
      ['scheduled', 'delivered', 'opened'].includes(item.kind) &&
      item.eventId === `${item.reminderId}:${item.kind}` &&
      typeof item.dateKey === 'string' && isDayKey(item.dateKey) &&
      typeof item.occurredAtMs === 'number' && Number.isFinite(item.occurredAtMs) && item.occurredAtMs >= 0 &&
      typeof item.fireAtMs === 'number' && Number.isFinite(item.fireAtMs) && item.fireAtMs > 0,
    );
  } catch {
    return [];
  }
}

/** Read first, persist analytics and acknowledgements, then retire native entries. */
export function drainDailyReminderTelemetry(): number {
  if (Platform.OS !== 'android' || !RemindersModule) return 0;
  try {
    const events = parseEvents(RemindersModule.readTelemetry());
    if (!events.length) return 0;
    const journal = readJournal();
    const accepted: string[] = [];
    const optedOut = useAnalyticsPrefs.getState().optOut;
    for (const event of events) {
      if (!optedOut && !journal.acknowledged.includes(event.eventId)) {
        const eventId = trackOnce(`reminder_${event.kind}`, event.eventId, {
          promptId: event.reminderId,
          eventInstanceId: event.eventId,
          dateKey: event.dateKey,
          source: 'local_reminder',
          // Actual native occurrence is retained separately from JS receipt time.
          occurredAtMs: event.occurredAtMs,
          fireAtMs: event.fireAtMs,
        });
        if (!eventId) continue;
        if (event.kind === 'opened' &&
            (!journal.opened || event.occurredAtMs >= journal.opened.openedAtMs)) {
          journal.opened = {
            reminderId: event.reminderId, dateKey: event.dateKey, openedAtMs: event.occurredAtMs,
          };
        }
      }
      accepted.push(event.eventId);
      if (!journal.acknowledged.includes(event.eventId)) journal.acknowledged.push(event.eventId);
    }
    if (optedOut) journal.opened = null;
    journal.acknowledged = journal.acknowledged.slice(-MAX_ACKS);
    setJSON(JOURNAL_KEY, journal);
    // Storage helpers tolerate unavailable MMKV. Never ack a journal that wasn't saved.
    if (getString(JOURNAL_KEY) !== JSON.stringify(journal)) return 0;
    RemindersModule.acknowledgeTelemetry(JSON.stringify(accepted));
    return accepted.length;
  } catch {
    // Retain the native journal and retry on resume; navigation must remain available.
    return 0;
  }
}

export function getReminderGameplayAttribution(nowMs = Date.now()): Record<string, string> {
  if (useAnalyticsPrefs.getState().optOut) return {};
  drainDailyReminderTelemetry();
  const opened = readJournal().opened;
  if (!opened || nowMs < opened.openedAtMs || nowMs - opened.openedAtMs > ATTRIBUTION_MS) return {};
  return { promptId: opened.reminderId, dateKey: opened.dateKey, source: 'local_reminder' };
}

/** A word submission or successful voluntary hint proves return to gameplay. */
export function trackReminderGameplay(action: 'letters_connected' | 'word_submitted' | 'hint_used'): void {
  const attribution = getReminderGameplayAttribution();
  if (!attribution.promptId) return;
  trackOnce('reminder_gameplay', attribution.promptId, { ...attribution, action });
}

/** Mount once in root. Handles foreground taps without depending on a new app session. */
export function startDailyReminderTelemetry(): () => void {
  if (Platform.OS !== 'android' || !RemindersModule) return () => {};
  drainDailyReminderTelemetry();
  const listener = RemindersModule.addListener('onReminderTelemetry', () => drainDailyReminderTelemetry());
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') drainDailyReminderTelemetry();
  });
  return () => {
    listener.remove();
    appState.remove();
  };
}
