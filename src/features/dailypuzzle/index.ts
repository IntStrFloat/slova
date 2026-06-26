import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import { getJSON, KEYS, setJSON } from '@/core/storage';
import { dayKey, daysBetween } from '@/core/time';

export interface DailyPuzzleState {
  lastDoneDay: string | null;
  streak: number;
}

/** Чистый редьюсер: завершить пазл дня → новый стрик + награда. */
export function completePuzzle(
  state: DailyPuzzleState,
  today: string,
): { state: DailyPuzzleState; reward: number; streak: number } {
  if (state.lastDoneDay === today) return { state, reward: 0, streak: state.streak };
  const consecutive = state.lastDoneDay !== null && daysBetween(state.lastDoneDay, today) === 1;
  const streak = consecutive ? state.streak + 1 : 1;
  const reward = ECONOMY.daily.puzzleStreakBase + ECONOMY.daily.puzzleStreakStep * (streak - 1);
  return { state: { lastDoneDay: today, streak }, reward, streak };
}

/** Сид уровня пазла дня — детерминирован по дате. */
export function dailySeed(today: string = dayKey()): number {
  return Number(today.replace(/-/g, ''));
}

interface Store extends DailyPuzzleState {
  isDoneToday: () => boolean;
  complete: () => { reward: number; streak: number };
  reset: () => void;
}

const init = getJSON<DailyPuzzleState>(KEYS.dailyPuzzle, { lastDoneDay: null, streak: 0 });

export const useDailyPuzzle = create<Store>((set, get) => ({
  ...init,
  isDoneToday: () => get().lastDoneDay === dayKey(),
  complete: () => {
    const res = completePuzzle({ lastDoneDay: get().lastDoneDay, streak: get().streak }, dayKey());
    set(res.state);
    setJSON(KEYS.dailyPuzzle, res.state);
    return { reward: res.reward, streak: res.streak };
  },
  reset: () => {
    const s = { lastDoneDay: null, streak: 0 };
    set(s);
    setJSON(KEYS.dailyPuzzle, s);
  },
}));
