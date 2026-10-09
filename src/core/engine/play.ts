import { GAME } from '../config/game';
import { isIntroFreeLetterLevel } from './hints';
import { canBuildFromLetters } from './letters';
import { normalizeSubmission } from './normalize';
import { Rng } from './rng';
import { Answer, Cell, cellKey, PlayState, SubmitResult } from './types';

export function isLevelComplete(state: PlayState): boolean {
  return state.level.grid.cells.every((c) => state.filled[cellKey(c)] === c.ch)
    && (!isIntroFreeLetterLevel(state.level)
      || state.level.answers.every((answer) => state.solvedWords.includes(answer.word)));
}

function fillCells(filled: Record<string, string>, cells: Cell[]): Record<string, string> {
  const next = { ...filled };
  for (const c of cells) next[cellKey(c)] = c.ch;
  return next;
}

export function submitWord(
  state: PlayState,
  raw: string,
): { state: PlayState; result: SubmitResult } {
  const normalized = normalizeSubmission(raw);
  if (!normalized.ok) {
    return { state, result: { kind: 'invalid', word: normalized.word, reason: normalized.reason } };
  }
  const { word } = normalized;
  if (!canBuildFromLetters(word, state.level.letters)) {
    return { state, result: { kind: 'invalid', word, reason: 'not_constructible' } };
  }
  const answer: Answer | undefined = state.level.answers.find((a) => a.word === word);
  if (answer) {
    if (state.solvedWords.includes(word)) {
      return { state, result: { kind: 'duplicate', word, previousKind: 'grid' } };
    }
    if (state.level.mechanic === 'ordered') {
      const fallbackOrder = [...state.level.answers]
        .sort((a, b) => a.word.length - b.word.length || a.word.localeCompare(b.word, 'ru'))
        .map((entry) => entry.word);
      const order = state.level.answerOrder?.length ? state.level.answerOrder : fallbackOrder;
      const expected = order.find((entry) => !state.solvedWords.includes(entry));
      if (expected && expected !== word) {
        return {
          state,
          result: {
            kind: 'constraint',
            word,
            reason: 'wrong_order',
            expectedLength: expected.length,
          },
        };
      }
    }
    const next: PlayState = {
      ...state,
      filled: fillCells(state.filled, answer.cells),
      solvedWords: [...state.solvedWords, word],
      coinsEarned: state.coinsEarned + GAME.coinsPerGridWord,
    };
    return {
      state: next,
      result: {
        kind: 'grid',
        word,
        cells: answer.cells,
        deltaCoins: GAME.coinsPerGridWord,
        levelComplete: isLevelComplete(next),
      },
    };
  }
  const bundledBlock = state.level.blockedPool?.find((entry) => entry.word === word);
  if (bundledBlock) return { state, result: { kind: 'blocked', word, reason: bundledBlock.reason } };
  if (state.level.remoteDeny?.includes(word)) {
    return { state, result: { kind: 'blocked', word, reason: 'manual_deny' } };
  }

  const acceptedBonus = state.level.acceptedBonus ?? state.level.bonusPool ?? [];
  const remoteAllowed = state.level.remoteAllow?.includes(word) ?? false;
  const accepted = remoteAllowed || acceptedBonus.includes(word);
  if (accepted) {
    if (state.foundBonus.includes(word)) {
      return { state, result: { kind: 'duplicate', word, previousKind: 'bonus' } };
    }
    const rewardPool = state.level.rewardedBonus ?? state.level.bonusPool ?? acceptedBonus;
    const rewardedBefore = state.foundBonus.filter((found) => rewardPool.includes(found)).length;
    const rewarded = !remoteAllowed || state.level.rewardedBonus?.includes(word) === true;
    const withinBudget = rewardedBefore * GAME.coinsPerBonusWord < GAME.maxBonusCoinsPerLevel;
    const deltaCoins = rewarded && withinBudget ? GAME.coinsPerBonusWord : 0;
    const next: PlayState = {
      ...state,
      foundBonus: [...state.foundBonus, word],
      coinsEarned: state.coinsEarned + deltaCoins,
    };
    return {
      state: next,
      result: { kind: 'bonus', word, deltaCoins, rewarded: deltaCoins > 0, firstTime: true },
    };
  }
  return { state, result: { kind: 'invalid', word, reason: 'not_in_dictionary' } };
}

/** Перестановка букв диска (без изменения мультимножества). */
export function shuffle(letters: string[], rng: Rng): string[] {
  const a = [...letters];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (a.every((letter, index) => letter === letters[index])) {
    const different = a.findIndex((letter) => letter !== a[0]);
    if (different > 0) [a[0], a[different]] = [a[different], a[0]];
  }
  return a;
}
