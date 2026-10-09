import type { Level } from '@/core/engine/types';

import released from '../../../../assets/levels/world1.json';
import legacy from '../../../../assets/content/legacy-early-levels.json';
import { storage } from '@/core/storage';
import { firstUnsolvedIntroWord, isFreeIntroHelpLevel } from '../onboardingHelp';
import { assignIntroPackForCurrentProfile, getIntroLevel } from '../introPack';

beforeEach(() => storage.clearAll());

test('manual demo follows the first remaining target without applying progress', () => {
  const level = getIntroLevel(1)!;
  const before = JSON.stringify(level);
  expect(firstUnsolvedIntroWord(level, [])).toBe('кот');
  expect(firstUnsolvedIntroWord(level, ['кот'])).toBe('ток');
  expect(firstUnsolvedIntroWord(level, ['ток'])).toBe('кот');
  expect(firstUnsolvedIntroWord(level, ['кот', 'ток'])).toBeNull();
  expect(JSON.stringify(level)).toBe(before);
});

test('manual intro path is unavailable for the released route or changed content', () => {
  expect(firstUnsolvedIntroWord(released.levels[0] as Level, [])).toBeNull();
  expect(firstUnsolvedIntroWord(getIntroLevel(2)!, [])).toBeNull();
  expect(firstUnsolvedIntroWord({ ...getIntroLevel(1)!, fingerprint: 'changed' }, [])).toBeNull();
});

test('free help requires an assigned profile and an exact introduction puzzle in normal mode', () => {
  const second = getIntroLevel(2)!;
  expect(isFreeIntroHelpLevel(second, 'normal')).toBe(false);
  expect(assignIntroPackForCurrentProfile()).toBe(true);
  for (const id of [1, 2, 3, 4, 5]) expect(isFreeIntroHelpLevel(getIntroLevel(id), 'normal')).toBe(true);
  expect(isFreeIntroHelpLevel(second, 'daily')).toBe(false);
  expect(isFreeIntroHelpLevel(null, 'normal')).toBe(false);
  expect(isFreeIntroHelpLevel({ ...second, fingerprint: 'foreign' }, 'normal')).toBe(false);
  expect(isFreeIntroHelpLevel({ ...second, grid: { ...second.grid, cells: [] } }, 'normal')).toBe(false);
  expect(isFreeIntroHelpLevel(released.levels[1] as Level, 'normal')).toBe(false);
  expect(isFreeIntroHelpLevel(getIntroLevel(6), 'normal')).toBe(false);
});

test('genuine already-started intro-v1 puzzles keep free assistance', () => {
  assignIntroPackForCurrentProfile();
  for (const level of legacy.intro) expect(isFreeIntroHelpLevel(level as Level, 'normal')).toBe(true);
});
