import { create } from 'zustand';

import type { Level } from '@/core/engine';
import { validateLevel } from '@/core/engine';
import { getString, KEYS, storage } from '@/core/storage';
import { dayKey, effectiveToday, isDayKey } from '@/core/time';
import { clearGameSnapshot, loadGameSnapshot } from '@/features/game/persistence';

import { dailySchedule, selectDailyContent, type DailyScheduleEntry, type DailyVariant } from './content';

const DAILY_REWARD_COINS = 10;
const TOME_SIZE = 22;
const POSTCARD_THRESHOLDS = [3, 8, 15, 22] as const;

export interface DailyPuzzleInstance {
  dateKey: string;
  puzzleId: string;
  variantId: DailyVariant;
  /** Pinned at first open, including the grid, answers and content version. */
  level: Level;
  startedAt: string;
  /** Actual product date of completion; may differ from the puzzle date. */
  completedAtDay?: string;
}

export interface DailyPuzzleState {
  schemaVersion: 2;
  maxSeenDay: string | null;
  /** Puzzle dates are permanent within the local profile, independent of streaks. */
  solvedDates: string[];
  instances: Record<string, DailyPuzzleInstance>;
}

export interface DailyCompletion {
  /** Coins newly earned by this call; zero on a duplicate. */
  reward: number;
  /** Stable entitlement for a currency addOnce retry after an interrupted claim. */
  rewardEntitlement: number;
  firstCompletion: boolean;
  solvedCount: number;
  completedAtDay: string;
}

export interface TomeProgress {
  volume: number;
  inVolume: number;
  postcardsUnlocked: number;
  nextThreshold: number | null;
  total: number;
}

export interface CarriedDailyReplacement {
  kept: DailyPuzzleInstance;
  discardedDates: string[];
}

function fresh(): DailyPuzzleState {
  return { schemaVersion: 2, maxSeenDay: null, solvedDates: [], instances: {} };
}

function isValidPinnedLevel(value: unknown): value is Level {
  if (!value || typeof value !== 'object') return false;
  const level = value as Partial<Level>;
  if (!Array.isArray(level.letters) || !Array.isArray(level.answers) || !Array.isArray(level.grid?.cells)) return false;
  try {
    return validateLevel(level as Level).ok;
  } catch {
    return false;
  }
}

/** Legacy streak cannot prove its earlier dates, so migrate only the recorded day. */
export function migrateDailyPuzzle(value: unknown): DailyPuzzleState {
  if (!value || typeof value !== 'object') return fresh();
  const saved = value as Record<string, unknown>;
  if (saved.schemaVersion !== 2) {
    const lastDoneDay = typeof saved.lastDoneDay === 'string' && isDayKey(saved.lastDoneDay)
      ? saved.lastDoneDay : null;
    return {
      ...fresh(),
      maxSeenDay: lastDoneDay,
      solvedDates: lastDoneDay ? [lastDoneDay] : [],
    };
  }

  const solvedDates = Array.isArray(saved.solvedDates)
    ? [...new Set(saved.solvedDates.filter((date): date is string => typeof date === 'string' && isDayKey(date)))].sort()
    : [];
  const instances: Record<string, DailyPuzzleInstance> = {};
  if (saved.instances && typeof saved.instances === 'object') {
    for (const [date, raw] of Object.entries(saved.instances)) {
      if (!isDayKey(date) || !raw || typeof raw !== 'object') continue;
      const candidate = raw as Partial<DailyPuzzleInstance>;
      if (candidate.dateKey !== date || typeof candidate.puzzleId !== 'string') continue;
      if (candidate.variantId !== 'starter' && candidate.variantId !== 'standard') continue;
      if (!isValidPinnedLevel(candidate.level)) continue;
      if (typeof candidate.startedAt !== 'string') continue;
      instances[date] = candidate as DailyPuzzleInstance;
    }
  }
  const maxSeenDay = typeof saved.maxSeenDay === 'string' && isDayKey(saved.maxSeenDay)
    ? saved.maxSeenDay : null;
  const latestRecorded = [...solvedDates, ...Object.keys(instances)].sort().at(-1) ?? null;
  return {
    schemaVersion: 2,
    maxSeenDay: latestRecorded && (!maxSeenDay || latestRecorded > maxSeenDay) ? latestRecorded : maxSeenDay,
    solvedDates,
    instances,
  };
}

