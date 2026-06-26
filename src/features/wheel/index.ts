import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import { mulberry32 } from '@/core/engine/rng';
import { getJSON, KEYS, setJSON } from '@/core/storage';
import { dayKey } from '@/core/time';

const SECTORS = ECONOMY.wheel.sectors;

export interface WheelState {
  day: string | null;
  freeUsed: boolean;
  rewardedUsed: number;
}

function rollover(state: WheelState, today: string): WheelState {
  if (state.day === today) return state;
  return { day: today, freeUsed: false, rewardedUsed: 0 };
}

/** Чистый редьюсер: совершить вращение (free | rewarded). */
export function spinWheel(
  state: WheelState,
  today: string,
  viaRewarded: boolean,
  rngSeed: number,
): { state: WheelState; sector: number; value: number } | { state: WheelState; error: string } {
  const s = rollover(state, today);
  if (!viaRewarded) {
    if (s.freeUsed) return { state: s, error: 'no_free_spin' };
  } else if (s.rewardedUsed >= ECONOMY.wheel.maxRewardedSpins) {
    return { state: s, error: 'no_rewarded_spins' };
  }
  const sector = Math.floor(mulberry32(rngSeed)() * SECTORS.length) % SECTORS.length;
  const next: WheelState = viaRewarded
    ? { ...s, rewardedUsed: s.rewardedUsed + 1 }
    : { ...s, freeUsed: true };
  return { state: next, sector, value: SECTORS[sector] };
}

interface Store extends WheelState {
  canFree: () => boolean;
  rewardedLeft: () => number;
  spin: (viaRewarded: boolean) => { value: number; sector: number } | null;
  reset: () => void;
}

const init = getJSON<WheelState>(KEYS.wheel, { day: null, freeUsed: false, rewardedUsed: 0 });

export const useWheel = create<Store>((set, get) => ({
  ...init,
  canFree: () => {
    const s = rollover({ day: get().day, freeUsed: get().freeUsed, rewardedUsed: get().rewardedUsed }, dayKey());
    return !s.freeUsed;
  },
  rewardedLeft: () => {
    const s = rollover({ day: get().day, freeUsed: get().freeUsed, rewardedUsed: get().rewardedUsed }, dayKey());
    return ECONOMY.wheel.maxRewardedSpins - s.rewardedUsed;
  },
  spin: (viaRewarded) => {
    const res = spinWheel(
      { day: get().day, freeUsed: get().freeUsed, rewardedUsed: get().rewardedUsed },
      dayKey(),
      viaRewarded,
      (Date.now() & 0xffffffff) >>> 0,
    );
    if ('error' in res) return null;
    set(res.state);
    setJSON(KEYS.wheel, res.state);
    return { value: res.value, sector: res.sector };
  },
  reset: () => {
    const s = { day: null, freeUsed: false, rewardedUsed: 0 };
    set(s);
    setJSON(KEYS.wheel, s);
  },
}));
