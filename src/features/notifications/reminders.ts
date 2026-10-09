import { Platform } from 'react-native';

import { getJSON, setJSON } from '@/core/storage';
import { dayKey, isDayKey } from '@/core/time';
import { trackOnce } from '@/features/analytics';
import { selectDailyContent, useDailyPuzzle } from '@/features/dailypuzzle';
import { useSettings } from '@/features/settings';

import RemindersModule from '../../../modules/reminders/src/RemindersModule';
import type { ReminderPermissionResult } from '../../../modules/reminders/src/RemindersModule';
import { getPushSoftAskOutcome } from './softAsk';
import { drainDailyReminderTelemetry } from './reminderTelemetry';

const REMINDER_HOUR = 18;
const HORIZON_DAYS = 7;
const MAX_PER_WEEK = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CONSENT_KEY = 'daily.reminders.consent.v1';

export type ReminderConsentSource = 'home' | 'daily' | 'settings';
interface ReminderConsent {
  version: 1;
  optedIn: boolean;
  optedInAtMs: number;
  firstLocalDateKey: string | null;
  source: ReminderConsentSource | 'legacy';
}

export interface ReminderSchedule {
  dateKey: string;
  fireAtMs: number;
}

export interface SentDailyReminder {
  dateKey: string;
  sentAtMs: number;
  localDateKey?: string;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface ReminderPlanInput {
  now: Date;
  enabled: boolean;
  permissionGranted: boolean;
  solvedDates: readonly string[];
  sentHistory: readonly SentDailyReminder[];
  hasVerifiedContent: (dateKey: string) => boolean;
  /** New voluntary opt-ins begin tomorrow. Existing opt-ins may keep today's pending alarm. */
  firstLocalDateKey?: string | null;
}

/** Device-local 18:00 is outside the 21:00–10:00 quiet period. */
export function planDailyReminders(input: ReminderPlanInput): ReminderSchedule[] {
  if (!input.enabled || !input.permissionGranted) return [];
  const solved = new Set(input.solvedDates.filter(isDayKey));
  const history = input.sentHistory.filter((item) =>
    isDayKey(item.dateKey) && Number.isFinite(item.sentAtMs) && item.sentAtMs >= 0,
  );
  const planned: ReminderSchedule[] = [];
  const nowMs = input.now.getTime();
  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    const fireAt = new Date(
      input.now.getFullYear(), input.now.getMonth(), input.now.getDate() + offset,
      REMINDER_HOUR, 0, 0, 0,
    );
    const fireAtMs = fireAt.getTime();
    if (fireAtMs <= nowMs) continue;
    if (input.firstLocalDateKey && localDateKey(fireAt) < input.firstLocalDateKey) continue;
    const dateKey = dayKey(fireAt);
    if (solved.has(dateKey) || history.some((sent) => sent.dateKey === dateKey ||
        (sent.localDateKey ?? localDateKey(new Date(sent.sentAtMs))) === localDateKey(fireAt)) ||
        planned.some((item) => item.dateKey === dateKey) || !input.hasVerifiedContent(dateKey)) continue;
    const inWindow = history.filter((sent) => sent.sentAtMs <= fireAtMs && fireAtMs - sent.sentAtMs < WEEK_MS).length +
      planned.filter((item) => fireAtMs - item.fireAtMs < WEEK_MS).length;
    if (inWindow >= MAX_PER_WEEK) continue;
    planned.push({ dateKey, fireAtMs });
  }
  return planned;
}

function parseSentHistory(json: string): SentDailyReminder[] {
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SentDailyReminder =>
      item !== null && typeof item === 'object' &&
      typeof item.dateKey === 'string' && isDayKey(item.dateKey) &&
      typeof item.sentAtMs === 'number' && Number.isFinite(item.sentAtMs),
    );
  } catch {
    return [];
  }
}

export function isDailyReminderAvailable(): boolean {
  return Platform.OS === 'android' && RemindersModule !== null;
}

