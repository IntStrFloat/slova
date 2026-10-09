import {
  campaignWins, compensateUnavailableQuests, ensureDay, getCompletionRewards, getFeatureGates, makeInitialSnapshot,
  productDayAt, reduceCompletion, reduceWord, sanitizeCompletionEffects,
  type RetentionSnapshot,
} from '../model';
import {
  getCollectibles, getDailyCollectionStatus, getEventStatus, getJourneyStatus,
  getQuestStatus, getWeeklyStatus,
} from '../selectors';
import { RETENTION } from '@/core/config/retention';
import { hasUnavailablePinnedContent } from '../availability';

function ms(day: string): number {
  return Date.parse(`${day}T12:00:00+03:00`);
}

function complete(
  state: RetentionSnapshot,
  key: string,
  day = '2026-09-26',
  mode: 'campaign' | 'daily' = 'campaign',
  puzzleDay?: string,
) {
  return reduceCompletion(state, {
    mode, puzzleKey: key, puzzleDay, actionDay: day, completedAtMs: ms(day),
  });
}

function word(index: number): string {
  const alphabet = 'абвгдежзийклмнопрстуфхцчшщыэюя';
  return `а${alphabet[Math.floor(index / alphabet.length)]}${alphabet[index % alphabet.length]}`;
}

test('fresh and migrated snapshots preserve the correct starter grant and old wins', () => {
  const fresh = makeInitialSnapshot({ newProfile: true });
  expect(fresh.tickets).toBe(0);
  expect(fresh.pendingCoinGrants['starter:hint-coins']).toBe(100);
  expect(campaignWins(fresh)).toBe(0);
  const migrated = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 2] });
  expect(migrated.tickets).toBe(0);
  expect(campaignWins(migrated)).toBe(2);
  expect(migrated.journeyBaselineCompleted).toBe(2);
  expect(complete(migrated, '2').accepted).toBe(false);
});

test('every promised postcard resolves an existing travel image', () => {
  const cards = getCollectibles(makeInitialSnapshot({ newProfile: true }));
  expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
  expect(cards.length).toBeGreaterThan(20);
  expect(cards.every((card) => card.image !== undefined)).toBe(true);
});

test('five unique campaign wins unlock the first postcard and week without replay farming', () => {
  let state = makeInitialSnapshot({ newProfile: true });
  for (let level = 1; level <= 5; level++) {
    const result = complete(state, String(level));
    expect(result.effects.find((effect) => effect.id === `campaign:${level}:complete`)).toBeUndefined();
    state = result.snapshot;
  }
  expect(getFeatureGates(state).daily).toBe(true);
  expect(getJourneyStatus(state).completedAfterAnchor).toBe(5);
  expect(state.ownedCollectibles['journey-1-1']).toBeDefined();
  expect(getWeeklyStatus(state, '2026-09-26')?.activeCount).toBe(1);
  expect(complete(state, '5').accepted).toBe(false);
  expect(state.pendingCoinGrants['campaign:5:complete']).toBeUndefined();
});

test('bonus bank carries remainder and awards three finite coin grants for 9 plus 23 units', () => {
  let state = makeInitialSnapshot({ newProfile: true });
  for (let index = 0; index < 32; index++) {
    const result = reduceWord(state, {
      mode: 'campaign', puzzleKey: '1', word: word(index),
      actionDay: '2026-09-26', bonus: true, manual: true,
    });
    expect(result.accepted).toBe(true);
    state = result.snapshot;
  }
  expect(state.bonusBankUnits).toBe(2);
  expect(state.tickets).toBe(0);
  expect(Object.keys(state.rewardGrants).filter((key) => key.startsWith('bonus-bank:'))).toHaveLength(3);
  expect(Object.values(state.rewardGrants).filter((grant) => grant.source === 'bonus-bank')
    .map((grant) => grant.amount)).toEqual([50, 50, 50]);
  expect(reduceWord(state, {
    mode: 'campaign', puzzleKey: '1', word: word(0), actionDay: '2026-09-26', bonus: true, manual: true,
  }).accepted).toBe(false);
});

