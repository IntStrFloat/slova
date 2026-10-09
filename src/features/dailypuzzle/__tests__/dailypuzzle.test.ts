import { initPlayState, validateLevel } from '@/core/engine';
import { getJSON, getString, KEYS, storage } from '@/core/storage';
import { clearGameSnapshot, loadGameSnapshot, saveGameSnapshot, serializeGame } from '@/features/game/persistence';
import { loadReleasedGlobalLevel, loadVerifiedReleasedGlobalLevel } from '@/features/levels/loader';
import legacyEarlyLevels from '../../../../assets/content/legacy-early-levels.json';

import { dailySchedule, selectDailyContent, type DailyVariant } from '../content';
import { completePuzzle, loadDailyPuzzle, migrateDailyPuzzle, recoverDailyPuzzle, tomeProgressFor, useDailyPuzzle } from '../index';

describe('verified offline daily content', () => {
  test.each<DailyVariant>(['starter', 'standard'])('%s has fourteen vetted, deterministic dates', (variant) => {
    const schedule = dailySchedule('2026-09-26', variant);
    expect(schedule).toHaveLength(14);
    expect(schedule.every((entry) => entry.available)).toBe(true);
    expect(new Set(schedule.map((entry) => entry.puzzleId)).size).toBe(14);
    for (const entry of schedule) {
      const first = selectDailyContent(entry.dateKey, variant);
      const second = selectDailyContent(entry.dateKey, variant);
      expect(first?.puzzleId).toBe(entry.puzzleId);
      expect(second?.level).toEqual(first?.level);
      expect(first?.level && validateLevel(first.level).ok).toBe(true);
      expect(first?.level.mechanic).toBe('classic');
      expect(first?.level.milestone).toBeNull();
    }
    expect(selectDailyContent('invalid', variant)).toBeNull();
  });

  test('starter variant is easier and has a distinct identity from standard', () => {
    const starter = selectDailyContent('2026-09-26', 'starter')!;
    const standard = selectDailyContent('2026-09-26', 'standard')!;
    expect(starter.puzzleId).not.toBe(standard.puzzleId);
    expect(starter.level.letters).toHaveLength(4);
    expect(standard.level.letters).toHaveLength(5);
  });

  test('changed campaign grids cannot replace a fingerprint-pinned daily template', () => {
    const entries = dailySchedule('2026-09-26', 'starter');
    const daily = entries.map((entry) => selectDailyContent(entry.dateKey, 'starter')!)
      .find((content) => content.level.globalId === 8)!;
    const archived = legacyEarlyLevels.campaign[7];
    expect(daily.level).toEqual(archived);
    expect(daily.level.fingerprint).not.toBe(loadReleasedGlobalLevel(8)!.fingerprint);
    expect(loadVerifiedReleasedGlobalLevel(8, 'changed-fingerprint')).toBeNull();
  });
});

