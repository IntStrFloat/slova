import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import { getString, KEYS, storage } from '@/core/storage';
import { dayKey, daysBetween, effectiveToday, isDayKey } from '@/core/time';
import { useCurrency } from '@/features/currency';
import { trackOnce } from '@/features/analytics';

export interface DailyBonusState {
  lastDay: string | null;
  index: number; // 0-based calendar position; reward caps at day seven.
}

interface PendingLoginGift {
  dateKey: string;
  index: number;
  reward: number;
  effectId: string;
}

interface Saved extends DailyBonusState {
  version: 2;
  maxSeenDay: string | null;
  pendingGift: PendingLoginGift | null;
}

interface ClaimResult {
  reward: number | null;
  day: number;
  error?: 'save_failed';
  occurredAtMs?: number;
}

const CAL = ECONOMY.daily.loginCalendar;

export function loginGiftEffectId(date: string): string {
  return `login_gift:${date}`;
}

/** Pure seven-day calendar calculation; the grant itself is handled separately. */
export function claimLoginBonus(
  state: DailyBonusState,
  today: string,
): { state: DailyBonusState; reward: number | null; day: number } {
  if (state.lastDay === today) return { state, reward: null, day: state.index + 1 };
  const consecutive = state.lastDay !== null && daysBetween(state.lastDay, today) === 1;
  const index = consecutive ? state.index + 1 : 0;
  const reward = CAL[Math.min(index, CAL.length - 1)];
  return { state: { lastDay: today, index }, reward, day: index + 1 };
}

function fresh(): Saved {
  return { version: 2, lastDay: null, index: -1, maxSeenDay: null, pendingGift: null };
}

function isProgress(value: Record<string, unknown>): boolean {
  return (value.lastDay === null || (typeof value.lastDay === 'string' && isDayKey(value.lastDay)))
    && Number.isSafeInteger(value.index) && (value.index as number) >= -1;
}

function decode(raw: string | null): { state: Saved; legacy: boolean } | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Record<string, unknown>;
    if (!isProgress(value)) return null;
    if (value.version !== 2) {
      return { state: { ...fresh(), lastDay: value.lastDay as string | null, index: value.index as number,
        maxSeenDay: value.lastDay as string | null }, legacy: true };
    }
    if (value.maxSeenDay !== null && (typeof value.maxSeenDay !== 'string' || !isDayKey(value.maxSeenDay))) return null;
    const pending = value.pendingGift;
    if (pending !== null) {
      if (!pending || typeof pending !== 'object') return null;
      const gift = pending as Record<string, unknown>;
      if (typeof gift.dateKey !== 'string' || !isDayKey(gift.dateKey)
        || gift.effectId !== loginGiftEffectId(gift.dateKey)
        || !Number.isSafeInteger(gift.index) || (gift.index as number) < 0
        || !Number.isSafeInteger(gift.reward) || (gift.reward as number) <= 0) return null;
    }
    return { state: value as unknown as Saved, legacy: false };
  } catch {
    return null;
  }
}

export function loadDailyBonus(): Saved {
  const primary = decode(getString(KEYS.dailyBonus));
  const backup = decode(getString(KEYS.dailyBonusBackup));
  const state = primary?.state ?? backup?.state ?? fresh();
  if (!primary && backup) {
    try { storage.set(KEYS.dailyBonus, JSON.stringify(state)); } catch { /* retry with preserved backup */ }
  } else if (primary?.legacy) {
    try {
      storage.set(KEYS.dailyBonusBackup, JSON.stringify(state));
      storage.set(KEYS.dailyBonus, JSON.stringify(state));
    } catch { /* legacy remains readable on next launch */ }
  }
  return state;
}

/** Save the previous valid state first; a failed write cannot become visible. */
function persist(next: Saved, previous: Saved): boolean {
  try {
    storage.set(KEYS.dailyBonusBackup, JSON.stringify(previous));
    const serialized = JSON.stringify(next);
    storage.set(KEYS.dailyBonus, serialized);
    return storage.getString(KEYS.dailyBonus) === serialized;
  } catch {
    return false;
  }
}

interface Store extends Saved {
  claim: () => ClaimResult;
  reconcilePending: () => ClaimResult;
  canClaim: () => boolean;
  reset: () => void;
}

function saved(get: () => Store): Saved {
  const { version, lastDay, index, maxSeenDay, pendingGift } = get();
  return { version, lastDay, index, maxSeenDay, pendingGift };
}

const init = loadDailyBonus();

export const useDailyBonus = create<Store>((set, get) => ({
  ...init,
  canClaim: () => Boolean(get().pendingGift)
    || get().lastDay !== effectiveToday(get().maxSeenDay ?? get().lastDay, dayKey()),
  reconcilePending: () => {
    const pending = get().pendingGift;
    if (!pending) return { reward: null, day: get().index + 1 };
    const wallet = useCurrency.getState();
    try {
      if (!wallet.hasApplied(pending.effectId)) {
        const added = wallet.addOnce(pending.effectId, 'coins', pending.reward);
        if (!added && !useCurrency.getState().hasApplied(pending.effectId)) {
          return { reward: null, day: pending.index + 1, error: 'save_failed' };
        }
      }
    } catch {
      try { trackOnce('reward_grant_failed', `${pending.effectId}:failure`, { rewardId: pending.effectId,
        operation_id: pending.effectId, attempt_no: 1, source: 'daily_bonus', reason: 'save_failed', retryable: true }); } catch { /* retry preserved */ }
      return { reward: null, day: pending.index + 1, error: 'save_failed' };
    }
    const previous = saved(get);
    const next: Saved = {
      ...previous,
      lastDay: pending.dateKey,
      index: pending.index,
      maxSeenDay: effectiveToday(previous.maxSeenDay, pending.dateKey),
      pendingGift: null,
    };
    if (!persist(next, previous)) return { reward: null, day: pending.index + 1, error: 'save_failed' };
    set(next);
    return { reward: pending.reward, day: pending.index + 1, occurredAtMs: Date.now() };
  },
  claim: () => {
    if (get().pendingGift) return get().reconcilePending();
    const today = effectiveToday(get().maxSeenDay ?? get().lastDay, dayKey());
    const result = claimLoginBonus({ lastDay: get().lastDay, index: get().index }, today);
    if (result.reward === null) return { reward: null, day: result.day };
    const previous = saved(get);
    const next: Saved = {
      ...previous,
      maxSeenDay: today,
      pendingGift: {
        dateKey: today,
        index: result.state.index,
        reward: result.reward,
        effectId: loginGiftEffectId(today),
      },
    };
    if (!persist(next, previous)) return { reward: null, day: result.day, error: 'save_failed' };
    set(next);
    return get().reconcilePending();
  },
  reset: () => {
    const previous = saved(get);
    const next = fresh();
    if (persist(next, previous)) set(next);
  },
}));
