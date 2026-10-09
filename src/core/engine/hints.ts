import { Cell, cellKey, HintResult, HintType, Level, PlayState } from './types';

/** Intro letters teach spelling; payment authorization belongs to the hint journal. */
export function isIntroFreeLetterLevel(level: Level): boolean {
  const expectedFingerprint = `${level.contentVersion}:${level.id}:${level.letters.join('')}:${level.answers.map((answer) => answer.word).join(',')}`;
  return level.world === 'world1'
    && Number.isInteger(level.id) && level.id >= 1 && level.id <= 5
    && level.globalId === level.id
    && (level.contentVersion === 'intro-v1' || level.contentVersion === 'intro-v2')
    && expectedFingerprint === level.fingerprint;
}

/** Highest known-letter fraction; ties keep authored answer and cell order. */
export function selectOnboardingLevelFiveCell(state: PlayState): Cell | null {
  if (!isIntroFreeLetterLevel(state.level) || state.level.id !== 5) return null;
  let best: { cell: Cell; known: number; length: number } | null = null;
  for (const answer of state.level.answers) {
    if (state.solvedWords.includes(answer.word)) continue;
    const open = answer.cells.filter((cell) => state.filled[cellKey(cell)] !== cell.ch);
    if (open.length === 0) continue;
    const known = answer.cells.length - open.length;
    if (!best || known * best.length > best.known * answer.cells.length) {
      best = { cell: open[0], known, length: answer.cells.length };
    }
  }
  return best?.cell ?? null;
}

/** Все пересечённые ответы считаются solved после любой мутации сетки. */
export function reconcileSolvedWords(state: PlayState): PlayState {
  const solved = new Set(state.solvedWords);
  for (const answer of state.level.answers) {
    if (answer.cells.every((cell) => state.filled[cellKey(cell)] === cell.ch)) solved.add(answer.word);
  }
  const solvedWords = state.level.answers.map((answer) => answer.word).filter((word) => solved.has(word));
  return solvedWords.length === state.solvedWords.length && solvedWords.every((word, i) => word === state.solvedWords[i])
    ? state
    : { ...state, solvedWords };
}

function resultFor(state: PlayState, source: HintType, revealed: Cell[]): HintResult {
  const gridComplete = state.level.grid.cells.every((cell) => state.filled[cellKey(cell)] === cell.ch);
  return {
    changed: revealed.length > 0,
    revealed,
    solvedWords: state.solvedWords,
    levelComplete: gridComplete && (!isIntroFreeLetterLevel(state.level)
      || state.level.answers.every((answer) => state.solvedWords.includes(answer.word))),
    source,
  };
}

function revealShortestAnswer(state: PlayState): { state: PlayState; revealed: Cell[] } {
  const ans = state.level.answers
    .filter((a) => !state.solvedWords.includes(a.word))
    .sort((x, y) => x.word.length - y.word.length)[0];
  if (!ans) return { state: reconcileSolvedWords(state), revealed: [] };
  const filled = { ...state.filled };
  for (const c of ans.cells) filled[cellKey(c)] = c.ch;
  return { state: reconcileSolvedWords({ ...state, filled, solvedWords: [...state.solvedWords, ans.word] }), revealed: ans.cells };
}

/** bulb — открыть одну клетку; hammer/revealWord — открыть слово (спека 03/06). */
export function applyHint(
  state: PlayState,
  hint: HintType,
  target?: Cell,
): { state: PlayState; result: HintResult } {
  const isFilled = (c: Cell) => state.filled[cellKey(c)] === c.ch;
  if (hint === 'revealWord' || hint === 'hammer') {
    const next = revealShortestAnswer(state);
    return { state: next.state, result: resultFor(next.state, hint, next.revealed) };
  }
  const cell =
    target && !isFilled(target) ? target : state.level.grid.cells.find((c) => !isFilled(c));
  if (!cell) {
    const next = isIntroFreeLetterLevel(state.level) ? state : reconcileSolvedWords(state);
    return { state: next, result: resultFor(next, hint, []) };
  }
  const withCell = { ...state, filled: { ...state.filled, [cellKey(cell)]: cell.ch } };
  if (isIntroFreeLetterLevel(state.level)) {
    // An introductory letter reveals a cell; only entering the target finds its word.
    return {
      state: withCell,
      result: { ...resultFor(withCell, hint, [cell]), levelComplete: false },
    };
  }
  const next = reconcileSolvedWords(withCell);
  return { state: next, result: resultFor(next, hint, [cell]) };
}
