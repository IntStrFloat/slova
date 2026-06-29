import type { Level } from '@/core/engine';

import { clearGameSnapshot, loadGameSnapshot } from '../persistence';
import { useGame } from '../store';

// Двухсловный уровень: «кот» не завершает уровень → снапшот незавершённый.
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

beforeEach(() => {
  clearGameSnapshot();
  useGame.setState({ play: null, level: null, coins: 0, disk: [], lastResult: null });
});

describe('useGame store (in-level save)', () => {
  test('submit накапливает монеты и персистит снапшот', () => {
    useGame.getState().start(level, 'normal');
    const before = loadGameSnapshot();
    expect(before?.solvedWords).toEqual([]);
    useGame.getState().submit('кот');
    expect(useGame.getState().play?.solvedWords).toContain('кот');
    expect(useGame.getState().coins).toBeGreaterThan(0);
    expect(loadGameSnapshot()?.solvedWords).toContain('кот');
  });

  test('start восстанавливает прогресс после «перезапуска»', () => {
    useGame.getState().start(level, 'normal');
    useGame.getState().submit('кот');
    const coins = useGame.getState().coins;
    // имитируем перезапуск: состояние стора сброшено, снапшот в хранилище остался
    useGame.setState({ play: null, level: null, coins: 0, disk: [] });
    useGame.getState().start(level, 'normal');
    expect(useGame.getState().play?.solvedWords).toContain('кот');
    expect(useGame.getState().coins).toBe(coins);
    expect(useGame.getState().play?.filled['0,0']).toBe('к');
  });

  test('finish очищает снапшот; следующий старт — с нуля', () => {
    useGame.getState().start(level, 'normal');
    useGame.getState().submit('кот');
    useGame.getState().finish();
    expect(loadGameSnapshot()).toBeNull();
    useGame.getState().start(level, 'normal');
    expect(useGame.getState().play?.solvedWords).toEqual([]);
    expect(useGame.getState().coins).toBe(0);
  });

  test('режим daily не пересекается со снапшотом normal', () => {
    useGame.getState().start(level, 'normal');
    useGame.getState().submit('кот');
    useGame.getState().start(level, 'daily');
    // снапшот normal не должен примениться к daily → чистый старт
    expect(useGame.getState().play?.solvedWords).toEqual([]);
  });
});
