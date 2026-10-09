import { getIntroLevel } from '@/features/onboarding/introPack';
import type { Level } from '../types';

import released from '../../../../assets/levels/world1.json';

import { applyHint, isIntroFreeLetterLevel, selectOnboardingLevelFiveCell } from '../hints';
import { isLevelComplete, submitWord } from '../play';
import { cellKey, initPlayState } from '../types';

const level = getIntroLevel(5)!;

test('level-five letter favors the most progressed unsolved target, deterministically', () => {
  const start = initPlayState(level);
  expect(selectOnboardingLevelFiveCell(start)).toEqual(level.answers[0].cells[0]);
  expect(selectOnboardingLevelFiveCell(start)).toEqual(level.answers[0].cells[0]);

  const progressed = {
    ...start,
    filled: Object.fromEntries(level.answers[level.answers.length - 1].cells.slice(0, -1)
      .map((cell) => [cellKey(cell), cell.ch])),
  };
  const choice = selectOnboardingLevelFiveCell(progressed);
  const lastAnswer = level.answers[level.answers.length - 1];
  expect(choice).toEqual(lastAnswer.cells[lastAnswer.cells.length - 1]);
  expect(Object.keys(progressed.filled)).toHaveLength(lastAnswer.cells.length - 1);
});

test('a free intro letter reveals one cell without counting a word or completing the level', () => {
  const start = initPlayState(level);
  const lastAnswer = level.answers[level.answers.length - 1];
  const progressed = { ...start, filled: Object.fromEntries(lastAnswer.cells.slice(0, -1)
    .map((cell) => [cellKey(cell), cell.ch])) };
  const target = selectOnboardingLevelFiveCell(progressed)!;
  const { state, result } = applyHint(progressed, 'bulb', target);
  expect(result.revealed).toEqual([target]);
  expect(state.filled[cellKey(target)]).toBe(target.ch);
  expect(state.solvedWords).toEqual([]);
  expect(result.levelComplete).toBe(false);

  const allButOne = Object.fromEntries(
    level.grid.cells.filter((cell) => cellKey(cell) !== cellKey(target))
      .map((cell) => [cellKey(cell), cell.ch]),
  );
  const final = applyHint({ ...start, filled: allButOne }, 'bulb', target);
  expect(final.result.levelComplete).toBe(false);
  expect(final.state.solvedWords).toEqual([]);
  expect(selectOnboardingLevelFiveCell(final.state)).toBeNull();
});

test('selector is unavailable for other puzzles and already solved answers', () => {
  expect(selectOnboardingLevelFiveCell(initPlayState(getIntroLevel(4)!))).toBeNull();
  expect(selectOnboardingLevelFiveCell({
    ...initPlayState(level),
    solvedWords: level.answers.map((answer) => answer.word),
  })).toBeNull();
  expect(selectOnboardingLevelFiveCell({
    ...initPlayState(level),
    level: { ...level, fingerprint: 'other-revision' },
  })).toBeNull();
});

test.each([1, 2, 3, 4, 5])('intro level %i requires entered target words after free letters', (id) => {
  const intro = getIntroLevel(id)!;
  expect(isIntroFreeLetterLevel(intro)).toBe(true);
  let state = initPlayState(intro);
  let revealedCount = 0;
  while (true) {
    const applied = applyHint(state, 'bulb');
    if (!applied.result.changed) break;
    state = applied.state;
    revealedCount += 1;
    expect(applied.result.levelComplete).toBe(false);
    expect(state.solvedWords).toEqual([]);
  }
  expect(revealedCount).toBe(intro.grid.cells.length);
  expect(isLevelComplete(state)).toBe(false);

  for (const [index, answer] of intro.answers.entries()) {
    const submission = submitWord(state, answer.word);
    expect(submission.result.kind).toBe('grid');
    if (submission.result.kind === 'grid') {
      expect(submission.result.levelComplete).toBe(index === intro.answers.length - 1);
    }
    state = submission.state;
  }
  expect(isLevelComplete(state)).toBe(true);
});

test('released campaign and daily content keep their existing automatic hint completion', () => {
  const old = released.levels[1] as Level;
  expect(isIntroFreeLetterLevel(old)).toBe(false);
  let state = initPlayState(old);
  let last = applyHint(state, 'bulb');
  while (last.result.changed) {
    state = last.state;
    last = applyHint(state, 'bulb');
  }
  expect(last.result.levelComplete).toBe(true);
  expect(state.solvedWords).toEqual(old.answers.map((answer) => answer.word));

  const dailyCopy = { ...getIntroLevel(2)!, world: 'daily' };
  expect(isIntroFreeLetterLevel(dailyCopy)).toBe(false);
  expect(isIntroFreeLetterLevel({
    ...getIntroLevel(2)!, id: 21, globalId: 21, fingerprint: undefined,
  })).toBe(false);
});