export function tomeProgressFor(total: number): TomeProgress {
  const count = Math.max(0, Math.trunc(total));
  const volume = count === 0 ? 1 : Math.floor((count - 1) / TOME_SIZE) + 1;
  const inVolume = count === 0 ? 0 : ((count - 1) % TOME_SIZE) + 1;
  const postcardsUnlocked = POSTCARD_THRESHOLDS.filter((threshold) => inVolume >= threshold).length;
  return {
    volume,
    inVolume,
    postcardsUnlocked,
    nextThreshold: POSTCARD_THRESHOLDS.find((threshold) => inVolume < threshold) ?? null,
    total: count,
  };
}

export function completePuzzle(
  state: DailyPuzzleState,
  puzzleDate: string,
  completedAtDay: string,
): { state: DailyPuzzleState; result: DailyCompletion } {
  const duplicate = !isDayKey(puzzleDate) || !state.instances[puzzleDate] || state.solvedDates.includes(puzzleDate);
  if (duplicate) {
    const entitled = Boolean(state.instances[puzzleDate] && state.solvedDates.includes(puzzleDate));
    return { state, result: {
      reward: 0,
      rewardEntitlement: entitled ? DAILY_REWARD_COINS : 0,
      firstCompletion: false,
      solvedCount: state.solvedDates.length,
      completedAtDay,
    } };
  }
  const instance = state.instances[puzzleDate];
  const next: DailyPuzzleState = {
    ...state,
    solvedDates: [...state.solvedDates, puzzleDate].sort(),
    instances: {
      ...state.instances,
      [puzzleDate]: { ...instance, completedAtDay },
    },
  };
  return {
    state: next,
    result: {
      reward: DAILY_REWARD_COINS,
      rewardEntitlement: DAILY_REWARD_COINS,
      firstCompletion: true,
      solvedCount: next.solvedDates.length,
      completedAtDay,
    },
  };
}

interface Store extends DailyPuzzleState {
  /** Transitional compatibility while screens migrate away from a streak label. */
  streak: number;
  effectiveDay: () => string;
  refreshDay: () => string;
  getOrStartDaily: (date?: string, variant?: DailyVariant) => DailyPuzzleInstance | null;
  getDailyLevel: (date: string) => Level | null;
  completeDaily: (puzzleDate: string) => DailyCompletion;
  isDone: (date: string) => boolean;
  ownedDates: () => string[];
  carryCandidates: () => DailyPuzzleInstance[];
  pendingOlder: () => DailyPuzzleInstance | null;
  replaceCarriedDaily: (keepDate: string) => CarriedDailyReplacement | null;
  tomeProgress: () => TomeProgress;
  schedule: (start?: string, variant?: DailyVariant) => DailyScheduleEntry[];
  /** Legacy callers; use completeDaily(puzzleDate) for pinned puzzle completion. */
  isDoneToday: () => boolean;
  complete: () => { reward: number; streak: number };
  reset: () => void;
}

function decodeStored(raw: string | null): { state: DailyPuzzleState; legacy: boolean } | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const saved = value as Record<string, unknown>;
    if (saved.schemaVersion === 2) {
      if (saved.maxSeenDay !== null && (typeof saved.maxSeenDay !== 'string' || !isDayKey(saved.maxSeenDay))) return null;
      if (!Array.isArray(saved.solvedDates) || !saved.instances || typeof saved.instances !== 'object'
        || Array.isArray(saved.instances)) return null;
      const state = migrateDailyPuzzle(saved);
      if (state.solvedDates.length !== saved.solvedDates.length
        || Object.keys(state.instances).length !== Object.keys(saved.instances).length) return null;
      return { state, legacy: false };
    }
    if ((saved.lastDoneDay === null || (typeof saved.lastDoneDay === 'string' && isDayKey(saved.lastDoneDay)))
      && typeof saved.streak === 'number' && Number.isFinite(saved.streak)) {
      return { state: migrateDailyPuzzle(saved), legacy: true };
    }
  } catch {
    // A torn or malformed current value is recovered from the prior valid slot.
  }
  return null;
}

