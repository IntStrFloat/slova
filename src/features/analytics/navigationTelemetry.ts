import { track, trackOnce, useAnalyticsPrefs } from './index';
import { noteSessionAction } from './sessionTelemetry';

const SCREENS = new Set(['home', 'game', 'daily', 'collection', 'quests', 'journey_event', 'marathon',
  'wheel', 'settings', 'profile', 'shop', 'tutorial_practice', 'leaderboard', 'teams', 'events']);
let current: { screen: string; visitId: string } | null = null;
let nextSequence = 0;
const processId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export function telemetryId(prefix: string): string { return `${prefix}_${processId}_${++nextSequence}`; }

export function screenFromPath(pathname: string): string {
  if (pathname === '/') return 'home';
  const name = pathname.split('?')[0].replace(/^\/+|\/+$/g, '').replace(/-/g, '_');
  return SCREENS.has(name) ? name : 'other';
}

export function trackScreenVisit(pathname: string, entrySource = 'navigation') {
  const screen = screenFromPath(pathname);
  const previous = current?.screen ?? 'none';
  const visitId = telemetryId('view');
  current = { screen, visitId };
  noteSessionAction('screen_enter');
  trackOnce('screen_viewed', visitId, {
    screen, previous_screen: previous, screen_visit_id: visitId, entry_source: entrySource,
  });
  return current;
}

export function currentScreenVisit() { return current; }

/** Call only with static product control IDs, never labels or user-entered strings. */
export function trackUiAction(elementId: string, action = 'press', outcome = 'accepted'): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(elementId) || useAnalyticsPrefs.getState().optOut) return;
  noteSessionAction(action === 'press' ? 'ui_action' : action);
  track('ui_action', { interaction_id: telemetryId('tap'), screen: current?.screen ?? 'other',
    screen_visit_id: current?.visitId ?? 'unknown', element_id: elementId, action, outcome });
}

export function trackAppReady(startedAt: number, launchId: string, launchKind: 'cold' | 'warm') {
  trackOnce('app_ready', launchId, { launch_id: launchId, launch_kind: launchKind,
    startup_ms: Math.max(0, Date.now() - startedAt), screen: current?.screen ?? 'home', restore_result: 'ready' });
}