test('bonus coins and bank coin grant remain visible on a later completion replay', () => {
  let state = makeInitialSnapshot({ newProfile: true });
  for (let index = 0; index < 10; index++) {
    state = reduceWord(state, {
      mode: 'campaign', puzzleKey: '1', word: word(index), actionDay: '2026-09-26',
      bonus: true, manual: true,
    }).snapshot;
  }
  const first = complete(state, '1');
  expect(first.effects.filter((grant) => grant.source === 'bonus')).toHaveLength(10);
  expect(first.effects.find((grant) => grant.source === 'bonus-bank')).toMatchObject({ kind: 'coins', amount: 50 });
  expect(first.effects.find((grant) => grant.id === 'campaign:1:complete')).toBeUndefined();
  expect(complete(first.snapshot, '1').effects).toEqual(first.effects);
});

test('carried daily awards its puzzle date once without marking today solved', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5] });
  const result = complete(state, 'variant-a', '2026-09-27', 'daily', '2026-09-26');
  state = result.snapshot;
  expect(result.effects.find((effect) => effect.id === 'daily:2026-09-26:complete')?.amount).toBe(10);
  expect(state.todayDailyByActionDay['2026-09-27']).toBeUndefined();
  expect(getDailyCollectionStatus(state).completedDays).toBe(1);
  expect(complete(state, 'variant-b', '2026-09-28', 'daily', '2026-09-26').accepted).toBe(false);
});

test('daily volume remains complete at 22 and rolls to the next volume on 23', () => {
  const days = Array.from({ length: 22 }, (_, index) =>
    new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10));
  const completeVolume = makeInitialSnapshot({ newProfile: false, legacyDailyDays: days });
  expect(getDailyCollectionStatus(completeVolume).volumeIndex).toBe(0);
  expect(getDailyCollectionStatus(completeVolume).progressInVolume).toBe(22);
  const next = complete(completeVolume, '2026-09-23', '2026-09-23', 'daily').snapshot;
  expect(getDailyCollectionStatus(next).volumeIndex).toBe(1);
  expect(getDailyCollectionStatus(next).progressInVolume).toBe(1);
});

test('personal week starts on Sunday and awards 2/4/5 with two missed days', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5] });
  const activeDays = ['2026-09-27', '2026-09-29', '2026-09-30', '2026-10-02', '2026-10-03'];
  let level = 6;
  for (const day of activeDays) {
    state = complete(state, String(level++), day).snapshot;
    state = complete(state, String(level++), day).snapshot;
  }
  const status = getWeeklyStatus(state, '2026-10-03');
  expect(status?.startDay).toBe('2026-09-27');
  expect(status?.endDay).toBe('2026-10-04');
  expect(status?.activeCount).toBe(5);
  expect(status?.claimedTiers).toEqual([2, 4, 5]);
  expect(state.rewardGrants['week:2026-09-27:2']?.amount).toBe(10);
  expect(state.rewardGrants['week:2026-09-27:4']).toMatchObject({ kind: 'coins', amount: 50 });
  expect(state.ownedCollectibles[status!.postcardId!]).toBeDefined();
});

test('an already created week keeps its seven-day window when future config changes', () => {
  const base = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5] });
  const state = ensureDay(base, { actionDay: '2026-09-27' });
  const mutable = RETENTION.week as { durationDays: number };
  const original = mutable.durationDays;
  try {
    mutable.durationDays = 3;
    expect(getWeeklyStatus(state, '2026-10-03')?.startDay).toBe('2026-09-27');
    expect(getWeeklyStatus(state, '2026-10-03')?.endDay).toBe('2026-10-04');
  } finally {
    mutable.durationDays = original;
  }
});

test('quest targets are pinned and overlapping bonus words advance both relevant goals', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5, 6, 7, 8] });
  state = ensureDay(state, { actionDay: '2026-09-26', remainingNewPuzzles: 3, availableManualWords: 10, availableBonusWords: 2 });
  for (let index = 0; index < 10; index++) {
    state = reduceWord(state, {
      mode: 'campaign', puzzleKey: '9', word: word(index), actionDay: '2026-09-26',
      bonus: index < 2, manual: true,
    }).snapshot;
  }
  for (const key of ['9', '10', '11']) state = complete(state, key).snapshot;
  const status = getQuestStatus(state, '2026-09-26');
  expect(status?.quests.map((quest) => quest.progress)).toEqual([3, 10, 2]);
  expect(status?.allCompleted).toBe(true);
  expect(Object.values(state.rewardGrants).filter((grant) => grant.source === 'quest').reduce((sum, grant) => sum + (grant.amount ?? 0), 0)).toBe(25);
});

