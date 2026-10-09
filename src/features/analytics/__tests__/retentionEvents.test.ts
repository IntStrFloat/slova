import { COLLECTIBLE_CATALOG } from '@/core/config/retention';
import { makeInitialSnapshot } from '@/features/retention/model';

import { sanitizeProperties } from '../privacy';
import { observedRetentionMilestones } from '../retentionEvents';

const now = Date.parse('2026-09-26T12:00:00.000Z');

test('observes only committed weekly, quest, event and album milestones with stable keys', () => {
  const snapshot = makeInitialSnapshot({ newProfile: true });
  snapshot.weekInstances['week:2026-09-24'] = {
    periodId: 'week:2026-09-24', startDay: '2026-09-24', endDay: '2026-10-01',
    activeDays: ['2026-09-25', '2026-09-26'], postcardId: null,
    bonusTicketAtFive: true, coinsAtTwoDays: 10, ticketsAtFourDays: 1,
    postcardAtActiveDays: 5, claimedTiers: [2],
  };
  snapshot.todayDailyByActionDay['2026-09-26'] = 1;
  snapshot.questInstances['2026-09-26'] = {
    day: '2026-09-26', allRewardCoins: 10, allCompleted: false, claimedAll: false,
    quests: [{ id: 'solver', title: 'Решатель', kind: 'completions', target: 3,
      progress: 3, completed: true, rewardCoins: 5 }],
  };
  snapshot.eventInstances['suitcase:2026-09-26'] = {
    id: 'suitcase:2026-09-26', startDay: '2026-09-26', endDay: '2026-10-03', points: 3,
    tiers: [{ points: 3, kind: 'coins', amount: 10, claimed: true }],
  };
  for (const card of COLLECTIBLE_CATALOG.filter((item) => item.kind === 'journey').slice(0, 6)) {
    snapshot.ownedCollectibles[card.id] = { source: 'journey', earnedDay: '2026-09-26' };
  }

  const events = observedRetentionMilestones(snapshot, now);
  const ids = events.map(({ name, key }) => `${name}:${key}`);
  expect(ids).toContain('weekly_day_qualified:week:2026-09-24:2026-09-26');
  expect(ids).toContain('weekly_milestone_granted:week:2026-09-24:2');
  expect(ids).toContain('quest_created:2026-09-26:solver');
  expect(ids).toContain('quest_completed:2026-09-26:solver');
  expect(ids).toContain('event_eligible:suitcase:2026-09-26');
  expect(ids).toContain('event_progressed:suitcase:2026-09-26:3');
  expect(ids).toContain('event_milestone_granted:suitcase:2026-09-26:3');
  expect(ids).toContain('album_completed:journey-album:1');
  expect(events.find((event) => event.name === 'weekly_day_qualified' &&
    event.properties.dateKey === '2026-09-26')?.properties.source).toBe('daily');
  for (const event of events) expect(sanitizeProperties(event.properties)).toEqual(event.properties);
});

test('does not invent milestones from a fresh profile', () => {
  expect(observedRetentionMilestones(makeInitialSnapshot({ newProfile: true }), now)).toEqual([]);
});

test('daily completion uses committed product dates and ignores legacy migration labels', () => {
  const snapshot = makeInitialSnapshot({ newProfile: true });
  snapshot.dailyCompletions['2026-09-25'] = '2026-09-26';
  snapshot.dailyCompletions['2026-09-24'] = 'legacy';
  snapshot.ownedCollectibles['journey-1-1'] = { source: 'legacy', earnedDay: 'legacy' };
  const events = observedRetentionMilestones(snapshot, now);
  expect(events.filter((event) => event.name === 'daily_completed')).toEqual([{
    name: 'daily_completed', key: '2026-09-25',
    properties: { dateKey: '2026-09-25', actionDay: '2026-09-26', mode: 'daily', firstTime: true },
  }]);
  expect(events.some((event) => event.name === 'collectible_unlocked')).toBe(false);
});

test('period and event closure are observed only after their end date', () => {
  const snapshot = makeInitialSnapshot({ newProfile: true });
  snapshot.weekInstances['week:2026-09-24'] = {
    periodId: 'week:2026-09-24', startDay: '2026-09-24', endDay: '2026-10-01',
    activeDays: ['2026-09-25'], postcardId: null, bonusTicketAtFive: true,
    coinsAtTwoDays: 10, ticketsAtFourDays: 1, postcardAtActiveDays: 5, claimedTiers: [],
  };
  snapshot.eventInstances['suitcase:2026-09-26'] = {
    id: 'suitcase:2026-09-26', startDay: '2026-09-26', endDay: '2026-10-03',
    points: 2, tiers: [],
  };
  expect(observedRetentionMilestones(snapshot, now).some((event) =>
    event.name === 'weekly_period_closed' || event.name === 'event_finished')).toBe(false);
  const after = observedRetentionMilestones(snapshot, Date.parse('2026-10-04T12:00:00.000Z'));
  expect(after.map((event) => event.name)).toContain('weekly_period_closed');
  expect(after.map((event) => event.name)).toContain('event_finished');
});
