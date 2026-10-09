/* eslint-disable @typescript-eslint/no-require-imports */
import type { Level } from '@/core/engine/types';
import { initPlayState } from '@/core/engine/types';
import { submitWord } from '@/core/engine/play';
import { validateLevel } from '@/core/engine/validate';
import { storage } from '@/core/storage';
import { clearGameSnapshot, restoreGame, saveGameSnapshot, serializeGame } from '@/features/game/persistence';
import { INTRO_PACK_ASSIGNMENT_KEY, isVerifiedIntroLevel } from '@/features/onboarding/introPack';
import legacyEarlyLevels from '../../../../assets/content/legacy-early-levels.json';
import preservedPacks from '../../../../assets/content/preserved-packs.json';
import world1 from '../../../../assets/levels/world1.json';

import { loadGlobalLevel, loadReleasedGlobalLevel } from '../loader';

const { EARLY_ROUTE_POLICY, generateWorld, loadDicts, levelFingerprintPayload } = require('../../../../scripts/gen-levels');
const { canonicalHash } = require('../../../../scripts/dict/content');

beforeEach(() => storage.clearAll());

test('both new-profile onboarding and campaign routes avoid repeating a letter and answer set in the first ten', () => {
  const signature = (level: Level) => JSON.stringify([
    [...level.letters].sort(), level.answers.map((answer) => answer.word).sort(),
  ]);
  const campaign = Array.from({ length: 10 }, (_, index) => loadReleasedGlobalLevel(index + 1)!);
  expect(new Set(campaign.map(signature)).size).toBe(10);
  storage.set(INTRO_PACK_ASSIGNMENT_KEY, 'intro-v2');
  const onboardingRoute = Array.from({ length: 10 }, (_, index) => loadGlobalLevel(index + 1)!);
  expect(new Set(onboardingRoute.map(signature)).size).toBe(10);
});

test('the first ten require only short common-word grids, including L5 → L6', () => {
  const common = new Set(loadDicts().commonEntries.map((entry: { w: string }) => entry.w));
  const answerCounts = [];
  for (let id = 1; id <= 10; id += 1) {
    const level = loadReleasedGlobalLevel(id)!;
    answerCounts.push(level.answers.length);
    expect(validateLevel(level).ok).toBe(true);
    expect(level.mechanic).toBe('classic');
    expect(level.bonusTarget).toBeUndefined();
    expect(level.answers.every((answer) => common.has(answer.word))).toBe(true);
    expect(level.answers.some((answer) => ['бук', 'лот'].includes(answer.word))).toBe(false);
    expect(level.fingerprint).toBe(canonicalHash(levelFingerprintPayload(level)));
    let state = initPlayState(level);
    for (const answer of level.answers) {
      const next = submitWord(state, answer.word);
      state = next.state;
      expect(next.result.kind).toBe('grid');
      if (answer === level.answers[level.answers.length - 1]) {
        expect(next.result).toMatchObject({ levelComplete: true });
      }
    }
    expect(state.foundBonus).toEqual([]);
  }
  expect(answerCounts).toEqual([2, 2, 2, 3, 3, 3, 3, 3, 3, 3]);
  expect(loadReleasedGlobalLevel(5)!.letters.length).toBe(loadReleasedGlobalLevel(6)!.letters.length);
});

test('regeneration reproduces the deliberately curated first ten rather than old difficulty waves', () => {
  const generated = generateWorld({
    world: 'world1', count: 30, globalOffset: 0, dicts: loadDicts(),
    usedBases: new Set(), contentVersion: world1.contentVersion,
  }).levels as Level[];
  expect(generated.slice(0, 10)).toEqual(world1.levels.slice(0, 10));
  expect(generated[12].answers.map((answer) => answer.word).sort()).toEqual(['рост', 'сорт', 'трос']);
  for (const level of generated.slice(0, 10)) {
    expect([...level.answers.map((answer) => answer.word)].sort())
      .toEqual([...EARLY_ROUTE_POLICY.levels[level.id].answers].sort());
  }
});

test('all released campaign levels after ten remain identical to the pre-change baseline', () => {
  expect(canonicalHash(world1.levels.slice(10)))
    .toBe(preservedPacks.intendedRevisions['world1.json'].unchangedLevelsSha256);
});

