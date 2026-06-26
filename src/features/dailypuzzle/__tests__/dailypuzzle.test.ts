import { ECONOMY } from '@/core/config/economy';

import { completePuzzle, dailySeed } from '../index';

const { puzzleStreakBase: B, puzzleStreakStep: S } = ECONOMY.daily;

describe('completePuzzle', () => {
  test('первое прохождение — стрик 1', () => {
    const r = completePuzzle({ lastDoneDay: null, streak: 0 }, '2026-06-26');
    expect(r.streak).toBe(1);
    expect(r.reward).toBe(B);
  });
  test('повтор в тот же день — без награды', () => {
    const r = completePuzzle({ lastDoneDay: '2026-06-26', streak: 1 }, '2026-06-26');
    expect(r.reward).toBe(0);
  });
  test('подряд — стрик растёт', () => {
    const r = completePuzzle({ lastDoneDay: '2026-06-25', streak: 1 }, '2026-06-26');
    expect(r.streak).toBe(2);
    expect(r.reward).toBe(B + S);
  });
  test('пропуск — стрик сброшен', () => {
    const r = completePuzzle({ lastDoneDay: '2026-06-23', streak: 5 }, '2026-06-26');
    expect(r.streak).toBe(1);
  });
  test('сид детерминирован по дате', () => {
    expect(dailySeed('2026-06-26')).toBe(20260626);
  });
});
