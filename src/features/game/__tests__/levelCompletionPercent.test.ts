import type { Level } from '@/core/engine';
import { mockLevelCompletionPercent } from '../levelCompletionPercent';

const level = { letters: ['к', 'о', 'т'], difficultyTier: 1, difficultyRole: 'baseline' } as Level;

test('higher authored difficulty lowers the mock percentage, without randomized values', () => {
  const values = ([1, 2, 3, 4, 5] as const).map((difficultyTier) => {
    const puzzle = { ...level, difficultyTier };
    const percent = mockLevelCompletionPercent(puzzle);
    expect(mockLevelCompletionPercent(puzzle)).toBe(percent);
    return percent;
  });
  expect(values[0]).toBe(95);
  expect(values[4]).toBe(35);
  expect(values.every((value, i) => i === 0 || value < values[i - 1])).toBe(true);
});

test('hard and breather roles change the mock in opposite directions within bounds', () => {
  const puzzle = { ...level, difficultyTier: 3 as const };
  expect(mockLevelCompletionPercent({ ...puzzle, difficultyRole: 'hard' })).toBeLessThan(mockLevelCompletionPercent(puzzle));
  expect(mockLevelCompletionPercent({ ...puzzle, difficultyRole: 'breather' })).toBeGreaterThan(mockLevelCompletionPercent(puzzle));
  expect(mockLevelCompletionPercent({ ...level, difficultyRole: 'easy' })).toBe(95);
  expect(mockLevelCompletionPercent({ ...level, difficultyTier: 5, difficultyRole: 'climax' })).toBe(30);
});

test('legacy content falls back to letter count and optional chest does not penalize completion', () => {
  const legacy = { ...level, difficultyTier: undefined };
  expect(mockLevelCompletionPercent(legacy)).toBe(95);
  expect(mockLevelCompletionPercent({ ...legacy, letters: ['а', 'б', 'в', 'г', 'д', 'е', 'ж'] })).toBe(35);
  expect(mockLevelCompletionPercent({ ...legacy, mechanic: 'bonus_chest', bonusTarget: 3 })).toBe(95);
});
