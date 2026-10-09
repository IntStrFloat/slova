import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import { mulberry32 } from '@/core/engine/rng';
import { getJSON, KEYS, setJSON } from '@/core/storage';
import { dayKey } from '@/core/time';

const SECTORS = ECONOMY.wheel.sectors;

export interface PendingWheelSpin {
  effectId: string;
  sector: number;
  value: number;
}

export interface WheelState {
  day: string | null;
  freeUsed: boolean;
  rewardedUsed: number;
  pendingSpin?: PendingWheelSpin | null;
}

function rollover(state: WheelState, today: string): WheelState {
  if (state.day === today) return state;
  return { day: today, freeUsed: false, rewardedUsed: 0, pendingSpin: state.pendingSpin ?? null };
}

/** Чистый редьюсер: совершить вращение (free | rewarded). */
export function spinWheel(
  state: WheelState,
  today: string,
  viaRewarded: boolean,
  rngSeed: number,
): { state: WheelState } & PendingWheelSpin | { state: WheelState; error: string } {
  const s = rollover(state, today);
  if (s.pendingSpin) return { state: s, error: 'pending_spin' };
  if (!viaRewarded) {
    if (s.freeUsed) return { state: s, error: 'no_free_spin' };
  } else if (s.rewardedUsed >= ECONOMY.wheel.maxRewardedSpins) {
    return { state: s, error: 'no_rewarded_spins' };
  }
  const sector = Math.floor(mulberry32(rngSeed)() * SECTORS.length) % SECTORS.length;
  const pendingSpin: PendingWheelSpin = {
    effectId: viaRewarded ? `wheel:${today}:rewarded:${s.rewardedUsed + 1}` : `wheel:${today}:free`,
    sector,
    value: SECTORS[sector],
  };
  const next: WheelState = viaRewarded
    ? { ...s, rewardedUsed: s.rewardedUsed + 1, pendingSpin }
    : { ...s, freeUsed: true, pendingSpin };
  return { state: next, ...pendingSpin };
}

interface Store extends WheelState {
  canFree: () => boolean;
  rewardedLeft: () => number;
  spin: (viaRewarded: boolean) => PendingWheelSpin | null;
  claimPending: (effectId: string) => boolean;
  reset: () => void;
}

const init = getJSON<WheelState>(KEYS.wheel, { day: null, freeUsed: false, rewardedUsed: 0 });

export const useWheel = create<Store>((set, get) => ({
  ...init,
  canFree: () => {
    const s = rollover({ day: get().day, freeUsed: get().freeUsed, rewardedUsed: get().rewardedUsed, pendingSpin: get().pendingSpin }, dayKey());
    return !s.freeUsed && !s.pendingSpin;
  },
  rewardedLeft: () => {
    const s = rollover({ day: get().day, freeUsed: get().freeUsed, rewardedUsed: get().rewardedUsed, pendingSpin: get().pendingSpin }, dayKey());
    return s.pendingSpin ? 0 : ECONOMY.wheel.maxRewardedSpins - s.rewardedUsed;
  },
  spin: (viaRewarded) => {
    const res = spinWheel(
      { day: get().day, freeUsed: get().freeUsed, rewardedUsed: get().rewardedUsed, pendingSpin: get().pendingSpin },
      dayKey(),
      viaRewarded,
      (Date.now() & 0xffffffff) >>> 0,
    );
    if ('error' in res) return null;
    setJSON(KEYS.wheel, res.state);
    set(res.state);
    return { effectId: res.effectId, value: res.value, sector: res.sector };
  },
  claimPending: (effectId) => {
    if (!effectId || get().pendingSpin?.effectId !== effectId) return false;
    const next = { day: get().day, freeUsed: get().freeUsed, rewardedUsed: get().rewardedUsed, pendingSpin: null };
    setJSON(KEYS.wheel, next);
    set(next);
    return true;
  },
  reset: () => {
    const s = { day: null, freeUsed: false, rewardedUsed: 0, pendingSpin: null };
    setJSON(KEYS.wheel, s);
    set(s);
  },
}));