describe('daily puzzle ledger', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-25T20:59:00Z'));
    useDailyPuzzle.getState().reset();
    clearGameSnapshot('daily');
  });

  afterEach(() => jest.useRealTimers());

  test('pins first variant and content, restores the same date, and never opens a past unstarted date', () => {
    const store = useDailyPuzzle.getState();
    const first = store.getOrStartDaily(undefined, 'starter')!;
    expect(first.dateKey).toBe('2026-06-25');
    const repeat = useDailyPuzzle.getState().getOrStartDaily('2026-06-25', 'standard')!;
    expect(repeat).toEqual(first);
    expect(repeat.variantId).toBe('starter');

    jest.setSystemTime(new Date('2026-06-25T21:01:00Z'));
    expect(useDailyPuzzle.getState().getOrStartDaily('2026-06-24')).toBeNull();
    expect(useDailyPuzzle.getState().getOrStartDaily('2026-06-27')).toBeNull();
    expect(useDailyPuzzle.getState().getOrStartDaily('2026-06-25')).toEqual(first);
  });

  test('yesterday remains playable and earns yesterday only, while today can start independently', () => {
    const yesterday = useDailyPuzzle.getState().getOrStartDaily()!;
    jest.setSystemTime(new Date('2026-06-25T21:01:00Z'));
    expect(useDailyPuzzle.getState().pendingOlder()?.puzzleId).toBe(yesterday.puzzleId);
    const today = useDailyPuzzle.getState().getOrStartDaily(undefined, 'standard')!;
    expect(today.dateKey).toBe('2026-06-26');
    expect(today.puzzleId).not.toBe(yesterday.puzzleId);

    const result = useDailyPuzzle.getState().completeDaily(yesterday.dateKey);
    expect(result).toMatchObject({ reward: 10, firstCompletion: true, solvedCount: 1, completedAtDay: '2026-06-26' });
    expect(useDailyPuzzle.getState().isDone('2026-06-25')).toBe(true);
    expect(useDailyPuzzle.getState().isDone('2026-06-26')).toBe(false);
    expect(useDailyPuzzle.getState().pendingOlder()).toBeNull();
    expect(useDailyPuzzle.getState().instances['2026-06-25'].completedAtDay).toBe('2026-06-26');

    expect(useDailyPuzzle.getState().completeDaily(today.dateKey).reward).toBe(10);
    expect(useDailyPuzzle.getState().ownedDates()).toEqual(['2026-06-25', '2026-06-26']);
  });

  test('repeat completion and missing instance never issue another reward or collection mark', () => {
    expect(useDailyPuzzle.getState().completeDaily('2026-06-25').reward).toBe(0);
    const instance = useDailyPuzzle.getState().getOrStartDaily()!;
    expect(useDailyPuzzle.getState().completeDaily(instance.dateKey).reward).toBe(10);
    const repeat = useDailyPuzzle.getState().completeDaily(instance.dateKey);
    expect(repeat).toMatchObject({ reward: 0, firstCompletion: false, solvedCount: 1 });
    expect(useDailyPuzzle.getState().solvedDates).toEqual(['2026-06-25']);
    const saved = getJSON(KEYS.dailyPuzzle, null);
    expect(migrateDailyPuzzle(saved).solvedDates).toEqual(['2026-06-25']);
    expect(migrateDailyPuzzle(saved).instances['2026-06-25']).toMatchObject(instance);
    expect(repeat.rewardEntitlement).toBe(10);
  });

  test('a failed MMKV write does not announce completion and a retry succeeds', () => {
    const instance = useDailyPuzzle.getState().getOrStartDaily()!;
    const before = getJSON(KEYS.dailyPuzzle, null);
    const originalSet = storage.set.bind(storage);
    const failing = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
      if (key === KEYS.dailyPuzzle) throw new Error('MMKV write failed');
      originalSet(key, value);
    });
    try {
      const failed = useDailyPuzzle.getState().completeDaily(instance.dateKey);
      expect(failed).toMatchObject({ reward: 0, rewardEntitlement: 0, firstCompletion: false });
      expect(useDailyPuzzle.getState().solvedDates).toEqual([]);
      expect(getJSON(KEYS.dailyPuzzle, null)).toEqual(before);
      expect(getJSON(KEYS.dailyPuzzleBackup, null)).toEqual(before);
    } finally {
      failing.mockRestore();
    }
    expect(useDailyPuzzle.getState().completeDaily(instance.dateKey)).toMatchObject({ reward: 10, firstCompletion: true });
    expect(useDailyPuzzle.getState().solvedDates).toEqual([instance.dateKey]);
  });

  test('a device clock rollback cannot assign another puzzle date', () => {
    useDailyPuzzle.getState().getOrStartDaily();
    jest.setSystemTime(new Date('2026-06-25T21:01:00Z'));
    const forward = useDailyPuzzle.getState().getOrStartDaily()!;
    jest.setSystemTime(new Date('2026-06-25T20:59:00Z'));
    expect(useDailyPuzzle.getState().effectiveDay()).toBe('2026-06-26');
    expect(useDailyPuzzle.getState().getOrStartDaily()).toEqual(forward);
    expect(useDailyPuzzle.getState().maxSeenDay).toBe('2026-06-26');
  });

  test('blocks a third unfinished daily until one older date is explicitly kept', () => {
    const first = useDailyPuzzle.getState().getOrStartDaily()!;
    const playing = serializeGame(first.level, initPlayState(first.level), first.level.letters, 'daily',
      { status: 'playing' }, null, [], first.dateKey);
    saveGameSnapshot('daily', playing);

    jest.setSystemTime(new Date('2026-06-25T21:01:00Z'));
    const second = useDailyPuzzle.getState().getOrStartDaily()!;
    jest.setSystemTime(new Date('2026-06-26T21:01:00Z'));
    expect(useDailyPuzzle.getState().carryCandidates().map((item) => item.dateKey)).toEqual(['2026-06-26', '2026-06-25']);
    expect(useDailyPuzzle.getState().pendingOlder()).toBeNull();
    expect(useDailyPuzzle.getState().getOrStartDaily()).toBeNull();
    expect(useDailyPuzzle.getState().getOrStartDaily(first.dateKey)).toEqual(first);
    expect(useDailyPuzzle.getState().replaceCarriedDaily('2026-06-27')).toBeNull();

    expect(useDailyPuzzle.getState().replaceCarriedDaily(second.dateKey)).toMatchObject({
      kept: second, discardedDates: ['2026-06-25'],
    });
    expect(loadGameSnapshot('daily', undefined, first.dateKey)).toBeNull();
    expect(useDailyPuzzle.getState().getOrStartDaily(first.dateKey)).toBeNull();
    expect(useDailyPuzzle.getState().pendingOlder()).toEqual(second);
    expect(useDailyPuzzle.getState().getOrStartDaily()?.dateKey).toBe('2026-06-27');
  });

  test('refuses to discard a snapshot with a pending completion reward', () => {
    const first = useDailyPuzzle.getState().getOrStartDaily()!;
    const pending = serializeGame(first.level, initPlayState(first.level), first.level.letters, 'daily',
      { status: 'completion_pending', source: 'submit' }, null, [], first.dateKey);
    saveGameSnapshot('daily', pending);
    jest.setSystemTime(new Date('2026-06-25T21:01:00Z'));
    const second = useDailyPuzzle.getState().getOrStartDaily()!;
    jest.setSystemTime(new Date('2026-06-26T21:01:00Z'));
    expect(useDailyPuzzle.getState().replaceCarriedDaily(second.dateKey)).toBeNull();
    expect(loadGameSnapshot('daily', undefined, first.dateKey)?.completion.status).toBe('completion_pending');
    expect(useDailyPuzzle.getState().carryCandidates()).toHaveLength(2);
    expect(useDailyPuzzle.getState().getOrStartDaily()).toBeNull();
  });
});

