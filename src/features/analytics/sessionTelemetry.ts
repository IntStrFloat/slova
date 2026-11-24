import { getJSON, removeKey, setJSON } from '@/core/storage';
import { getAnalyticsSession, isAnalyticsCollectionEnabled, noteAnalyticsActivity, trackOnce, useAnalyticsPrefs } from './index';

const KEY = 'analytics.session-times.v1';
export const GAMEPLAY_IDLE_THRESHOLD_MS = 60_000;
type Summary = {
  sessionId: string;
  revision: number;
  gameplayMs: number;
  idleAdjustedMs: number;
  adMs: number;
  screenMs: number;
  lastActionAt: number;
  lastAction: string;
  dirty: boolean;
};
type Ledger = { version: 1; summaries: Summary[] };

function allowed(): boolean {
  if (!useAnalyticsPrefs.getState().optOut && isAnalyticsCollectionEnabled()) return true;
  removeKey(KEY);
  return false;
}

function read(): Ledger {
  const saved = getJSON<Ledger | null>(KEY, null);
  return saved?.version === 1 && Array.isArray(saved.summaries)
    ? { version: 1, summaries: saved.summaries.filter((s) => typeof s.sessionId === 'string'
      && [s.revision, s.gameplayMs, s.idleAdjustedMs, s.adMs, s.screenMs, s.lastActionAt]
        .every((n) => Number.isFinite(n) && n >= 0)).slice(-4) }
    : { version: 1, summaries: [] };
}

function update(change: (summary: Summary) => void, createSession = true): void {
  if (!allowed()) return;
  const ledger = read();
  const sessionId = createSession ? getAnalyticsSession().sessionId : ledger.summaries.at(-1)?.sessionId;
  if (!sessionId) return;
  let summary = ledger.summaries.find((s) => s.sessionId === sessionId);
  if (!summary) {
    summary = { sessionId, revision: 0, gameplayMs: 0, idleAdjustedMs: 0, adMs: 0,
      screenMs: 0, lastActionAt: 0, lastAction: 'none', dirty: false };
    ledger.summaries.push(summary);
  }
  change(summary);
  setJSON(KEY, { ...ledger, summaries: ledger.summaries.slice(-4) });
}

export function noteSessionAction(action: string): void {
  noteAnalyticsActivity();
  update((s) => {
    s.lastActionAt = Date.now();
    s.lastAction = /^[a-z][a-z0-9_]{0,47}$/.test(action) ? action : 'ui_action';
  });
}

/** Deltas come from the saved foreground gameplay clock, never from wall time. */
export function addGameplayTime(deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  update((s) => {
    s.gameplayMs += deltaMs;
    // Thinking time remains in raw gameplay. This secondary measure has an explicit idle rule.
    const idleWindowRemaining = Math.max(0, GAMEPLAY_IDLE_THRESHOLD_MS - (Date.now() - deltaMs - s.lastActionAt));
    if (s.lastActionAt > 0) s.idleAdjustedMs += Math.min(deltaMs, idleWindowRemaining);
    s.dirty = true;
  });
}

/** A banner is concurrent with gameplay and must not contribute to fullscreen ad time. */
export function addAdTime(deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  update((s) => { s.adMs += deltaMs; s.dirty = true; }, false);
}

export function addScreenTime(deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  update((s) => { s.screenMs += deltaMs; s.dirty = true; }, false);
}

/** Cumulative revisions: analysis takes the latest revision per session, never sums them. */
export function flushSessionSummary(reason: string): void {
  if (!allowed()) return;
  const ledger = read();
  for (const s of ledger.summaries) {
    if (!s.dirty) continue;
    const revision = s.revision + 1;
    const accepted = trackOnce('gameplay_session_summary', `${s.sessionId}:${revision}`, {
      analytics_session_id: s.sessionId, revision, summary_scope: 'session',
      gameplay_visible_ms: s.gameplayMs, idle_adjusted_ms: s.idleAdjustedMs,
      idle_threshold_ms: GAMEPLAY_IDLE_THRESHOLD_MS, ad_ms: s.adMs, screen_ms: s.screenMs,
      last_action: s.lastAction, reason,
    });
    if (accepted) { s.revision = revision; s.dirty = false; }
  }
  setJSON(KEY, ledger);
}

export function clearSessionTelemetry(): void { removeKey(KEY); }