export function recoverDailyPuzzle(currentRaw: string | null, backupRaw: string | null): {
  state: DailyPuzzleState;
  restorePrimary: boolean;
  migratePrimary: boolean;
} {
  const primary = decodeStored(currentRaw);
  const backup = decodeStored(backupRaw);
  return {
    state: primary?.state ?? backup?.state ?? fresh(),
    restorePrimary: !primary && Boolean(backup),
    migratePrimary: Boolean(primary?.legacy),
  };
}

let historyCoverageUncertain = false;
export function loadDailyPuzzle(): DailyPuzzleState {
  const currentRaw = getString(KEYS.dailyPuzzle), backupRaw = getString(KEYS.dailyPuzzleBackup);
  const recovered = recoverDailyPuzzle(currentRaw, backupRaw);
  if (recovered.restorePrimary || recovered.migratePrimary || currentRaw !== null && !decodeStored(currentRaw)
    || currentRaw === null && backupRaw === null && getString(KEYS.dailyHistoryProof) !== null) {
    historyCoverageUncertain = true;
    try { storage.set(KEYS.dailyHistoryProof, JSON.stringify({ version: 1, complete: false })); } catch { /* Missing coverage never authorizes a new first claim. */ }
  }
  const state = recovered.state;
  if (recovered.restorePrimary) {
    try { storage.set(KEYS.dailyPuzzle, JSON.stringify(state)); } catch { /* retry on next accepted action */ }
  } else if (recovered.migratePrimary) {
    try {
      storage.set(KEYS.dailyPuzzleBackup, JSON.stringify(state));
      storage.set(KEYS.dailyPuzzle, JSON.stringify(state));
    } catch { /* legacy data remains readable until a later successful save */ }
  }
  return state;
}

const init = loadDailyPuzzle();
if (getString(KEYS.dailyHistoryProof) === null && getString(KEYS.dailyPuzzle) === null
  && getString(KEYS.dailyPuzzleBackup) === null && (getString(KEYS.currency) === null
    || (() => { try { return JSON.parse(getString(KEYS.currency)!).newProfile === true; } catch { return false; } })())) {
  storage.set(KEYS.dailyHistoryProof, JSON.stringify({ version: 1, complete: true }));
}
export function getDailyPriorCompletion(date: string): boolean | null {
  const saved = decodeStored(getString(KEYS.dailyPuzzle));
  if (useDailyPuzzle.getState().solvedDates.includes(date) || saved?.state.solvedDates.includes(date)) return true;
  let complete = false;
  try { const proof = JSON.parse(getString(KEYS.dailyHistoryProof) ?? '{}'); complete = proof.version === 1 && proof.complete === true; } catch { /* unknown */ }
  return !historyCoverageUncertain && isDayKey(date) && complete && (!getString(KEYS.dailyPuzzle) || saved && !saved.legacy) ? false : null;
}

