import { Cell, cellKey, HintType, PlayState } from './types';

function revealShortestAnswer(state: PlayState): { state: PlayState; revealed: Cell[] } {
  const ans = state.level.answers
    .filter((a) => !state.solvedWords.includes(a.word))
    .sort((x, y) => x.word.length - y.word.length)[0];
  if (!ans) return { state, revealed: [] };
  const filled = { ...state.filled };
  for (const c of ans.cells) filled[cellKey(c)] = c.ch;
  return {
    state: { ...state, filled, solvedWords: [...state.solvedWords, ans.word] },
    revealed: ans.cells,
  };
}

/** bulb — открыть одну клетку; hammer/revealWord — открыть слово (спека 03/06). */
export function applyHint(
  state: PlayState,
  hint: HintType,
  target?: Cell,
): { state: PlayState; revealed: Cell[] } {
  const isFilled = (c: Cell) => state.filled[cellKey(c)] === c.ch;
  if (hint === 'revealWord' || hint === 'hammer') return revealShortestAnswer(state);
  const cell =
    target && !isFilled(target) ? target : state.level.grid.cells.find((c) => !isFilled(c));
  if (!cell) return { state, revealed: [] };
  return {
    state: { ...state, filled: { ...state.filled, [cellKey(cell)]: cell.ch } },
    revealed: [cell],
  };
}