describe('daily migration and permanent collection', () => {
  test('migrates only the provable legacy completed date', () => {
    expect(migrateDailyPuzzle({ lastDoneDay: '2026-06-26', streak: 9 })).toMatchObject({
      maxSeenDay: '2026-06-26', solvedDates: ['2026-06-26'], instances: {},
    });
    expect(migrateDailyPuzzle({ lastDoneDay: 'invalid', streak: 9 }).solvedDates).toEqual([]);
  });

  test('uses previous valid backup when the current record is corrupt', () => {
    const previous = migrateDailyPuzzle({ lastDoneDay: '2026-06-26', streak: 1 });
    expect(recoverDailyPuzzle('{corrupt', JSON.stringify(previous))).toMatchObject({
      state: previous, restorePrimary: true, migratePrimary: false,
    });
    expect(recoverDailyPuzzle(JSON.stringify(previous), '{corrupt').state).toEqual(previous);

    const currentRaw = getString(KEYS.dailyPuzzle);
    const backupRaw = getString(KEYS.dailyPuzzleBackup);
    try {
      storage.set(KEYS.dailyPuzzleBackup, JSON.stringify(previous));
      storage.set(KEYS.dailyPuzzle, '{corrupt');
      expect(loadDailyPuzzle()).toEqual(previous);
      expect(getJSON(KEYS.dailyPuzzle, null)).toEqual(previous);
    } finally {
      if (currentRaw === null) storage.remove(KEYS.dailyPuzzle);
      else storage.set(KEYS.dailyPuzzle, currentRaw);
      if (backupRaw === null) storage.remove(KEYS.dailyPuzzleBackup);
      else storage.set(KEYS.dailyPuzzleBackup, backupRaw);
    }
  });

  test('pure reducer is idempotent and cannot complete an unstarted date', () => {
    const date = '2026-06-26';
    const empty = migrateDailyPuzzle(null);
    expect(completePuzzle(empty, date, date).result.reward).toBe(0);
    expect(completePuzzle(empty, date, date).result.rewardEntitlement).toBe(0);
    const content = selectDailyContent(date, 'starter')!;
    const ready = {
      ...empty,
      instances: { [date]: { dateKey: date, puzzleId: content.puzzleId, variantId: content.variantId, level: content.level, startedAt: '2026-06-26T00:00:00Z' } },
    };
    const first = completePuzzle(ready, date, '2026-06-27');
    expect(first.result.reward).toBe(10);
    expect(completePuzzle(first.state, date, '2026-06-27').result.reward).toBe(0);
    expect(completePuzzle(first.state, date, '2026-06-27').result.rewardEntitlement).toBe(10);
  });

  test('postcards accumulate at 3, 8, 15, and 22 without a monthly reset', () => {
    expect(tomeProgressFor(0)).toMatchObject({ volume: 1, inVolume: 0, postcardsUnlocked: 0, nextThreshold: 3 });
    expect(tomeProgressFor(3)).toMatchObject({ volume: 1, postcardsUnlocked: 1, nextThreshold: 8 });
    expect(tomeProgressFor(8)).toMatchObject({ volume: 1, postcardsUnlocked: 2, nextThreshold: 15 });
    expect(tomeProgressFor(15)).toMatchObject({ volume: 1, postcardsUnlocked: 3, nextThreshold: 22 });
    expect(tomeProgressFor(22)).toMatchObject({ volume: 1, postcardsUnlocked: 4, nextThreshold: null });
    expect(tomeProgressFor(23)).toMatchObject({ volume: 2, inVolume: 1, postcardsUnlocked: 0, total: 23 });
  });
});