function readConsent(): ReminderConsent | null {
  const stored = getJSON<Partial<ReminderConsent> | null>(CONSENT_KEY, null);
  if (stored?.version === 1 && typeof stored.optedIn === 'boolean') {
    return {
      version: 1,
      optedIn: stored.optedIn,
      optedInAtMs: typeof stored.optedInAtMs === 'number' && Number.isFinite(stored.optedInAtMs)
        ? stored.optedInAtMs : 0,
      firstLocalDateKey: typeof stored.firstLocalDateKey === 'string' && isDayKey(stored.firstLocalDateKey)
        ? stored.firstLocalDateKey : null,
      source: stored.source === 'home' || stored.source === 'daily' || stored.source === 'settings'
        ? stored.source : 'legacy',
    };
  }
  // A checked setting or OS permission alone is not proof of consent. Migrate only the
  // old explicit allow outcome; a persisted opt-out above prevents this from reviving it.
  if (getPushSoftAskOutcome() !== 'allowed') return null;
  const consent: ReminderConsent = {
    version: 1, optedIn: true, optedInAtMs: 0, firstLocalDateKey: null, source: 'legacy',
  };
  setJSON(CONSENT_KEY, consent);
  return consent;
}

export function hasDailyReminderConsent(): boolean {
  return readConsent()?.optedIn === true;
}

/** Call only from an explicit "turn on reminders" action after the soft ask. */
export async function requestDailyReminderPermission(source: ReminderConsentSource = 'daily'): Promise<ReminderPermissionResult> {
  if (!isDailyReminderAvailable()) return 'unavailable';
  try {
    const result = await RemindersModule!.requestPermission();
    if (result === 'granted') {
      const previous = readConsent();
      if (!previous?.optedIn) {
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const consent: ReminderConsent = {
          version: 1, optedIn: true, optedInAtMs: now.getTime(),
          firstLocalDateKey: localDateKey(tomorrow), source,
        };
        setJSON(CONSENT_KEY, consent);
        trackOnce('reminder_consent', `local_${consent.optedInAtMs}`, { source, result: 'allowed' });
      }
    }
    return result;
  } catch {
    return 'unavailable';
  }
}

/** Safe to call on app resume, daily completion, or a settings change; never requests permission. */
export async function syncDailyReminders(now = new Date()): Promise<{ scheduled: number; reason: string }> {
  if (!isDailyReminderAvailable()) return { scheduled: 0, reason: 'unavailable' };
  const module = RemindersModule!;
  try {
    drainDailyReminderTelemetry();
    const enabled = useSettings.getState().notifications;
    const consent = readConsent();
    const solvedDates = useDailyPuzzle.getState().solvedDates;
    if (!enabled || !consent?.optedIn) {
      module.cancelAll();
      return { scheduled: 0, reason: enabled ? 'no_consent' : 'disabled' };
    }
    if (!module.permissionGranted()) {
      module.cancelAll();
      return { scheduled: 0, reason: 'permission' };
    }
    const plan = planDailyReminders({
      now,
      enabled,
      permissionGranted: true,
      solvedDates,
      sentHistory: parseSentHistory(module.sentHistory()),
      hasVerifiedContent: (date) => selectDailyContent(date, 'starter') !== null,
      firstLocalDateKey: consent.firstLocalDateKey,
    });
    const scheduled = module.replaceSchedules(JSON.stringify(plan));
    drainDailyReminderTelemetry();
    return { scheduled, reason: scheduled ? 'scheduled' : 'no_verified_unsolved_date' };
  } catch {
    // A failed sync must not delay navigation; retry on the next app resume.
    try { module.cancelAll(); } catch { /* Native service is unavailable. */ }
    return { scheduled: 0, reason: 'native_error' };
  }
}

/** Settings opt-out: cancel every future local reminder immediately. */
export async function cancelDailyReminders(): Promise<void> {
  setJSON(CONSENT_KEY, {
    version: 1, optedIn: false, optedInAtMs: 0, firstLocalDateKey: null, source: 'settings',
  } satisfies ReminderConsent);
  if (isDailyReminderAvailable()) RemindersModule!.cancelAll();
}

/** A solved daily date must not generate a pending notification. */
export async function cancelDailyReminderForDate(dateKey: string): Promise<void> {
  if (isDayKey(dateKey) && isDailyReminderAvailable()) RemindersModule!.cancelDate(dateKey);
}
