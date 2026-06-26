import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import { getJSON, KEYS, setJSON } from '@/core/storage';
import { dayKey, daysBetween } from '@/core/time';

export interface DailyBonusState {
  lastDay: string | null;
  index: number; // позиция в логин-календаре (0..)
}

const CAL = ECONOMY.daily.loginCalendar;

/** Чистый редьюсер: выдать награду дня (или null, если уже получена). */
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

interface Store extends DailyBonusState {
  claim: () => { reward: number | null; day: number };
  canClaim: () => boolean;
  reset: () => void;
}

const init = getJSON<DailyBonusState>(KEYS.dailyBonus, { lastDay: null, index: -1 });

export const useDailyBonus = create<Store>((set, get) => ({
  ...init,
  canClaim: () => get().lastDay !== dayKey(),
  claim: () => {
    const res = claimLoginBonus({ lastDay: get().lastDay, index: get().index }, dayKey());
    set(res.state);
    setJSON(KEYS.dailyBonus, res.state);
    return { reward: res.reward, day: res.day };
  },
  reset: () => {
    const s = { lastDay: null, index: -1 };
    set(s);
    setJSON(KEYS.dailyBonus, s);
  },
}));
