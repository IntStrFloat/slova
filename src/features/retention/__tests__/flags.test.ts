import { RETENTION } from '@/core/config/retention';

import { ensureDay, getFeatureGates, makeInitialSnapshot, reduceCompletion, reduceWord } from '../model';
import { getDailyCollectionStatus, getEventStatus, getQuestStatus, getWeeklyStatus } from '../selectors';

const flags = RETENTION.featureFlags as { daily: boolean; week: boolean; quests: boolean; event: boolean };
const defaults = { ...flags };

function complete(state: ReturnType<typeof makeInitialSnapshot>, key: string, day: string, mode: 'campaign' | 'daily' = 'campaign') {
  return reduceCompletion(state, {
    mode,
    puzzleKey: key,
    actionDay: day,
    completedAtMs: Date.parse(`${day}T12:00:00+03:00`),
  });
}

afterEach(() => Object.assign(flags, defaults));

test('daily flag blocks new daily rewards but keeps prior solved dates and postcards', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5] });
  for (const day of ['2026-09-26', '2026-09-27', '2026-09-28']) {
    state = complete(state, day, day, 'daily').snapshot;
  }
  expect(state.ownedCollectibles['daily-1-1']).toBeDefined();
  flags.daily = false;
  expect(getFeatureGates(state).daily).toBe(false);
  const disabled = complete(state, '2026-09-29', '2026-09-29', 'daily');
  expect(disabled.accepted).toBe(false);
  expect(disabled.effects).toEqual([]);
  expect(disabled.snapshot).toBe(state);
  expect(reduceWord(state, {
    mode: 'daily', puzzleKey: '2026-09-29', actionDay: '2026-09-29', word: 'кот', bonus: true, manual: true,
  }).accepted).toBe(false);
  expect(getDailyCollectionStatus(state).completedDays).toBe(3);
  expect(state.ownedCollectibles['daily-1-1']).toBeDefined();
  expect(complete(state, '2026-09-28', '2026-09-28', 'daily').effects)
    .toEqual(complete(state, '2026-09-28', '2026-09-28', 'daily').effects);
});

test('week flag hides the period and excludes actions while off without blocking campaign', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5] });
  state = ensureDay(state, { actionDay: '2026-09-26' });
  state = complete(state, '6', '2026-09-26').snapshot;
  state = complete(state, '7', '2026-09-26').snapshot;
  expect(getWeeklyStatus(state, '2026-09-26')?.activeDays).toEqual(['2026-09-26']);
  flags.week = false;
  const firstOff = complete(state, '8', '2026-09-27');
  expect(firstOff.effects.find((grant) => grant.id === 'campaign:8:complete')).toBeUndefined();
  state = complete(firstOff.snapshot, '9', '2026-09-27').snapshot;
  expect(getWeeklyStatus(state, '2026-09-27')).toBeNull();
  expect(state.weekInstances['week:2026-09-26'].activeDays).toEqual(['2026-09-26']);
  expect(state.rewardGrants['week:2026-09-26:2']).toBeUndefined();
  flags.week = true;
  state = complete(state, '10', '2026-09-28').snapshot;
  state = complete(state, '11', '2026-09-28').snapshot;
  expect(getWeeklyStatus(state, '2026-09-28')?.activeDays).toEqual(['2026-09-26', '2026-09-28']);
  expect(state.rewardGrants['week:2026-09-26:2']?.amount).toBe(10);
});

test('quests flag freezes a pinned quest and leaves its prior rewards intact', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: [1, 2, 3, 4, 5, 6, 7, 8] });
  state = ensureDay(state, {
    actionDay: '2026-09-26', remainingNewPuzzles: 3, availableManualWords: 10, availableBonusWords: 2,
  });
  flags.quests = false;
  for (const word of ['кот', 'ток', 'сон']) {
    state = reduceWord(state, { mode: 'campaign', puzzleKey: '9', word, actionDay: '2026-09-26', bonus: false, manual: true }).snapshot;
  }
  state = complete(state, '9', '2026-09-26').snapshot;
  expect(getQuestStatus(state, '2026-09-26')).toBeNull();
  expect(state.questInstances['2026-09-26'].quests.every((quest) => quest.progress === 0)).toBe(true);
  expect(state.rewardGrants['campaign:9:complete']).toBeUndefined();
  expect(Object.keys(state.rewardGrants).filter((id) => id.startsWith('quest:'))).toHaveLength(0);
  flags.quests = true;
  state = reduceWord(state, {
    mode: 'campaign', puzzleKey: '10', word: 'лес', actionDay: '2026-09-26', bonus: false, manual: true,
  }).snapshot;
  expect(getQuestStatus(state, '2026-09-26')?.quests.find((quest) => quest.id === 'words')?.progress).toBe(1);
});

test('event flag stops new points and tiers while retaining already claimed rewards', () => {
  let state = makeInitialSnapshot({ newProfile: false, legacyCampaignIds: Array.from({ length: 15 }, (_, index) => index + 1) });
  for (const key of ['16', '17', '18']) state = complete(state, key, '2026-09-26').snapshot;
  expect(state.eventInstances['suitcase:2026-09-26'].points).toBe(3);
  expect(state.rewardGrants['event:suitcase:2026-09-26:3']?.amount).toBe(10);
  flags.event = false;
  const off = complete(state, '19', '2026-09-26');
  expect(off.effects.find((grant) => grant.id === 'campaign:19:complete')).toBeUndefined();
  expect(off.snapshot.eventInstances['suitcase:2026-09-26'].points).toBe(3);
  expect(getEventStatus(off.snapshot, Date.parse('2026-09-26T12:00:00+03:00'))).toBeNull();
  expect(off.snapshot.rewardGrants['event:suitcase:2026-09-26:3']?.amount).toBe(10);
});
