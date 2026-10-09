import { ECONOMY } from '@/core/config/economy';
import type { HintType } from '@/core/engine/types';
import { storage } from '@/core/storage';
import { useCurrency } from '@/features/currency';
import { useGame } from '@/features/game/store';
import { recordIntroDemoHelpUsed } from '@/features/onboarding/introGuide';
import { isFreeIntroHelpLevel } from '@/features/onboarding/onboardingHelp';

/** Стоимость подсказок в монетах (спека 06). */
export const HINT_COSTS: Record<HintType, number> = {
  bulb: ECONOMY.hints.bulb,
  hammer: ECONOMY.hints.hammer,
  revealWord: ECONOMY.hints.revealWord,
};

export function hintCost(type: HintType): number {
  return HINT_COSTS[type];
}

export const SEMANTIC_CLUE_COST = ECONOMY.hints.clue;
const INTRO_SEMANTIC_UNLOCKS_KEY = 'onboarding.semantic-clues.intro-v1';

function unlockFreeSemanticClue(id: string): void {
  const raw = storage.getString(INTRO_SEMANTIC_UNLOCKS_KEY);
  const saved = raw == null ? { version: 1, ids: [] } : JSON.parse(raw);
  if (saved?.version !== 1 || !Array.isArray(saved.ids)
    || !saved.ids.every((value: unknown) => typeof value === 'string')) {
    throw new Error('Invalid introduction clue ledger');
  }
  if (saved.ids.includes(id)) return;
  // This unlock journal records no currency grant or zero-value debit.
  storage.set(INTRO_SEMANTIC_UNLOCKS_KEY, JSON.stringify({ version: 1, ids: [...saved.ids, id] }));
}

/** Exact introductory clues unlock freely; all other clues retain the wallet ledger. */
export function purchaseSemanticClue(puzzleKey: string, revision: string, word: string): 'unlocked' | 'insufficient' {
  if (!puzzleKey || !revision || !word) return 'insufficient';
  const id = `semantic-clue:${puzzleKey}:${revision}:${word}`;
  const { play, mode, snapshot } = useGame.getState();
  if (play && snapshot && isFreeIntroHelpLevel(play.level, mode)
    && puzzleKey === `campaign:${play.level.globalId}`
    && revision === play.level.fingerprint
    && snapshot.mode === 'normal' && snapshot.levelFingerprint === revision
    && play.level.answers.some((answer) => answer.word === word)) {
    unlockFreeSemanticClue(id);
    recordIntroDemoHelpUsed(play.level.id);
    return 'unlocked';
  }
  const spent = useCurrency.getState().spendOnce(id, 'coins', SEMANTIC_CLUE_COST);
  return spent === 'insufficient' ? 'insufficient' : 'unlocked';
}
