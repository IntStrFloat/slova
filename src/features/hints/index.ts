import { ECONOMY } from '@/core/config/economy';
import type { HintType } from '@/core/engine/types';
import { storage } from '@/core/storage';
import { type HelpAnalyticsContext, selectHelpContext } from '@/features/analytics/helpContext';
import { useCurrency } from '@/features/currency';
import type { AppliedHintPayment } from '@/features/game/hintJournal';
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
const REWARDED_SEMANTIC_UNLOCKS_KEY = 'game.semantic-clues.rewarded-v1';

function rewardedSemanticUnlocks(): string[] {
  const raw = storage.getString(REWARDED_SEMANTIC_UNLOCKS_KEY);
  const ids: unknown = raw == null ? [] : JSON.parse(raw);
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new Error('Invalid rewarded clue ledger');
  return ids;
}

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

export function isSemanticClueUnlocked(puzzleKey: string, revision: string, word: string): boolean {
  const id = `semantic-clue:${puzzleKey}:${revision}:${word}`;
  if (useCurrency.getState().hasApplied(id)) return true;
  try { if (rewardedSemanticUnlocks().includes(id)) return true; } catch { /* No unverified free unlock. */ }
  const raw = storage.getString(INTRO_SEMANTIC_UNLOCKS_KEY);
  if (!raw) return false;
  try {
    const saved = JSON.parse(raw);
    return saved?.version === 1 && Array.isArray(saved.ids) && saved.ids.includes(id);
  } catch {
    return false;
  }
}

/** Only the earned-hint entitlement owner calls this exact-origin unlock. No wallet mutation. */
export function unlockRewardedSemanticClue(puzzleKey: string, revision: string, word: string, attemptId: string): void {
  const { snapshot, play } = useGame.getState();
  if (!snapshot || !play || snapshot.attemptId !== attemptId || snapshot.levelFingerprint !== revision
    || puzzleKey !== (snapshot.mode === 'daily' ? `daily:${snapshot.dailyId}` : `campaign:${snapshot.globalLevel}`)
    || !play.level.answers.some((answer) => answer.word === word)) throw new Error('Rewarded clue origin mismatch');
  const ids = rewardedSemanticUnlocks();
  const id = `semantic-clue:${puzzleKey}:${revision}:${word}`;
  if (!ids.includes(id)) {
    const next = JSON.stringify([...ids, id]);
    storage.set(REWARDED_SEMANTIC_UNLOCKS_KEY, next);
    if (storage.getString(REWARDED_SEMANTIC_UNLOCKS_KEY) !== next) throw new Error('Rewarded clue write unconfirmed');
  }
  recordMatchingSemanticHelp(puzzleKey, revision);
}

function recordMatchingSemanticHelp(puzzleKey: string, revision: string): void {
  const { snapshot } = useGame.getState();
  if (!snapshot || snapshot.levelFingerprint !== revision
    || puzzleKey !== (snapshot.mode === 'daily' ? `daily:${snapshot.dailyId}` : `campaign:${snapshot.globalLevel}`)) return;
  useGame.getState().recordSemanticHelp(snapshot.attemptId);
}

/** Exact introductory clues unlock freely; all other clues retain the wallet ledger. */
export function purchaseSemanticClue(puzzleKey: string, revision: string, word: string, context?: HelpAnalyticsContext,
  onApplied?: (payment: AppliedHintPayment) => void): 'unlocked' | 'insufficient' {
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
    recordMatchingSemanticHelp(puzzleKey, revision);
    try {
      onApplied?.({ effectId: id, transaction: null, chargedNow: 0, context: selectHelpContext(context),
        appliedAtMs: Date.now(), timeKnown: true });
    } catch { /* An optional observer cannot change committed help. */ }
    return 'unlocked';
  }
  // Rewarded ownership is distinct from introduction ownership: the intro path
  // above must replay its own assistance classification after an interrupted save.
  if (rewardedSemanticUnlocks().includes(id)) {
    recordMatchingSemanticHelp(puzzleKey, revision);
    try { onApplied?.({ effectId: id, transaction: null, chargedNow: 0,
      context: selectHelpContext(context), appliedAtMs: Date.now(), timeKnown: true }); } catch { /* Optional observer. */ }
    return 'unlocked';
  }
  const spent = useCurrency.getState().spendOnce(id, 'coins', SEMANTIC_CLUE_COST, context);
  // A failed classification write can be retried without a second debit.
  if (spent !== 'insufficient') {
    recordMatchingSemanticHelp(puzzleKey, revision);
    try {
      const transaction = useCurrency.getState().getTransaction(id);
      onApplied?.({ effectId: id, transaction, chargedNow: spent === 'spent' ? SEMANTIC_CLUE_COST : 0,
        context: selectHelpContext(context), appliedAtMs: Date.now(), timeKnown: true });
    } catch { /* An optional observer cannot change committed help. */ }
  }
  return spent === 'insufficient' ? 'insufficient' : 'unlocked';
}
