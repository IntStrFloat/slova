import { initPlayState, isLevelComplete, submitWord, validateLevel, type Level } from '@/core/engine';
import { restoreGame, serializeGame } from '@/features/game/persistence';

import { loadReleasedGlobalLevel } from '../loader';

function verifyCrossword(level: Level): void {
  const occupied = new Map<string, string>();
  for (const cell of level.grid.cells) {
    const key = `${cell.row},${cell.col}`;
    expect(occupied.has(key)).toBe(false);
    expect(cell.row).toBeGreaterThanOrEqual(0);
    expect(cell.row).toBeLessThan(level.grid.rows);
    expect(cell.col).toBeGreaterThanOrEqual(0);
    expect(cell.col).toBeLessThan(level.grid.cols);
    occupied.set(key, cell.ch);
  }
  const covered = new Set<string>();
  const connected = new Set<number>([0]);
  const paths = level.answers.map((answer) => {
    const start = answer.cells[0];
    return new Set(answer.cells.map((cell, index) => {
      expect(cell.row).toBe(start.row + (answer.dir === 'V' ? index : 0));
      expect(cell.col).toBe(start.col + (answer.dir === 'H' ? index : 0));
      const key = `${cell.row},${cell.col}`;
      expect(occupied.get(key)).toBe(answer.word[index]);
      covered.add(key);
      return key;
    }));
  });
  // Every answer must connect to the same crossword through matching cells.
  for (let pass = 0; pass < paths.length; pass += 1) {
    paths.forEach((path, index) => {
      if ([...connected].some((other) => [...path].some((key) => paths[other].has(key)))) {
        connected.add(index);
      }
    });
  }
  expect(connected.size).toBe(paths.length);
  expect(covered).toEqual(new Set(occupied.keys()));
}

describe('each third-route puzzle is playable and resumable', () => {
  test.each(Array.from({ length: 500 }, (_, index) => index + 1001))('level %i', (globalId) => {
    const level = loadReleasedGlobalLevel(globalId)!;
    expect(level).not.toBeNull();
    expect(level.globalId).toBe(globalId);
    expect(validateLevel(level)).toEqual({ ok: true });
    expect(level.letters).toHaveLength(8);
    expect(level.grid.rows).toBeLessThanOrEqual(9);
    expect(level.grid.cols).toBeLessThanOrEqual(10);
    verifyCrossword(level);

    let play = initPlayState(level);
    const order = level.answerOrder ?? level.answers.map((answer) => answer.word);
    if (level.mechanic === 'ordered') {
      expect(submitWord(play, order[1]).result.kind).toBe('constraint');
    }
    for (const entry of level.blockedPool ?? []) {
      expect(submitWord(play, entry.word).result).toMatchObject({ kind: 'blocked', reason: entry.reason });
    }
    for (const word of level.acceptedBonus ?? []) {
      const next = submitWord(play, word);
      expect(next.result.kind).toBe('bonus');
      play = next.state;
      expect(submitWord(play, word).result.kind).toBe('duplicate');
    }
    if (level.mechanic === 'bonus_chest') {
      expect(play.foundBonus.filter((word) => level.rewardedBonus?.includes(word)).length)
        .toBeGreaterThanOrEqual(level.bonusTarget!);
    }

    const first = submitWord(play, order[0]);
    expect(first.result.kind).toBe('grid');
    play = first.state;
    const snapshot = serializeGame(level, play, [...level.letters].reverse(), 'normal');
    const restored = restoreGame(level, 'normal', JSON.parse(JSON.stringify(snapshot)));
    expect(restored).not.toBeNull();
    expect(restored!.play).toEqual(play);
    expect(restored!.disk).toEqual([...level.letters].reverse());
    play = restored!.play;
    for (const word of order.slice(1)) {
      const next = submitWord(play, word);
      expect(next.result.kind).toBe('grid');
      play = next.state;
    }
    expect(isLevelComplete(play)).toBe(true);
    expect(play.solvedWords).toEqual(order);
    expect(submitWord(play, order[0]).result.kind).toBe('duplicate');
    const completed = serializeGame(level, play, level.letters, 'normal', {
      status: 'completion_pending', completionId: `route3-test:${globalId}`,
    }, snapshot);
    const resumed = restoreGame(level, 'normal', completed);
    expect(resumed).not.toBeNull();
    expect(isLevelComplete(resumed!.play)).toBe(true);
  });
});
