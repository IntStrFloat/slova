import { getJSON, KEYS, setJSON } from '@/core/storage';

export type PushSoftAskOutcome = 'allowed' | 'declined' | 'dismissed';

interface PushPromptState {
  schemaVersion: 1;
  firstVictoryAt: string | null;
  handled: boolean;
  outcome: PushSoftAskOutcome | null;
}

const EMPTY: PushPromptState = {
  schemaVersion: 1,
  firstVictoryAt: null,
  handled: false,
  outcome: null,
};

function load(): PushPromptState {
  const stored = getJSON<Partial<PushPromptState>>(KEYS.pushPrompt, {});
  return {
    ...EMPTY,
    ...stored,
    schemaVersion: 1,
    firstVictoryAt: typeof stored.firstVictoryAt === 'string' ? stored.firstVictoryAt : null,
    handled: stored.handled === true,
    outcome: stored.outcome === 'allowed' || stored.outcome === 'declined' || stored.outcome === 'dismissed'
      ? stored.outcome : null,
  };
}

/** Kept for old game call sites; campaign victory no longer opens the daily reminder ask. */
export function recordFirstVictoryForPush(now = new Date()): void {
  const state = load();
  if (state.firstVictoryAt) return;
  setJSON(KEYS.pushPrompt, { ...state, firstVictoryAt: now.toISOString() });
}

export interface ReminderIntroduction {
  completedLevels?: number;
  dailyIntroduced?: boolean;
}

/** The offer is voluntary, after five wins or the first introduction to the daily puzzle. */
export function shouldShowPushSoftAsk(introduction: ReminderIntroduction | readonly string[] = {}): boolean {
  const state = load();
  const eligible = Array.isArray(introduction)
    ? introduction.length > 0
    : (introduction as ReminderIntroduction).dailyIntroduced === true ||
      ((introduction as ReminderIntroduction).completedLevels ?? 0) >= 5;
  return eligible && !state.handled;
}

export function markPushSoftAskHandled(outcome: PushSoftAskOutcome = 'dismissed'): void {
  setJSON(KEYS.pushPrompt, { ...load(), handled: true, outcome });
}

export function getPushSoftAskOutcome(): PushSoftAskOutcome | null {
  return load().outcome;
}