/** Both slots must be writable before an action can become visible in memory. */
function persist(next: DailyPuzzleState, previous: DailyPuzzleState): boolean {
  try {
    storage.set(KEYS.dailyPuzzleBackup, JSON.stringify(previous));
    storage.set(KEYS.dailyPuzzle, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

function saved(get: () => Store): DailyPuzzleState {
  const { schemaVersion, maxSeenDay, solvedDates, instances } = get();
  return { schemaVersion, maxSeenDay, solvedDates, instances };
}

function olderUnfinished(state: DailyPuzzleState, today: string): DailyPuzzleInstance[] {
  return Object.values(state.instances)
    .filter((instance) => instance.dateKey < today && !state.solvedDates.includes(instance.dateKey))
    .sort((left, right) => right.dateKey.localeCompare(left.dateKey));
}

export const useDailyPuzzle = create<Store>((set, get) => ({
  ...init,
  streak: init.solvedDates.length,
  effectiveDay: () => effectiveToday(get().maxSeenDay, dayKey()),
  refreshDay: () => {
    const observed = get().effectiveDay();
    if (observed !== get().maxSeenDay) {
      const previous = saved(get);
      const next = { ...previous, maxSeenDay: observed };
      if (persist(next, previous)) set(next);
    }
    return observed;
  },
  getOrStartDaily: (date, variant = 'starter') => {
    const today = get().effectiveDay();
    const puzzleDate = date ?? today;
    if (!isDayKey(puzzleDate)) return null;
    const existing = get().instances[puzzleDate];
    if (existing) {
      get().refreshDay();
      return existing;
    }
    // Only a date first opened while it was current can be carried over.
    if (puzzleDate !== today || get().solvedDates.includes(puzzleDate)) return null;
    // A new date cannot create a third unfinished slot without choosing which
    // already carried puzzle to keep. Existing older grids remain playable.
    if (olderUnfinished(saved(get), today).length > 1) {
      get().refreshDay();
      return null;
    }
    const content = selectDailyContent(puzzleDate, variant);
    if (!content) return null;
    const instance: DailyPuzzleInstance = {
      dateKey: puzzleDate,
      puzzleId: content.puzzleId,
      variantId: content.variantId,
      level: content.level,
      startedAt: new Date().toISOString(),
    };
    const previous = saved(get);
    const next = { ...previous, maxSeenDay: today, instances: { ...previous.instances, [puzzleDate]: instance } };
    if (!persist(next, previous)) return null;
    set(next);
    return instance;
  },
  getDailyLevel: (date) => get().instances[date]?.level ?? null,
  completeDaily: (puzzleDate) => {
    const completedAtDay = get().effectiveDay();
    const previous = saved(get);
    const { state, result } = completePuzzle(previous, puzzleDate, completedAtDay);
    if (result.firstCompletion || previous.maxSeenDay !== completedAtDay) {
      const next = { ...state, maxSeenDay: completedAtDay };
      if (!persist(next, previous)) return {
        reward: 0,
        rewardEntitlement: result.firstCompletion ? 0 : result.rewardEntitlement,
        firstCompletion: false,
        solvedCount: previous.solvedDates.length,
        completedAtDay,
      };
      set({ ...next, streak: next.solvedDates.length });
    }
    return result;
  },
  isDone: (date) => get().solvedDates.includes(date),
  ownedDates: () => [...get().solvedDates],
  carryCandidates: () => olderUnfinished(saved(get), get().effectiveDay()),
  pendingOlder: () => {
    const candidates = get().carryCandidates();
    return candidates.length === 1 ? candidates[0] : null;
  },
  replaceCarriedDaily: (keepDate) => {
    const candidates = get().carryCandidates();
    const kept = candidates.find((instance) => instance.dateKey === keepDate);
    if (!kept || candidates.length < 2) return null;
    const discardedDates = candidates
      .filter((instance) => instance.dateKey !== keepDate)
      .map((instance) => instance.dateKey);
    // A completed game snapshot may still have an unclaimed reward. Do not let
    // replacement erase that entitlement before the claim flow resumes.
    if (discardedDates.some((date) => {
      const snapshot = loadGameSnapshot('daily', undefined, date);
      return snapshot && snapshot.completion.status !== 'playing';
    })) return null;
    const instances = { ...get().instances };
    for (const date of discardedDates) delete instances[date];
    const previous = saved(get);
    const next = { ...previous, maxSeenDay: get().effectiveDay(), instances };
    if (!persist(next, previous)) return null;
    set(next);
    for (const date of discardedDates) clearGameSnapshot('daily', date);
    return { kept, discardedDates };
  },
  tomeProgress: () => tomeProgressFor(get().solvedDates.length),
  schedule: (start, variant = 'starter') => dailySchedule(start ?? get().effectiveDay(), variant),
  isDoneToday: () => get().isDone(get().effectiveDay()),
  complete: () => {
    const result = get().completeDaily(get().effectiveDay());
    return { reward: result.reward, streak: get().solvedDates.length };
  },
  reset: () => {
    storage.set(KEYS.dailyHistoryProof, JSON.stringify({ version: 1, complete: false }));
    const previous = saved(get);
    const next = fresh();
    if (persist(next, previous)) set({ ...next, streak: 0 });
  },
}));

export { dailySchedule, selectDailyContent } from './content';
export type { DailyScheduleEntry, DailyVariant } from './content';
