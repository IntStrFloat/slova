import { COLLECTIBLE_CATALOG, RETENTION, type CollectibleKind } from '@/core/config/retention';
import { ECONOMY } from '@/core/config/economy';
import { WORLDS } from '@/core/config/worlds';

import {
  campaignWins, dayFromEpoch, epochDay, getFeatureGates, productDayAt,
  type EventInstance, type EventTier, type QuestInstance, type RetentionSnapshot,
  type WeekInstance,
} from './model';

const imageByArtId = new Map(
  WORLDS.flatMap((world) => world.landmarks.map((landmark) => [landmark.id, landmark.image] as const)),
);

function journeyThreshold(index: number): number {
  if (index < 6) return RETENTION.journey.firstAlbumThresholds[index];
  const laterIndex = index - 6;
  return RETENTION.journey.firstAlbumThresholds[5]
    + Math.floor(laterIndex / 6) * 30
    + RETENTION.journey.laterAlbumThresholds[laterIndex % 6];
}

export interface JourneyStatus {
  completedAfterAnchor: number;
  albumIndex: number;
  progressInAlbum: number;
  nextPostcardAt: number | null;
  remaining: number | null;
  nextCollectibleId: string | null;
  ownedInAlbum: number;
  albumComplete: boolean;
}

export function getJourneyStatus(snapshot: RetentionSnapshot): JourneyStatus {
  const progress = Math.max(0, campaignWins(snapshot) - snapshot.journeyBaselineCompleted);
  const cards = COLLECTIBLE_CATALOG.filter((item) => item.kind === 'journey');
  const nextIndex = cards.findIndex((_, index) => journeyThreshold(index) > progress);
  const activeIndex = nextIndex < 0 ? cards.length : nextIndex;
  const albumIndex = Math.floor(activeIndex / 6);
  const albumStart = albumIndex === 0 ? 0 : journeyThreshold(albumIndex * 6 - 1);
  const nextAt = nextIndex < 0 ? null : journeyThreshold(nextIndex);
  const albumCards = cards.slice(albumIndex * 6, albumIndex * 6 + 6);
  return {
    completedAfterAnchor: progress,
    albumIndex,
    progressInAlbum: Math.max(0, progress - albumStart),
    nextPostcardAt: nextAt,
    remaining: nextAt === null ? null : Math.max(0, nextAt - progress),
    nextCollectibleId: nextIndex < 0 ? null : cards[nextIndex].id,
    ownedInAlbum: albumCards.filter((item) => Boolean(snapshot.ownedCollectibles[item.id])).length,
    albumComplete: albumCards.length > 0 && albumCards.every((item) => Boolean(snapshot.ownedCollectibles[item.id])),
  };
}

export interface DailyCollectionStatus {
  completedDays: number;
  ownedCount: number;
  volumeIndex: number;
  progressInVolume: number;
  nextPostcardAt: number | null;
  remaining: number | null;
  nextCollectibleId: string | null;
}

export function getDailyCollectionStatus(snapshot: RetentionSnapshot): DailyCollectionStatus {
  const progress = Object.keys(snapshot.dailyCompletions).length;
  const cards = COLLECTIBLE_CATALOG.filter((item) => item.kind === 'daily');
  const thresholds = cards.map((_, index) =>
    Math.floor(index / 4) * RETENTION.daily.volumeSize + RETENTION.daily.postcardThresholds[index % 4]);
  const nextIndex = thresholds.findIndex((threshold) => threshold > progress);
  const volumeIndex = progress === 0 ? 0 : Math.floor((progress - 1) / RETENTION.daily.volumeSize);
  const nextAt = nextIndex < 0 ? null : thresholds[nextIndex];
  return {
    completedDays: progress,
    ownedCount: cards.filter((card) => Boolean(snapshot.ownedCollectibles[card.id])).length,
    volumeIndex,
    progressInVolume: progress === 0 ? 0 : (progress - 1) % RETENTION.daily.volumeSize + 1,
    nextPostcardAt: nextAt,
    remaining: nextAt === null ? null : nextAt - progress,
    nextCollectibleId: nextIndex < 0 ? null : cards[nextIndex].id,
  };
}

export type WeeklyStatus = WeekInstance & { activeCount: number };

export function getWeeklyStatus(snapshot: RetentionSnapshot, actionDay: string): WeeklyStatus | null {
  if (!RETENTION.featureFlags.week) return null;
  if (!snapshot.weeklyAnchorDay || actionDay < snapshot.weeklyAnchorDay) return null;
  const pinned = Object.values(snapshot.weekInstances).find((instance) =>
    actionDay >= instance.startDay && actionDay < instance.endDay);
  if (pinned) return { ...pinned, activeCount: pinned.activeDays.length };
  const index = Math.floor((epochDay(actionDay) - epochDay(snapshot.weeklyAnchorDay)) / RETENTION.week.durationDays);
  const startDay = dayFromEpoch(epochDay(snapshot.weeklyAnchorDay) + index * RETENTION.week.durationDays);
  const week = snapshot.weekInstances[`week:${startDay}`];
  return week ? { ...week, activeCount: week.activeDays.length } : null;
}