test('partially solved old campaign content resumes with the same puzzle and attempt', () => {
  const old = legacyEarlyLevels.campaign[1] as unknown as Level;
  const next = submitWord(initPlayState(old), old.answers[0].word);
  const snapshot = serializeGame(old, next.state, old.letters, 'normal');
  saveGameSnapshot('normal', snapshot);
  const resumed = loadGlobalLevel(2)!;
  expect(resumed).toEqual(old);
  const restored = restoreGame(resumed, 'normal', snapshot)!;
  expect(restored.play.solvedWords).toEqual([old.answers[0].word]);
  expect(restored.snapshot.attemptId).toBe(snapshot.attemptId);
  clearGameSnapshot('normal');
  expect(loadGlobalLevel(2)!.answers.map((answer) => answer.word)).toEqual(['кот', 'ток']);
});

test.each(['playing', 'completion_pending', 'reward_claimed'] as const)(
  'the previous L9 preserves a saved %s attempt across the duplicate correction', (status) => {
    storage.set(INTRO_PACK_ASSIGNMENT_KEY, 'intro-v2');
    const old = legacyEarlyLevels.campaign.find((level) => level.globalId === 9
      && level.contentVersion.startsWith('retention-early-v2')) as unknown as Level;
    expect(old).toBeDefined();
    let state = submitWord(initPlayState(old), 'рост').state;
    if (status !== 'playing') {
      for (const answer of old.answers) state = submitWord(state, answer.word).state;
    }
    const snapshot = serializeGame(old, state, old.letters, 'normal', { status });
    saveGameSnapshot('normal', snapshot);
    const resumed = loadGlobalLevel(9)!;
    expect(resumed).toEqual(old);
    expect(restoreGame(resumed, 'normal', snapshot)?.snapshot.attemptId).toBe(snapshot.attemptId);
    expect(restoreGame(resumed, 'normal', snapshot)?.play.solvedWords).toEqual(state.solvedWords);
    clearGameSnapshot('normal');
    expect(loadGlobalLevel(9)?.answers.map((answer) => answer.word).sort()).toEqual(['карп', 'парк', 'рак']);
  },
);

test('pending old intro victory is pinned, while the next level uses revised content', () => {
  storage.set(INTRO_PACK_ASSIGNMENT_KEY, 'intro-v1');
  const old = legacyEarlyLevels.intro[4] as unknown as Level;
  let state = initPlayState(old);
  for (const answer of old.answers) state = submitWord(state, answer.word).state;
  const snapshot = serializeGame(old, state, old.letters, 'normal', {
    status: 'completion_pending', source: 'submit', completedAt: '2026-10-02T15:00:00.000Z',
  });
  saveGameSnapshot('normal', snapshot);
  expect(loadGlobalLevel(5)).toEqual(old);
  expect(isVerifiedIntroLevel(loadGlobalLevel(5)!)).toBe(true);
  expect(restoreGame(old, 'normal', snapshot)?.snapshot.completion).toEqual(snapshot.completion);
  expect(loadGlobalLevel(6)?.contentVersion).toBe(world1.contentVersion);
  clearGameSnapshot('normal');
  expect(loadGlobalLevel(5)!.answers.map((answer) => answer.word)).toEqual(['клуб', 'лук', 'куб']);
});

test.each(['levelFingerprint', 'contentVersion', 'world', 'globalLevel', 'levelId'] as const)(
  'a mismatched saved %s cannot select legacy content', (field) => {
    const old = legacyEarlyLevels.campaign[1] as unknown as Level;
    const snapshot = serializeGame(old, initPlayState(old), old.letters, 'normal');
    saveGameSnapshot('normal', { ...snapshot, [field]: field === 'globalLevel' || field === 'levelId' ? 99 : 'corrupt' });
    expect(loadGlobalLevel(2)?.contentVersion).toBe(world1.contentVersion);
  },
);

test('a malformed saved completion or filled record cannot select legacy content', () => {
  const old = legacyEarlyLevels.campaign[1] as unknown as Level;
  const snapshot = serializeGame(old, initPlayState(old), old.letters, 'normal');
  for (const broken of [
    { ...snapshot, completion: { status: 'invalid' } },
    { ...snapshot, filled: [] },
    { ...snapshot, attemptId: '' },
  ]) {
    saveGameSnapshot('normal', broken as unknown as typeof snapshot);
    expect(loadGlobalLevel(2)?.contentVersion).toBe(world1.contentVersion);
  }
});
