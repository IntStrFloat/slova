import type { Level } from '@/core/engine/types';

import { levelObjectiveProgress } from '../objectives';

const baseLevel: Level = {
  id: 80,
  globalId: 80,
  world: 'world1',
  letters: ['с', 'л', 'о', 'в', 'а'],
  grid: { rows: 1, cols: 5, cells: [] },
  answers: [{ word: 'слово', cells: [], dir: 'H' }],
  bonusPool: ['вал', 'лов'],
  rewardedBonus: ['вал', 'лов'],
  difficulty: 2,
};

test('bonus chest rewards only after the target is reached', () => {
  const level = { ...baseLevel, mechanic: 'bonus_chest' as const, bonusTarget: 2 };
  expect(levelObjectiveProgress(level, { foundBonus: 1, hintsUsed: 0, mistakes: 0, solvedWords: 0 })?.reward).toBe(0);
  expect(levelObjectiveProgress(level, { foundBonus: 2, hintsUsed: 0, mistakes: 0, solvedWords: 0 })?.reward).toBe(30);
});

test('mastery fails after a hint or invalid submission', () => {
  const level = { ...baseLevel, mechanic: 'mastery' as const };
  expect(levelObjectiveProgress(level, { foundBonus: 0, hintsUsed: 0, mistakes: 0, solvedWords: 0 })?.reward).toBe(0);
  expect(levelObjectiveProgress(level, { foundBonus: 0, hintsUsed: 0, mistakes: 0, solvedWords: 1 })?.reward).toBe(50);
  expect(levelObjectiveProgress(level, { foundBonus: 0, hintsUsed: 1, mistakes: 0, solvedWords: 0 })?.reward).toBe(0);
  expect(levelObjectiveProgress(level, { foundBonus: 0, hintsUsed: 0, mistakes: 1, solvedWords: 0 })?.failed).toBe(true);
});

test('ordered objective completes after every configured answer', () => {
  const level = { ...baseLevel, mechanic: 'ordered' as const, answerOrder: ['вал', 'слово'] };
  expect(levelObjectiveProgress(level, { foundBonus: 0, hintsUsed: 0, mistakes: 1, solvedWords: 1 })?.complete).toBe(false);
  expect(levelObjectiveProgress(level, { foundBonus: 0, hintsUsed: 0, mistakes: 1, solvedWords: 2 })?.reward).toBe(35);
});
