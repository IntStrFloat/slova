import { initPlayState, submitWord, type Level } from '@/core/engine';

import { clearGameSnapshot, loadGameSnapshot, restoreGame, saveGameSnapshot, serializeGame, type GameSnapshot } from '../persistence';
import { KEYS, setString } from '@/core/storage';

const level: Level = {
  id: 1,
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

// Двухсловный уровень, чтобы получить незавершённый снапшот.
const level2: Level = {
  id: 2,
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
  bonusPool: [],
};

describe('serializeGame/restoreGame', () => {
  test('round-trip незавершённого уровня восстанавливает прогресс', () => {
    const { state } = submitWord(initPlayState(level2), 'кот');
    const snap = serializeGame(level2, state, ['т', 'к', 'о', 'р'], 'normal');
    const restored = restoreGame(level2, 'normal', snap);
    expect(restored).not.toBeNull();
    expect(restored!.play.solvedWords).toEqual(['кот']);
    expect(restored!.play.filled['0,0']).toBe('к');
    expect(restored!.disk).toEqual(['т', 'к', 'о', 'р']);
  });

  test('completed-but-unclaimed snapshot восстанавливается для claim', () => {
    const { state } = submitWord(initPlayState(level), 'кот');
    const snap = serializeGame(level, state, level.letters, 'normal');
    expect(restoreGame(level, 'normal', snap)?.play.filled).toEqual(state.filled);
  });

  test('несовпадение уровня/режима/версии → null', () => {
    const snap = serializeGame(level2, initPlayState(level2), level2.letters, 'normal');
    expect(restoreGame(level, 'normal', snap)).toBeNull(); // другой levelId
    expect(restoreGame(level2, 'daily', snap)).toBeNull(); // другой режим
    expect(restoreGame(level2, 'normal', { ...snap, version: 999 })).toBeNull();
    expect(restoreGame(level2, 'normal', null)).toBeNull();
  });

  test('мусорные клетки и чужие слова отбрасываются', () => {
    const base = serializeGame(level2, initPlayState(level2), level2.letters, 'normal');
    const snap: GameSnapshot = {
      ...base,
      filled: { '0,0': 'к', '9,9': 'я', '0,1': 'я' },
      solvedWords: ['кот', 'чужое'],
      foundBonus: ['нет'],
      coinsEarned: 5,
      disk: ['к', 'о', 'т', 'р'],
    };
    const restored = restoreGame(level2, 'normal', snap);
    expect(restored).not.toBeNull();
    expect(restored!.play.filled).toEqual({ '0,0': 'к' }); // 9,9 нет в сетке; 0,1 буква неверна
    expect(restored!.play.solvedWords).toEqual(['кот']);
    expect(restored!.play.foundBonus).toEqual([]);
  });

  test('повреждённый диск заменяется буквами уровня', () => {
    const snap = serializeGame(level2, initPlayState(level2), ['x', 'y'], 'normal');
    const restored = restoreGame(level2, 'normal', snap);
    expect(restored!.disk).toEqual(level2.letters);
  });

  test('daily keeps a carried puzzle alongside today and clears only its own date', () => {
    clearGameSnapshot('daily');
    const yesterday = serializeGame(level, initPlayState(level), level.letters, 'daily', { status: 'playing' }, null, [], '2026-09-25');
    const today = serializeGame(level2, initPlayState(level2), level2.letters, 'daily', { status: 'playing' }, null, [], '2026-09-26');
    saveGameSnapshot('daily', yesterday);
    saveGameSnapshot('daily', today);

    expect(loadGameSnapshot('daily', level, '2026-09-25')?.attemptId).toBe(yesterday.attemptId);
    expect(loadGameSnapshot('daily', level2, '2026-09-26')?.attemptId).toBe(today.attemptId);
    clearGameSnapshot('daily', '2026-09-26');
    expect(loadGameSnapshot('daily', level2, '2026-09-26')).toBeNull();
    expect(loadGameSnapshot('daily', level, '2026-09-25')).not.toBeNull();
    clearGameSnapshot('daily');
  });

  test('restores the last good normal snapshot if the newest write is corrupt', () => {
    clearGameSnapshot('normal');
    const first = serializeGame(level, initPlayState(level), level.letters, 'normal');
    saveGameSnapshot('normal', first);
    const second = serializeGame(level, initPlayState(level), level.letters, 'normal', { status: 'playing' }, first);
    saveGameSnapshot('normal', second);
    setString(KEYS.gameCurrentNormal, '{broken');
    expect(loadGameSnapshot('normal', level)?.revision).toBe(first.revision);
    clearGameSnapshot('normal');
  });
});