test('word-earned quest is included in first result and replay without another grant', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5, 6, 7, 8] });
  state = ensureDay(state, { actionDay: '2026-09-26', remainingNewPuzzles: 3, availableManualWords: 10, availableBonusWords: 2 });
  for (let index = 0; index < 10; index++) {
    state = reduceWord(state, {
      mode: 'campaign', puzzleKey: '9', word: word(index),
      actionDay: '2026-09-26', bonus: false, manual: true,
    }).snapshot;
  }
  expect(state.puzzleEffectIds['campaign:9']).toEqual(['quest:2026-09-26:words']);
  const first = complete(state, '9');
  expect(first.effects.map((grant) => grant.id)).toEqual([
    'quest:2026-09-26:words',
  ]);
  expect(first.effects.filter((grant) => grant.kind === 'coins').reduce((sum, grant) => sum + (grant.amount ?? 0), 0)).toBe(5);
  expect(first.snapshot.puzzleEffectIds['campaign:9']).toBeUndefined();
  expect(first.snapshot.completionEffectIds['campaign:9']).toEqual(first.effects.map((grant) => grant.id));
  const restored = JSON.parse(JSON.stringify(first.snapshot)) as RetentionSnapshot;
  expect(getCompletionRewards(restored, 'campaign', '9')).toEqual(first.effects);
  const replay = complete(restored, '9');
  expect(replay.accepted).toBe(false);
  expect(replay.effects).toEqual(first.effects);
  expect(replay.snapshot).toBe(restored);
});

test('old v1 journals recover only effects that can be safely tied to a puzzle', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5, 6, 7, 8] });
  for (let index = 0; index < 10; index++) {
    state = reduceWord(state, {
      mode: 'campaign', puzzleKey: '9', word: word(index),
      actionDay: '2026-09-26', bonus: index === 0, manual: true,
    }).snapshot;
  }
  state = complete(state, '9').snapshot;
  const old = JSON.parse(JSON.stringify(state)) as RetentionSnapshot;
  old.rewardGrants['campaign:9:complete'] = {
    id: 'campaign:9:complete', kind: 'coins', amount: 5, source: 'campaign',
  };
  old.pendingCoinGrants['campaign:9:complete'] = 5;
  delete (old as Partial<RetentionSnapshot>).puzzleEffectIds;
  delete (old as Partial<RetentionSnapshot>).completionEffectIds;
  const migrated = sanitizeCompletionEffects(old);
  const ids = complete(migrated, '9').effects.map((grant) => grant.id);
  expect(ids).toContain('bonus:campaign:9:ааа');
  expect(ids).toContain('campaign:9:complete');
  // The prior journal has no puzzle identity for a manual-word quest grant.
  expect(ids).not.toContain('quest:2026-09-26:words');
  const earlyIndexed = { ...old, completionEffectIds: { 'campaign:9': ['campaign:9:complete'] } } as RetentionSnapshot;
  expect(getCompletionRewards(sanitizeCompletionEffects(earlyIndexed), 'campaign', '9').map((grant) => grant.id))
    .toContain('bonus:campaign:9:ааа');
});

test('quest fallback is pinned and no completion quest is offered with zero new puzzles', () => {
  const base = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5, 6, 7, 8] });
  expect(getQuestStatus(ensureDay(base, { actionDay: '2026-09-26' }), '2026-09-26')).toBeNull();
  expect(getQuestStatus(ensureDay(base, { actionDay: '2026-09-26', remainingNewPuzzles: 0 }), '2026-09-26')).toBeNull();
  const state = ensureDay(base, {
    actionDay: '2026-09-26', remainingNewPuzzles: 1,
    availableBonusWords: 0, availableManualWords: 10,
  });
  expect(getQuestStatus(state, '2026-09-26')?.quests.map((quest) => quest.kind)).toEqual([
    'manualWords', 'manualWords', 'manualWords',
  ]);
  expect(getQuestStatus(ensureDay(state, { actionDay: '2026-09-26', remainingNewPuzzles: 9, availableBonusWords: 9 }), '2026-09-26')?.quests).toEqual(getQuestStatus(state, '2026-09-26')?.quests);
});