export type QuestStatus = QuestInstance;

export function getQuestStatus(snapshot: RetentionSnapshot, actionDay: string): QuestStatus | null {
  if (!RETENTION.featureFlags.quests) return null;
  return snapshot.questInstances[actionDay] ?? null;
}

export interface EventStatus extends EventInstance {
  active: boolean;
}

function eventWindow(nowMs: number): { id: string; startDay: string; endDay: string } | null {
  if (!RETENTION.featureFlags.event) return null;
  const day = productDayAt(nowMs);
  const delta = epochDay(day) - epochDay(RETENTION.event.firstStartDay);
  if (delta < 0 || delta % RETENTION.event.cycleDays >= RETENTION.event.durationDays) return null;
  const startDay = dayFromEpoch(epochDay(RETENTION.event.firstStartDay)
    + Math.floor(delta / RETENTION.event.cycleDays) * RETENTION.event.cycleDays);
  return {
    id: `${RETENTION.event.id}:${startDay}`,
    startDay,
    endDay: dayFromEpoch(epochDay(startDay) + RETENTION.event.durationDays),
  };
}

export function getEventStatus(snapshot: RetentionSnapshot, nowMs: number): EventStatus | null {
  if (!getFeatureGates(snapshot).event) return null;
  const day = productDayAt(nowMs);
  const pinned = Object.values(snapshot.eventInstances).find((instance) =>
    day >= instance.startDay && day < instance.endDay);
  if (pinned && RETENTION.featureFlags.event) return { ...pinned, active: true };
  const window = eventWindow(nowMs);
  if (!window) return null;
  const existing = snapshot.eventInstances[window.id];
  if (existing) return { ...existing, active: true };
  const eventPostcard = COLLECTIBLE_CATALOG.find((item) =>
    item.kind === 'event' && !snapshot.ownedCollectibles[item.id])?.id;
  const eventCover = COLLECTIBLE_CATALOG.find((item) =>
    item.id.startsWith('event-cover-') && !snapshot.ownedCollectibles[item.id])?.id;
  const tiers: EventTier[] = [
    { points: 3, kind: 'coins', amount: RETENTION.event.firstTierCoins, claimed: false },
    { points: 8, kind: 'coins', amount: ECONOMY.legacyTicketCoins, claimed: false },
    eventPostcard
      ? { points: 15, kind: 'collectible', collectibleId: eventPostcard, claimed: false }
      : { points: 15, kind: 'coins', amount: ECONOMY.legacyTicketCoins, claimed: false },
    eventCover
      ? { points: 25, kind: 'collectible', collectibleId: eventCover, claimed: false }
      : { points: 25, kind: 'coins', amount: ECONOMY.legacyTicketCoins, claimed: false },
  ];
  return { ...window, points: 0, tiers, active: true };
}

export interface CollectibleView {
  id: string;
  kind: CollectibleKind;
  title: string;
  artId: string;
  image: number | undefined;
  owned: boolean;
  seen: boolean;
  threshold: number | null;
}

export function getCollectibles(snapshot: RetentionSnapshot, kind?: CollectibleKind): CollectibleView[] {
  const journeyCards = COLLECTIBLE_CATALOG.filter((item) => item.kind === 'journey');
  const dailyCards = COLLECTIBLE_CATALOG.filter((item) => item.kind === 'daily');
  return COLLECTIBLE_CATALOG.filter((item) => !kind || item.kind === kind).map((item) => {
    const journeyIndex = journeyCards.findIndex((candidate) => candidate.id === item.id);
    const dailyIndex = dailyCards.findIndex((candidate) => candidate.id === item.id);
    const threshold = journeyIndex >= 0 ? journeyThreshold(journeyIndex)
      : dailyIndex >= 0 ? Math.floor(dailyIndex / 4) * RETENTION.daily.volumeSize
        + RETENTION.daily.postcardThresholds[dailyIndex % 4]
        : null;
    return {
      ...item,
      image: imageByArtId.get(item.artId),
      owned: Boolean(snapshot.ownedCollectibles[item.id]),
      seen: Boolean(snapshot.seenCollectibles[item.id]),
      threshold,
    };
  });
}

export function getUnreadCollectibleCount(snapshot: RetentionSnapshot): number {
  return Object.keys(snapshot.ownedCollectibles).filter((id) => !snapshot.seenCollectibles[id]).length;
}
