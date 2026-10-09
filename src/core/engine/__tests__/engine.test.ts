import { applyHint } from '../hints';
import { canBuildFromLetters } from '../letters';
import { normalizeSubmission, normalizeWord } from '../normalize';
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
  test('NFC, нижний регистр и ё→е без склейки повреждённого token', () => {
    expect(normalizeWord('Ёлка')).toBe('елка');
    expect(normalizeSubmission('к-о.т')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(normalizeSubmission('ко')).toMatchObject({ ok: false, reason: 'too_short' });
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
      expect(result.deltaCoins).toBe(0);
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
    if (result.kind === 'bonus') expect(result.deltaCoins).toBe(0);
    expect(isLevelComplete(state)).toBe(false);
  });

  test('невалидное слово — invalid, без изменений', () => {
    const { state, result } = submitWord(initPlayState(level), 'тт');
    expect(result.kind).toBe('invalid');
    expect(state.coinsEarned).toBe(0);
  });
});

describe('ordered level mechanic', () => {
  const orderedLevel: Level = {
    id: 120,
    globalId: 120,
    world: 'world2',
    letters: ['к', 'о', 'т', 'р'],
    grid: {
      rows: 2,
      cols: 4,
      cells: [
        { row: 0, col: 0, ch: 'к' },
        { row: 0, col: 1, ch: 'о' },
        { row: 0, col: 2, ch: 'т' },
        { row: 1, col: 0, ch: 'к' },
        { row: 1, col: 1, ch: 'р' },
        { row: 1, col: 2, ch: 'о' },
        { row: 1, col: 3, ch: 'т' },
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
        word: 'крот',
        dir: 'H',
        cells: [
          { row: 1, col: 0, ch: 'к' },
          { row: 1, col: 1, ch: 'р' },
          { row: 1, col: 2, ch: 'о' },
          { row: 1, col: 3, ch: 'т' },
        ],
      },
    ],
    bonusPool: [],
    acceptedBonus: [],
    difficulty: 3,
    mechanic: 'ordered',
    answerOrder: ['кот', 'крот'],
  };

  test('requires the configured mandatory-word order', () => {
    const blocked = submitWord(initPlayState(orderedLevel), 'крот');
    expect(blocked.result).toEqual({
      kind: 'constraint',
      word: 'крот',
      reason: 'wrong_order',
      expectedLength: 3,
    });
    expect(blocked.state.solvedWords).toEqual([]);

    const first = submitWord(blocked.state, 'кот');
    expect(first.result.kind).toBe('grid');
    const second = submitWord(first.state, 'крот');
    expect(second.result.kind).toBe('grid');
    expect(second.state.solvedWords).toEqual(['кот', 'крот']);
  });
});

describe('shuffle', () => {
  test('детерминирован по seed и сохраняет мультимножество', () => {
    const a = shuffle(['к', 'о', 'т'], mulberry32(42));
    const b = shuffle(['к', 'о', 'т'], mulberry32(42));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(['к', 'о', 'т'].sort());
  });
  test('меняет порядок при любой перестановке, если буквы различаются', () => {
    expect(shuffle(['к', 'о', 'т'], () => 0.999)).not.toEqual(['к', 'о', 'т']);
    expect(shuffle(['о', 'о', 'н'], () => 0.999)).not.toEqual(['о', 'о', 'н']);
    expect(shuffle(['о', 'о', 'о'], () => 0.999)).toEqual(['о', 'о', 'о']);
  });
});

describe('applyHint', () => {
  test('bulb открывает одну клетку', () => {
    const { state, result } = applyHint(initPlayState(level), 'bulb');
    const { revealed } = result;
    expect(revealed).toHaveLength(1);
    expect(state.filled[cellKey(revealed[0])]).toBe(revealed[0].ch);
  });
  test('revealWord открывает слово и метит solved', () => {
    const { state, result } = applyHint(initPlayState(level), 'revealWord');
    const { revealed } = result;
    expect(revealed).toHaveLength(3);
    expect(state.solvedWords).toContain('кот');
  });
  test('hint последней клетки завершает уровень', () => {
    const started = initPlayState(level);
    started.filled = { '0,0': 'к', '0,1': 'о' };
    const { result } = applyHint(started, 'bulb');
    expect(result.levelComplete).toBe(true);
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