test('using hints cannot turn unchanged pinned content into quest compensation', () => {
  const day = '2026-09-26';
  const proof = [{ puzzleKey: 'campaign:9', fingerprint: 'verified-grid' }];
  const pinned = ensureDay(
    makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5, 6, 7, 8] }),
    { actionDay: day, remainingNewPuzzles: 3, availableManualWords: 10, availableBonusWords: 2, contentProof: proof },
  );
  const afterHint = { actionDay: day, remainingNewPuzzles: 3, availableManualWords: 0, availableBonusWords: 0, contentProof: proof };
  const invalidated = hasUnavailablePinnedContent(proof, afterHint.contentProof, pinned);
  expect(invalidated).toBe(false);
  expect(compensateUnavailableQuests(pinned, afterHint, invalidated).accepted).toBe(false);
  expect(pinned.pendingCoinGrants).toEqual({});
});

test('event awards only first-time campaign/today-daily actions in half-open period', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: Array.from({ length: 14 }, (_, i) => i + 1) });
  for (let i = 15; i < 30; i++) state = complete(state, String(i), '2026-09-26').snapshot;
  for (let i = 0; i < 5; i++) {
    const day = `2026-09-${String(26 + i).padStart(2, '0')}`;
    state = complete(state, day, day, 'daily').snapshot;
  }
  const status = getEventStatus(state, ms('2026-09-30'));
  expect(status?.points).toBe(25);
  expect(status?.tiers.every((tier) => tier.claimed)).toBe(true);
  expect(state.rewardGrants['event:suitcase:2026-09-26:3']?.amount).toBe(10);
  expect(getEventStatus(state, Date.parse('2026-10-03T00:00:00+03:00'))).toBeNull();
  const after = complete(state, '30', '2026-10-03').snapshot;
  expect(after.eventInstances['suitcase:2026-09-26'].points).toBe(25);
});

test('fixed UTC+3 day is independent from phone timezone', () => {
  expect(productDayAt(Date.parse('2026-09-25T21:00:00.000Z'))).toBe('2026-09-26');
  expect(productDayAt(Date.parse('2026-09-25T20:59:59.999Z'))).toBe('2026-09-25');
});

test('completion replay records earlier manual words on their original product day', () => {
  const base = ensureDay(
    makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5, 6, 7, 8] }),
    { actionDay: '2026-09-26', remainingNewPuzzles: 3, availableManualWords: 10, availableBonusWords: 2 },
  );
  const result = reduceCompletion(base, {
    mode: 'campaign', puzzleKey: '9', actionDay: '2026-09-27', completedAtMs: ms('2026-09-27'),
    acceptedWords: [{ word: 'кот', bonus: false, manual: true, actionDay: '2026-09-26' }],
  });
  expect(result.accepted).toBe(true);
  expect(getQuestStatus(result.snapshot, '2026-09-26')?.quests.find((quest) => quest.id === 'words')?.progress).toBe(1);
  expect(result.snapshot.completionCountsByDay['2026-09-27']).toBe(1);
  expect(result.snapshot.manualWordKeys['campaign:9:кот']).toBeUndefined();
  expect(reduceWord(result.snapshot, {
    mode: 'campaign', puzzleKey: '9', actionDay: '2026-09-27', word: 'кот', bonus: false, manual: true,
  }).accepted).toBe(false);
});

test('five-day economy scenario earns coin grants only', () => {
  let state = makeInitialSnapshot({
    newProfile: false,
    legacyCampaignIds: Array.from({ length: 15 }, (_, index) => index + 1),
  });
  let campaignKey = 16;
  for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
    const currentDay = `2026-09-${26 + dayIndex}`;
    state = ensureDay(state, {
      actionDay: currentDay,
      remainingNewPuzzles: 100,
      availableManualWords: 10,
      availableBonusWords: 4,
    });
    const firstPuzzleKey = String(campaignKey);
    for (let index = 0; index < 10; index++) {
      state = reduceWord(state, {
        mode: 'campaign', puzzleKey: firstPuzzleKey, word: word(index),
        actionDay: currentDay, bonus: index < 4, manual: true,
      }).snapshot;
    }
    for (let index = 0; index < 3; index++) state = complete(state, String(campaignKey++), currentDay).snapshot;
    state = complete(state, currentDay, currentDay, 'daily').snapshot;
  }
  const coins = Object.values(state.rewardGrants)
    .filter((grant) => grant.kind === 'coins')
    .reduce((sum, grant) => sum + (grant.amount ?? 0), 0);
  expect(coins).toBe(415);
  expect(Object.values(state.rewardGrants).some((grant) => grant.source === 'campaign')).toBe(false);
  expect(state.tickets).toBe(0);
  expect(state.bonusBankUnits).toBe(0);
});
