import { applyHint } from '../hints';
import { canBuildFromLetters } from '../letters';
import { normalizeWord } from '../normalize';
import { isLevelComplete, shuffle, submitWord } from '../play';
import { mulberry32 } from '../rng';
import { cellKey, initPlayState, Level } from '../types';
import { validateLevel } from '../validate';

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

describe('normalize', () => {
  test('нижний регистр + ё→е + убрать не-кириллицу', () => {
    expect(normalizeWord(' Ёлка ')).toBe('елка');
    expect(normalizeWord('к-о.т')).toBe('кот');
  });
});

describe('letters', () => {
  test('собирается из мультимножества', () => {
    expect(canBuildFromLetters('кот', ['к', 'о', 'т', 'м'])).toBe(true);
    expect(canBuildFromLetters('кок', ['к', 'о', 'т'])).toBe(false);
  });
});

describe('submitWord', () => {
  test('grid-слово заполняет сетку и завершает уровень', () => {
    const { state, result } = submitWord(initPlayState(level), 'КОТ');
    expect(result.kind).toBe('grid');
    if (result.kind === 'grid') {
      expect(result.levelComplete).toBe(true);
      expect(result.deltaCoins).toBe(5);
    }
    expect(isLevelComplete(state)).toBe(true);
  });

  test('повтор grid-слова — duplicate', () => {
    const s1 = submitWord(initPlayState(level), 'кот').state;
    expect(submitWord(s1, 'кот').result.kind).toBe('duplicate');
  });

  test('бонусное слово — bonus, не завершает', () => {
    const { state, result } = submitWord(initPlayState(level), 'ток');
    expect(result.kind).toBe('bonus');
    if (result.kind === 'bonus') expect(result.deltaCoins).toBe(2);
    expect(isLevelComplete(state)).toBe(false);
  });

  test('невалидное слово — invalid, без изменений', () => {
    const { state, result } = submitWord(initPlayState(level), 'тт');
    expect(result.kind).toBe('invalid');
    expect(state.coinsEarned).toBe(0);
  });
});

describe('shuffle', () => {
  test('детерминирован по seed и сохраняет мультимножество', () => {
    const a = shuffle(['к', 'о', 'т'], mulberry32(42));
    const b = shuffle(['к', 'о', 'т'], mulberry32(42));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(['к', 'о', 'т'].sort());
  });
});

describe('applyHint', () => {
  test('bulb открывает одну клетку', () => {
    const { state, revealed } = applyHint(initPlayState(level), 'bulb');
    expect(revealed).toHaveLength(1);
    expect(state.filled[cellKey(revealed[0])]).toBe(revealed[0].ch);
  });
  test('revealWord открывает слово и метит solved', () => {
    const { state, revealed } = applyHint(initPlayState(level), 'revealWord');
    expect(revealed).toHaveLength(3);
    expect(state.solvedWords).toContain('кот');
  });
});

describe('validateLevel', () => {
  test('валидный уровень', () => {
    expect(validateLevel(level).ok).toBe(true);
  });
  test('висячая клетка → ошибка', () => {
    const bad: Level = {
      ...level,
      grid: { rows: 1, cols: 4, cells: [...level.grid.cells, { row: 0, col: 3, ch: 'м' }] },
    };
    expect(validateLevel(bad).ok).toBe(false);
  });
});
