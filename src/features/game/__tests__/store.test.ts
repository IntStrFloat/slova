import { GAME } from '@/core/config/game';
import type { Level } from '@/core/engine';

import { clearGameSnapshot, loadGameSnapshot } from '../persistence';
import { useGame } from '../store';

const level: Level = {
  id: 7,
  world: 'world1',
  letters: ['к', 'о', 'т', 'р'],
  difficulty: 1,
  grid: {
    rows: 2,
    cols: 3,
    cells: [
      { row: 0, col: 0, ch: 'к' },
      { row: 0, col: 1, ch: 'о' },
      { row: 0, col: 2, ch: 'т' },
      { row: 1, col: 0, ch: 'р' },
    ],
  },
  answers: [
    {
      word: 'кот',
      dir: 'H',
      cells: [
        { row: 0, col: 0, ch: 'к' },
        { row: 0, col: 1, ch: 'о' },
        { row: 0, col: 2, ch: 'т' },
      ],
    },
    {
      word: 'кр',
      dir: 'V',
      cells: [
        { row: 0, col: 0, ch: 'к' },
        { row: 1, col: 0, ch: 'р' },
      ],
    },
  ],
  bonusPool: ['ток'],
};

const completedLevel: Level = {
  id: 8,
  world: 'world1',
  letters: ['к', 'о', 'т'],
  difficulty: 1,
  grid: {
    rows: 1,
    cols: 3,
    cells: [
      { row: 0, col: 0, ch: 'к' },
      { row: 0, col: 1, ch: 'о' },
      { row: 0, col: 2, ch: 'т' },
    ],
  },
  answers: [
    {
      word: 'кот',
      dir: 'H',
      cells: [
        { row: 0, col: 0, ch: 'к' },
        { row: 0, col: 1, ch: 'о' },
        { row: 0, col: 2, ch: 'т' },
      ],
    },
  ],
  bonusPool: ['ток'],
};

function resetStore(): void {
  useGame.setState({
    play: null,
    level: null,
    mode: 'normal',
    coins: 0,
    disk: [],
    lastResult: null,
    completion: { status: 'playing' },
    snapshot: null,
    hintsUsed: [],
  });
}

beforeEach(() => {
  clearGameSnapshot('normal');
  clearGameSnapshot('daily');
  resetStore();
});

describe('useGame store', () => {
  test('submit persists the word without directly minting coins', () => {
    useGame.getState().start(level, 'normal');
    const before = loadGameSnapshot();
    expect(before?.solvedWords).toEqual([]);

    useGame.getState().submit('кот');

    expect(useGame.getState().play?.solvedWords).toContain('кот');
    expect(useGame.getState().coins).toBe(0);
    expect(loadGameSnapshot()?.solvedWords).toContain('кот');
  });

  test('start restores progress after restart', () => {
    useGame.getState().start(level, 'normal');
    useGame.getState().submit('кот');
    const coins = useGame.getState().coins;

    resetStore();
    useGame.getState().start(level, 'normal');

    expect(useGame.getState().play?.solvedWords).toContain('кот');
    expect(useGame.getState().coins).toBe(coins);
    expect(useGame.getState().play?.filled['0,0']).toBe('к');
  });

  test('finish clears snapshot and the next start is fresh', () => {
    useGame.getState().start(level, 'normal');
    useGame.getState().submit('кот');

    useGame.getState().finish();

    expect(loadGameSnapshot()).toBeNull();

    useGame.getState().start(level, 'normal');
    expect(useGame.getState().play?.solvedWords).toEqual([]);
    expect(useGame.getState().coins).toBe(0);
  });

  test('daily mode does not reuse normal snapshot', () => {
    useGame.getState().start(level, 'normal');
    useGame.getState().submit('кот');

    useGame.getState().start(level, 'daily');

    expect(useGame.getState().play?.solvedWords).toEqual([]);
  });

  test('completion pending gets a live completionId and keeps clear bonus after restore', () => {
    useGame.getState().start(completedLevel, 'normal');
    const result = useGame.getState().submit('кот');

    expect(result.kind).toBe('grid');
    if (result.kind !== 'grid') return;

    const liveState = useGame.getState();
    expect(liveState.completion.status).toBe('completion_pending');
    expect(liveState.completion.completionId).toBeTruthy();
    expect(liveState.claimCompletion()).toBe(liveState.completion.completionId);
    expect(liveState.coins).toBe(GAME.coinsPerGridWord + GAME.levelClearBonus);
    expect(loadGameSnapshot()?.coinsEarned).toBe(liveState.coins);

    const completionId = liveState.completion.completionId;

    resetStore();
    useGame.getState().start(completedLevel, 'normal');

    expect(useGame.getState().coins).toBe(GAME.coinsPerGridWord + GAME.levelClearBonus);
    expect(useGame.getState().completion.status).toBe('completion_pending');
    expect(useGame.getState().completion.completionId).toBe(completionId);
  });
});
