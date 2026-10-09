import { initPlayState } from '@/core/engine/types';
import { submitWord } from '@/core/engine/play';
import { validateLevel } from '@/core/engine/validate';
import { KEYS, storage } from '@/core/storage';

import {
  INTRO_PACK_ASSIGNMENT_KEY,
  INTRO_PACK_VERSION,
  assignIntroPackForCurrentProfile,
  getIntroLevel,
  getAssignedIntroVersion,
  hasIntroPackAssignment,
  isVerifiedIntroLevel,
} from '../introPack';
import {
  readIntroGuidance,
  recordIntroAutoDemo,
  recordIntroTargetAccepted,
  recordIntroValidInput,
  setIntroGuidanceEnabled,
} from '../introGuide';
import { advanceSelection } from '../gestureSelection';

beforeEach(() => storage.clearAll());

test('pins the curated route only to a genuinely new profile', () => {
  expect(assignIntroPackForCurrentProfile()).toBe(true);
  expect(hasIntroPackAssignment()).toBe(true);
  expect(storage.getString(INTRO_PACK_ASSIGNMENT_KEY)).toBe(INTRO_PACK_VERSION);
  expect(assignIntroPackForCurrentProfile()).toBe(true);

  storage.clearAll();
  storage.set(KEYS.levelsProgress, JSON.stringify({ currentLevel: 1, completed: [] }));
  expect(assignIntroPackForCurrentProfile()).toBe(false);
  expect(hasIntroPackAssignment()).toBe(false);

  storage.clearAll();
  storage.set(KEYS.onboardingDone, 'true');
  expect(assignIntroPackForCurrentProfile()).toBe(false);
  expect(hasIntroPackAssignment()).toBe(false);
});

test('five fixed levels validate and accept either first answer order', () => {
  const levels = [1, 2, 3, 4, 5].map((id) => getIntroLevel(id)!);
  expect(levels.every((level) => validateLevel(level).ok)).toBe(true);
  expect(getIntroLevel(0)).toBeNull();
  expect(getIntroLevel(6)).toBeNull();
  expect(levels.map((level) => level.answers.map((answer) => answer.word))).toEqual([
    ['кот', 'ток'],
    ['сон', 'нос'],
    ['дело', 'лед'],
    ['рост', 'рот', 'трос'],
    ['клуб', 'лук', 'куб'],
  ]);
  expect(levels[4].milestone).toBe('landmark');

  let state = initPlayState(levels[0]);
  const first = submitWord(state, 'ток');
  expect(first.result.kind).toBe('grid');
  state = first.state;
  expect(submitWord(state, 'кот').result).toMatchObject({ kind: 'grid', levelComplete: true });
});

test('recognizes the old assignment without restarting onboarding and verifies content', () => {
  storage.set(INTRO_PACK_ASSIGNMENT_KEY, 'intro-v1');
  expect(hasIntroPackAssignment()).toBe(true);
  expect(getAssignedIntroVersion()).toBe('intro-v1');
  expect(assignIntroPackForCurrentProfile()).toBe(true);
  expect(storage.getString(INTRO_PACK_ASSIGNMENT_KEY)).toBe('intro-v1');
  const level = getIntroLevel(5)!;
  expect(level.contentVersion).toBe('intro-v2');
  expect(isVerifiedIntroLevel(level)).toBe(true);
  expect(isVerifiedIntroLevel({ ...level, answers: level.answers.slice(0, 1) })).toBe(false);
  expect(isVerifiedIntroLevel({ ...level, contentVersion: 'intro-v1' })).toBe(false);
  storage.set(INTRO_PACK_ASSIGNMENT_KEY, 'unrecognized');
  expect(getAssignedIntroVersion()).toBeNull();
});

test('level four has a real, one-time bonus word outside its target grid', () => {
  const level = getIntroLevel(4)!;
  expect(level.answers.some((answer) => answer.word === 'сорт')).toBe(false);
  expect(level.rewardedBonus).toContain('сорт');
  const first = submitWord(initPlayState(level), 'сорт');
  expect(first.result).toMatchObject({ kind: 'bonus', firstTime: true });
  expect(submitWord(first.state, 'сорт').result).toMatchObject({ kind: 'duplicate', previousKind: 'bonus' });
});

test('guide opt-out and automatic display cap survive reloads', () => {
  expect(readIntroGuidance()).toMatchObject({ guidanceEnabled: true, autoDemoCount: 0 });
  expect(recordIntroAutoDemo().autoDemoCount).toBe(1);
  expect(recordIntroAutoDemo().autoDemoCount).toBe(2);
  expect(recordIntroAutoDemo().autoDemoCount).toBe(2);
  expect(setIntroGuidanceEnabled(false).guidanceEnabled).toBe(false);
  expect(readIntroGuidance()).toMatchObject({ guidanceEnabled: false, autoDemoCount: 2 });
  expect(recordIntroAutoDemo().autoDemoCount).toBe(2);
  expect(setIntroGuidanceEnabled(true).guidanceEnabled).toBe(true);
  expect(recordIntroValidInput().firstValidInput).toBe(true);
  expect(recordIntroTargetAccepted().firstTargetAccepted).toBe(true);
  expect(recordIntroAutoDemo().autoDemoCount).toBe(2);
});

test('the same tile cannot repeat; the immediately previous tile backtracks', () => {
  expect(advanceSelection([0, 1, 2], 1)).toEqual([0, 1]);
  expect(advanceSelection([0, 1, 2], 0)).toEqual([0, 1, 2]);
  expect(advanceSelection([0, 1], 1)).toEqual([0, 1]);
  expect(advanceSelection([0, 1], 2)).toEqual([0, 1, 2]);
  expect(advanceSelection([0, 1], -1)).toEqual([0, 1]);
});
