import type { Level } from '@/core/engine/types';
import { getIntroLevel } from '@/features/onboarding/introPack';

import world1 from '../../../../assets/levels/world1.json';
import legacyEarlyLevels from '../../../../assets/content/legacy-early-levels.json';
import { clueForUnsolved } from '../editorialClues';

const reviewedLevels: Level[] = Array.from({ length: 20 }, (_, index) => {
  const id = index + 1;
  return id <= 5 ? getIntroLevel(id)! : world1.levels[index] as Level;
});

test('every target in the first twenty reviewed levels has a semantic, non-answer clue', () => {
  let checked = 0;
  for (const level of reviewedLevels) {
    const solved: string[] = [];
    for (const answer of level.answers) {
      const result = clueForUnsolved(level, solved);
      expect(result).not.toBeNull();
      expect(result!.targetLength).toBe([...answer.word].length);
      expect(result!.clue.length).toBeGreaterThan(9);
      expect(result!.clue.length).toBeLessThan(75);
      const normalizedClue = result!.clue.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
      for (const target of level.answers) {
        expect(normalizedClue).not.toContain(target.word.replaceAll('ё', 'е'));
      }
      solved.push(answer.word);
      checked += 1;
    }
    expect(clueForUnsolved(level, solved)).toBeNull();
  }
  expect(checked).toBe(54);
});

test('does not promise a clue for unreviewed levels or content revisions', () => {
  expect(clueForUnsolved(world1.levels[0] as Level, [])).toBeNull();
  expect(clueForUnsolved(world1.levels[20] as Level, [])).toBeNull();
  expect(clueForUnsolved({ ...reviewedLevels[5], fingerprint: 'changed-content' }, [])).toBeNull();
  expect(clueForUnsolved({ ...reviewedLevels[5], world: 'daily' }, [])).toBeNull();
  expect(clueForUnsolved({ ...reviewedLevels[5], id: 7 }, [])).toBeNull();
});

test('saved older intro and reviewed campaign revisions keep their semantic clues', () => {
  const archived = [...legacyEarlyLevels.intro, ...legacyEarlyLevels.campaign.slice(5)] as unknown as Level[];
  for (const level of archived) {
    const solved: string[] = [];
    for (const answer of level.answers) {
      const clue = clueForUnsolved(level, solved);
      expect(clue?.targetLength).toBe(answer.word.length);
      expect(clue?.clue.length).toBeGreaterThan(9);
      const normalizedClue = clue!.clue.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
      for (const target of level.answers) expect(normalizedClue).not.toContain(target.word);
      solved.push(answer.word);
    }
  }
});
