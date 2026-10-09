import { addDays, dayKey, isDayKey } from '@/core/time';
import { getCollectibles, type RetentionSnapshot } from '@/features/retention';

import { trackOnce } from './index';

export interface ObservedMilestone {
  name: string;
  key: string;
  properties: Record<string, string | number | boolean>;
}

/** Derive only committed, recent milestones; screen focus can safely retry these. */
export function observedRetentionMilestones(snapshot: RetentionSnapshot, nowMs: number): ObservedMilestone[] {
  const today = dayKey(new Date(nowMs));
  const recentWeek = addDays(today, -7);
  const recentEvent = addDays(today, -14);
  const events: ObservedMilestone[] = [];
  const add = (name: string, key: string, properties: ObservedMilestone['properties']) => {
    events.push({ name, key, properties });
  };

  for (const [puzzleDate, completedDay] of Object.entries(snapshot.dailyCompletions)) {
    if (isDayKey(completedDay) && completedDay >= recentEvent) {
      add('daily_completed', puzzleDate, {
        dateKey: puzzleDate, actionDay: completedDay, mode: 'daily', firstTime: true,
      });
    }
  }

  for (const week of Object.values(snapshot.weekInstances).filter((item) => item.endDay >= recentWeek)) {
    for (const date of week.activeDays) {
      add('weekly_day_qualified', `${week.periodId}:${date}`, {
        periodId: week.periodId,
        dateKey: date,
        source: snapshot.todayDailyByActionDay[date] === 1 ? 'daily' : 'campaign',
      });
    }
    for (const tier of week.claimedTiers) {
      add('weekly_milestone_granted', `${week.periodId}:${tier}`, {
        periodId: week.periodId, target: tier, progress: week.activeDays.length,
      });
    }
    if (week.endDay <= today) {
      add('weekly_period_closed', week.periodId, {
        periodId: week.periodId, activeDays: week.activeDays.length,
      });
    }
  }

  for (const questSet of Object.values(snapshot.questInstances).filter((item) => item.day >= recentWeek)) {
    for (const quest of questSet.quests) {
      const key = `${questSet.day}:${quest.id}`;
      add('quest_created', key, {
        dateKey: questSet.day, templateId: quest.id, target: quest.target, reward: quest.rewardCoins,
      });
      if (quest.completed) add('quest_completed', key, {
        dateKey: questSet.day, templateId: quest.id, target: quest.target, reward: quest.rewardCoins,
      });
    }
    if (questSet.claimedAll) add('quest_set_completed', questSet.day, {
      dateKey: questSet.day, target: questSet.quests.length,
    });
  }

  for (const event of Object.values(snapshot.eventInstances).filter((item) => item.endDay >= recentEvent)) {
    if (event.startDay <= today && today < event.endDay) {
      add('event_eligible', event.id, { eventInstanceId: event.id });
    }
    if (event.points > 0) {
      add('event_progressed', `${event.id}:${event.points}`, {
        eventInstanceId: event.id, progress: event.points,
      });
    }
    for (const tier of event.tiers) {
      if (tier.claimed) add('event_milestone_granted', `${event.id}:${tier.points}`, {
        eventInstanceId: event.id, target: tier.points, kind: tier.kind,
      });
    }
    if (event.endDay <= today) add('event_finished', event.id, {
      eventInstanceId: event.id, progress: event.points,
    });
  }

  for (const [id, ownership] of Object.entries(snapshot.ownedCollectibles)) {
    if (isDayKey(ownership.earnedDay) && ownership.earnedDay >= recentEvent) {
      add('collectible_unlocked', id, { collectibleId: id, source: ownership.source });
    }
  }
  for (const [kind, size] of [['journey', 6], ['daily', 4]] as const) {
    const cards = getCollectibles(snapshot, kind);
    for (let start = 0; start + size <= cards.length; start += size) {
      const group = cards.slice(start, start + size);
      if (group.every((card) => card.owned) && group.some((card) => {
        const earnedDay = snapshot.ownedCollectibles[card.id]?.earnedDay;
        return typeof earnedDay === 'string' && isDayKey(earnedDay) && earnedDay >= recentEvent;
      })) {
        const albumId = `${kind}-album:${start / size + 1}`;
        add('album_completed', albumId, { id: albumId, kind, target: size });
      }
    }
  }
  return events;
}

export function trackObservedRetentionMilestones(snapshot: RetentionSnapshot, nowMs = Date.now()): void {
  for (const event of observedRetentionMilestones(snapshot, nowMs)) {
    trackOnce(event.name, event.key, event.properties);
  }
}
