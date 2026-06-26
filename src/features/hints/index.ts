import { ECONOMY } from '@/core/config/economy';
import type { HintType } from '@/core/engine/types';

/** Стоимость подсказок в монетах (спека 06). */
export const HINT_COSTS: Record<HintType, number> = {
  bulb: ECONOMY.hints.bulb,
  hammer: ECONOMY.hints.hammer,
  revealWord: ECONOMY.hints.revealWord,
};

export function hintCost(type: HintType): number {
  return HINT_COSTS[type];
}
