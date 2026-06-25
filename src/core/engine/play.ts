import { GAME } from '../config/game';
import { normalizeWord } from './normalize';
import { Rng } from './rng';
import { Answer, Cell, cellKey, PlayState, SubmitResult } from './types';

export function isLevelComplete(state: PlayState): boolean {
  return state.level.grid.cells.every((c) => state.filled[cellKey(c)] === c.ch);
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
  const word = normalizeWord(raw);
  const answer: Answer | undefined = state.level.answers.find((a) => a.word === word);
  if (answer) {
    if (state.solvedWords.includes(word)) return { state, result: { kind: 'duplicate', word } };
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
  if (state.level.bonusPool.includes(word)) {
    if (state.foundBonus.includes(word)) return { state, result: { kind: 'duplicate', word } };
    const next: PlayState = {
      ...state,
      foundBonus: [...state.foundBonus, word],
      coinsEarned: state.coinsEarned + GAME.coinsPerBonusWord,
    };
    return {
      state: next,
      result: { kind: 'bonus', word, deltaCoins: GAME.coinsPerBonusWord, firstTime: true },
    };
  }
  return { state, result: { kind: 'invalid', word } };
}

/** Перестановка букв диска (без изменения мультимножества). */
export function shuffle(letters: string[], rng: Rng): string[] {
  const a = [...letters];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
