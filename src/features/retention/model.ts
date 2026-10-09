import { ECONOMY } from '@/core/config/economy';
import { COLLECTIBLE_CATALOG, RETENTION, type CollectibleKind } from '@/core/config/retention';
import { normalizeWord } from '@/core/engine/normalize';

export type PuzzleMode = 'campaign' | 'daily';
export type RewardKind = 'coins' | 'ticket' | 'collectible';

export interface RewardGrant {
  id: string;
  kind: RewardKind;
  amount?: number;
  collectibleId?: string;
  source: string;
}

export interface Quest {
  id: string;
  title: string;
  kind: 'completions' | 'manualWords' | 'bonusWords';
  target: number;
  progress: number;
  completed: boolean;
  rewardCoins: number;
}

export interface QuestContentProof {
  puzzleKey: string;
  fingerprint: string;
}

export interface QuestInstance {
  day: string;
  quests: Quest[];
  /** Pinned content shown to be sufficient when the day was created. */
  contentProof?: QuestContentProof[];
  allRewardCoins: number;
  allCompleted: boolean;
  claimedAll: boolean;
}

export interface WeekInstance {
  periodId: string;
  startDay: string;
  endDay: string;
  activeDays: string[];
  postcardId: string | null;
  bonusCoinsAtFive?: boolean;
  /** Pre-coin-save field, read only for existing weeks. */
  bonusTicketAtFive?: boolean;
  coinsAtTwoDays: number;
  coinsAtFourDays?: number;
  /** Pre-coin-save field, read only for existing weeks. */
  ticketsAtFourDays?: number;
  postcardAtActiveDays: number;
  claimedTiers: number[];
}

export interface EventTier {
  points: number;
  kind: RewardKind;
  amount?: number;
  collectibleId?: string;
  claimed: boolean;
}

export interface EventInstance {
  id: string;
  startDay: string;
  endDay: string;
  points: number;
  tiers: EventTier[];
}

export interface CollectibleOwnership {
  source: string;
  earnedDay: string;
}

/** The whole retention transition is persisted as one MMKV value. */
export interface RetentionSnapshot {
  version: 1;
  journeyBaselineCompleted: number;
  campaignCompletions: Record<string, string>;
  dailyCompletions: Record<string, string>;
  manualWordKeys: Record<string, 1>;
  bonusWordKeys: Record<string, 1>;
  completionCountsByDay: Record<string, number>;
  todayDailyByActionDay: Record<string, 1>;
  bonusBankUnits: number;
  tickets: number;
  weeklyAnchorDay: string | null;
  weekInstances: Record<string, WeekInstance>;
  questInstances: Record<string, QuestInstance>;
  eventInstances: Record<string, EventInstance>;
  ownedCollectibles: Record<string, CollectibleOwnership>;
  seenCollectibles: Record<string, 1>;
  rewardGrants: Record<string, RewardGrant>;
  /** Reward IDs from words in unfinished puzzles, keyed by stable puzzle ID. */
  puzzleEffectIds: Record<string, string[]>;
  /** Exact reward IDs produced by each first completion, for result replay. */
  completionEffectIds: Record<string, string[]>;
  pendingCoinGrants: Record<string, number>;
  ticketSpendIds: Record<string, 1>;
}

export interface CompletionAction {
  mode: PuzzleMode;
  /** Campaign global level id or daily puzzle product date. Never an attempt UUID. */
  puzzleKey: string;
  /** Product date of the completed gesture, fixed UTC+3. */
  actionDay: string;
  /** Daily puzzle's original product date; carried puzzles retain this. */
  puzzleDay?: string;
  completedAtMs: number;
  remainingNewPuzzles?: number;
  availableBonusWords?: number;
  availableManualWords?: number;
  contentProof?: QuestContentProof[];
  /** Optional final accepted words are applied atomically with completion. */
  acceptedWords?: { word: string; bonus: boolean; manual: boolean; actionDay?: string }[];
}

export interface WordAction {
  mode: PuzzleMode;
  puzzleKey: string;
  puzzleDay?: string;
  word: string;
  actionDay: string;
  bonus: boolean;
  manual: boolean;
  remainingNewPuzzles?: number;
  availableBonusWords?: number;
  availableManualWords?: number;
  contentProof?: QuestContentProof[];
}

export interface DayOptions {
  actionDay: string;
  remainingNewPuzzles?: number;
  availableBonusWords?: number;
  availableManualWords?: number;
  contentProof?: QuestContentProof[];
}

export interface TransitionResult {
  snapshot: RetentionSnapshot;
  accepted: boolean;
  effects: RewardGrant[];
}

export function epochDay(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid product day: ${day}`);
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) {
    throw new Error(`Invalid product day: ${day}`);
  }
  return Math.floor(ms / 86_400_000);
}

export function dayFromEpoch(epoch: number): string {
  return new Date(epoch * 86_400_000).toISOString().slice(0, 10);
}

export function productDayAt(atMs: number): string {
  if (!Number.isFinite(atMs)) throw new Error('Invalid timestamp');
  return new Date(atMs + RETENTION.utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function clone(snapshot: RetentionSnapshot): RetentionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as RetentionSnapshot;
}

export function makeInitialSnapshot(options: {
  newProfile: boolean;
  legacyCampaignIds?: (string | number)[];
  legacyDailyDay?: string | null;
  legacyDailyDays?: string[];
  existingBonusKeys?: string[];
  existingManualKeys?: string[];
}): RetentionSnapshot {
  const campaignCompletions: Record<string, string> = {};
  for (const id of options.legacyCampaignIds ?? []) {
    const key = String(id);
    if (/^[1-9]\d*$/.test(key)) campaignCompletions[key] = 'legacy';
  }
  const dailyCompletions: Record<string, string> = {};
  for (const day of [...(options.legacyDailyDays ?? []), ...(options.legacyDailyDay ? [options.legacyDailyDay] : [])]) {
    try {
      epochDay(day);
      dailyCompletions[day] = 'legacy';
    } catch { /* Invalid old daily state is ignored. */ }
  }
  const bonusWordKeys: Record<string, 1> = {};
  for (const key of options.existingBonusKeys ?? []) if (key) bonusWordKeys[key] = 1;
  const manualWordKeys: Record<string, 1> = {};
  for (const key of options.existingManualKeys ?? []) if (key) manualWordKeys[key] = 1;
  const initial: RetentionSnapshot = {
    version: 1,
    journeyBaselineCompleted: Object.keys(campaignCompletions).length,
    campaignCompletions,
    dailyCompletions,
    manualWordKeys,
    bonusWordKeys,
    completionCountsByDay: {},
    todayDailyByActionDay: {},
    bonusBankUnits: 0,
    tickets: 0,
    weeklyAnchorDay: null,
    weekInstances: {},
    questInstances: {},
    eventInstances: {},
    ownedCollectibles: {},
    seenCollectibles: {},
    rewardGrants: options.newProfile
      ? { 'starter:hint-coins': { id: 'starter:hint-coins', kind: 'coins', amount: ECONOMY.starterHintCoins, source: 'starter' } }
      : {},
    puzzleEffectIds: {},
    completionEffectIds: {},
    pendingCoinGrants: options.newProfile ? { 'starter:hint-coins': ECONOMY.starterHintCoins } : {},
    ticketSpendIds: {},
  };
  if (Object.keys(dailyCompletions).length > 0) grantDailyCollection(initial, 'legacy', []);
  return initial;
}

function grant(draft: RetentionSnapshot, reward: RewardGrant, day: string, effects: RewardGrant[]): void {
  if (draft.rewardGrants[reward.id]) return;
  // Historical pinned tiers can still say "ticket". Their reward is a finite
  // coin grant so every actual hint goes through the same wallet debit.
  const actual: RewardGrant = reward.kind === 'ticket'
    ? { ...reward, kind: 'coins', amount: (reward.amount ?? 1) * ECONOMY.legacyTicketCoins }
    : reward;
  draft.rewardGrants[actual.id] = actual;
  if (actual.kind === 'coins') {
    const amount = actual.amount ?? 0;
    if (amount <= 0) throw new Error(`Invalid coin grant: ${actual.id}`);
    draft.pendingCoinGrants[actual.id] = amount;
  } else if (actual.collectibleId) {
    draft.ownedCollectibles[actual.collectibleId] = { source: actual.source, earnedDay: day };
  }
  effects.push(actual);
}

export function campaignWins(snapshot: RetentionSnapshot): number {
  return Object.keys(snapshot.campaignCompletions).length;
}

function completionId(mode: PuzzleMode, puzzleKey: string): string {
  return `${mode}:${puzzleKey}`;
}

function grantsForIds(snapshot: RetentionSnapshot, ids: string[]): RewardGrant[] {
  return ids.flatMap((id) => snapshot.rewardGrants[id] ? [snapshot.rewardGrants[id]] : []);
}

function legacyWordEffects(snapshot: RetentionSnapshot): Record<string, string[]> {
  const effects: Record<string, string[]> = {};
  let precedingBonusPuzzle: string | null = null;
  for (const [id, grant] of Object.entries(snapshot.rewardGrants)) {
    const bonus = /^bonus:(campaign|daily):(.+):([а-я]{3,8})$/.exec(id);
    if (bonus && grant.source === 'bonus') {
      const puzzle = completionId(bonus[1] as PuzzleMode, bonus[2]);
      (effects[puzzle] ??= []).push(id);
      precedingBonusPuzzle = puzzle;
      continue;
    }
    if (grant.source === 'bonus-bank' && precedingBonusPuzzle) {
      effects[precedingBonusPuzzle].push(id);
    }
    precedingBonusPuzzle = null;
  }
  return effects;
}

/**
 * Old v1 saves did not associate rewards with a completion. Reconstruct only
 * effects whose source is exclusively a completion, using grant order. Word
 * quest rewards are left out because they may have happened between puzzles.
 */
function legacyCompletionEffects(snapshot: RetentionSnapshot): Record<string, string[]> {
  const effects: Record<string, string[]> = {};
  let current: string | null = null;
  let lastWasSolver = false;
  for (const [id, grant] of Object.entries(snapshot.rewardGrants)) {
    const campaign = /^campaign:([1-9]\d*):complete$/.exec(id);
    const daily = /^daily:(\d{4}-\d{2}-\d{2}):complete$/.exec(id);
    if (campaign && snapshot.campaignCompletions[campaign[1]]) {
      current = completionId('campaign', campaign[1]);
      effects[current] = [id];
      lastWasSolver = false;
      continue;
    }
    if (daily && snapshot.dailyCompletions[daily[1]]) {
      current = completionId('daily', daily[1]);
      effects[current] = [id];
      lastWasSolver = false;
      continue;
    }
    if (!current) continue;
    if (grant.source === 'journey' || grant.source === 'week' || grant.source === 'event'
      || grant.source === 'daily') {
      effects[current].push(id);
      lastWasSolver = false;
      continue;
    }
    if (grant.source === 'quest') {
      const match = /^quest:(\d{4}-\d{2}-\d{2}):(solver|all)$/.exec(id);
      const solver = match && snapshot.questInstances[match[1]]?.quests.find((quest) => quest.id === 'solver');
      if (match?.[2] === 'solver' && solver?.kind === 'completions') {
        effects[current].push(id);
        lastWasSolver = true;
        continue;
      }
      if (match?.[2] === 'all' && lastWasSolver) {
        effects[current].push(id);
        lastWasSolver = false;
        continue;
      }
    }
    lastWasSolver = false;
  }
  return effects;
}

export function sanitizeCompletionEffects(snapshot: RetentionSnapshot): RetentionSnapshot {
  const oldWords = legacyWordEffects(snapshot);
  const recordedWords = snapshot.puzzleEffectIds;
  const safeWords: Record<string, string[]> = {};
  if (recordedWords && typeof recordedWords === 'object' && !Array.isArray(recordedWords)) {
    for (const [key, rawIds] of Object.entries(recordedWords)) {
      if (!Array.isArray(rawIds)) continue;
      safeWords[key] = [...new Set(rawIds.filter((id): id is string =>
        typeof id === 'string' && Boolean(snapshot.rewardGrants[id])))];
    }
  }
  for (const [key, ids] of Object.entries(oldWords)) {
    const [mode, puzzleKey] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const completed = mode === 'campaign'
      ? snapshot.campaignCompletions[puzzleKey]
      : snapshot.dailyCompletions[puzzleKey];
    if (!completed && !safeWords[key]) safeWords[key] = ids;
  }
  const recorded = snapshot.completionEffectIds;
  const fallback = legacyCompletionEffects(snapshot);
  const safe: Record<string, string[]> = {};
  if (recorded && typeof recorded === 'object' && !Array.isArray(recorded)) {
    for (const [key, rawIds] of Object.entries(recorded)) {
      if (!Array.isArray(rawIds)) continue;
      const ids = [...new Set(rawIds.filter((id): id is string =>
        typeof id === 'string' && Boolean(snapshot.rewardGrants[id])))];
      safe[key] = ids;
    }
  }
  for (const [key, ids] of Object.entries(fallback)) {
    if (!safe[key] || safe[key].length === 0) safe[key] = [...(oldWords[key] ?? []), ...ids];
  }
  for (const [key, ids] of Object.entries(oldWords)) {
    if (safe[key]) safe[key] = [...new Set([...ids, ...safe[key]])];
  }
  return { ...snapshot, puzzleEffectIds: safeWords, completionEffectIds: safe };
}

function replayCompletionEffects(snapshot: RetentionSnapshot, key: string): RewardGrant[] {
  const recorded = snapshot.completionEffectIds?.[key];
  const ids = recorded?.length ? recorded
    : [...(legacyWordEffects(snapshot)[key] ?? []), ...(legacyCompletionEffects(snapshot)[key] ?? [])];
  return grantsForIds(snapshot, ids);
}

/** Read a settled result after a screen or JS reload without changing progress. */
export function getCompletionRewards(
  snapshot: RetentionSnapshot,
  mode: PuzzleMode,
  puzzleKey: string,
): RewardGrant[] {
  const completed = mode === 'campaign'
    ? snapshot.campaignCompletions[puzzleKey]
    : snapshot.dailyCompletions[puzzleKey];
  if (!completed) return [];
  return replayCompletionEffects(snapshot, completionId(mode, puzzleKey));
}

export function getFeatureGates(snapshot: RetentionSnapshot) {
  const wins = campaignWins(snapshot);
  const gate = RETENTION.unlockAfterCampaignWins;
  const flags = RETENTION.featureFlags;
  return {
    campaignWins: wins,
    journey: wins >= gate.journey,
    daily: flags.daily && wins >= gate.daily,
    week: flags.week && wins >= gate.week,
    quests: flags.quests && wins >= gate.quests,
    event: flags.event && wins >= gate.event,
  };
}

function journeyThreshold(index: number): number {
  if (index < 6) return RETENTION.journey.firstAlbumThresholds[index];
  const laterIndex = index - 6;
  const album = Math.floor(laterIndex / 6);
  return RETENTION.journey.firstAlbumThresholds[5]
    + album * 30 + RETENTION.journey.laterAlbumThresholds[laterIndex % 6];
}

function journeyCards(): string[] {
  return COLLECTIBLE_CATALOG.filter((item) => item.kind === 'journey').map((item) => item.id);
}

function grantJourney(draft: RetentionSnapshot, day: string, effects: RewardGrant[]): void {
  const progress = campaignWins(draft) - draft.journeyBaselineCompleted;
  journeyCards().forEach((id, index) => {
    if (progress < journeyThreshold(index)) return;
    grant(draft, { id: `journey:${id}`, kind: 'collectible', collectibleId: id, source: 'journey' }, day, effects);
    if (index % 6 === 5) {
      const coverId = `journey-cover-${Math.floor(index / 6) + 1}`;
      if (COLLECTIBLE_CATALOG.some((item) => item.id === coverId)) {
        grant(draft, { id: `journey:${coverId}`, kind: 'collectible', collectibleId: coverId, source: 'journey' }, day, effects);
      }
    }
  });
}

function grantDailyCollection(draft: RetentionSnapshot, day: string, effects: RewardGrant[]): void {
  const progress = Object.keys(draft.dailyCompletions).length;
  const available = COLLECTIBLE_CATALOG.filter((item) => item.kind === 'daily');
  available.forEach((item, index) => {
    const volume = Math.floor(index / 4);
    const threshold = volume * RETENTION.daily.volumeSize
      + RETENTION.daily.postcardThresholds[index % 4];
    if (progress >= threshold) {
      grant(draft, { id: `daily-collection:${item.id}`, kind: 'collectible', collectibleId: item.id, source: 'daily' }, day, effects);
    }
  });
}

function activeForWeek(snapshot: RetentionSnapshot, day: string): boolean {
  return snapshot.todayDailyByActionDay[day] === 1 || (snapshot.completionCountsByDay[day] ?? 0) >= 2;
}

function nextUnowned(snapshot: RetentionSnapshot, kind: CollectibleKind): string | null {
  return COLLECTIBLE_CATALOG.find((item) => item.kind === kind && !snapshot.ownedCollectibles[item.id])?.id ?? null;
}

function weekForDay(draft: RetentionSnapshot, day: string): WeekInstance | null {
  if (!draft.weeklyAnchorDay || day < draft.weeklyAnchorDay) return null;
  const pinned = Object.values(draft.weekInstances).find((instance) =>
    day >= instance.startDay && day < instance.endDay);
  if (pinned) return pinned;
  const index = Math.floor((epochDay(day) - epochDay(draft.weeklyAnchorDay)) / RETENTION.week.durationDays);
  const startDay = dayFromEpoch(epochDay(draft.weeklyAnchorDay) + index * RETENTION.week.durationDays);
  const periodId = `week:${startDay}`;
  if (!draft.weekInstances[periodId]) {
    const postcardId = nextUnowned(draft, 'weekly');
    draft.weekInstances[periodId] = {
      periodId,
      startDay,
      endDay: dayFromEpoch(epochDay(startDay) + RETENTION.week.durationDays),
      activeDays: [],
      postcardId,
      bonusCoinsAtFive: postcardId === null,
      coinsAtTwoDays: RETENTION.week.coinsAtTwoDays,
      coinsAtFourDays: RETENTION.week.coinsAtFourDays,
      postcardAtActiveDays: RETENTION.week.activeDaysForPostcard,
      claimedTiers: [],
    };
  }
  return draft.weekInstances[periodId];
}

function refreshWeek(draft: RetentionSnapshot, day: string, effects: RewardGrant[]): void {
  if (!RETENTION.featureFlags.week) return;
  const week = weekForDay(draft, day);
  if (!week || !activeForWeek(draft, day)) return;
  if (!week.activeDays.includes(day)) week.activeDays.push(day);
  const count = week.activeDays.length;
  for (const tier of [2, 4, week.postcardAtActiveDays ?? 5]) {
    if (count < tier || week.claimedTiers.includes(tier)) continue;
    week.claimedTiers.push(tier);
    if (tier === 2) {
      grant(draft, { id: `${week.periodId}:2`, kind: 'coins', amount: week.coinsAtTwoDays ?? 10, source: 'week' }, day, effects);
    } else if (tier === 4 || week.bonusCoinsAtFive || week.bonusTicketAtFive) {
      const amount = tier === 4
        ? week.coinsAtFourDays ?? (week.ticketsAtFourDays ?? 1) * ECONOMY.legacyTicketCoins
        : ECONOMY.legacyTicketCoins;
      grant(draft, { id: `${week.periodId}:${tier}`, kind: 'coins', amount, source: 'week' }, day, effects);
    } else if (week.postcardId) {
      grant(draft, { id: `${week.periodId}:${tier}`, kind: 'collectible', collectibleId: week.postcardId, source: 'week' }, day, effects);
    }
  }
}

function createQuest(day: string, options: DayOptions): QuestInstance | null {
  const remaining = options.remainingNewPuzzles ?? 0;
  if (remaining === 0) return null;
  const q = RETENTION.quests;
  // Unknown content is never treated as available. The caller must supply a
  // verified count from actual released and unfinished grids.
  if ((options.availableManualWords ?? 0) < q.wordTarget) return null;
  const completionAvailable = remaining >= q.completionTarget;
  const bonusesAvailable = (options.availableBonusWords ?? 0) >= q.bonusTarget;
  return {
    day,
    contentProof: options.contentProof ?? [],
    quests: [
      completionAvailable
        ? { id: 'solver', title: 'Решатель', kind: 'completions', target: q.completionTarget, progress: 0, completed: false, rewardCoins: q.eachCoins }
        : { id: 'solver', title: 'Знаток слов', kind: 'manualWords', target: q.fallbackWordTarget, progress: 0, completed: false, rewardCoins: q.eachCoins },
      { id: 'words', title: 'Собиратель слов', kind: 'manualWords', target: q.wordTarget, progress: 0, completed: false, rewardCoins: q.eachCoins },
      bonusesAvailable
        ? { id: 'bonus', title: 'Исследователь', kind: 'bonusWords', target: q.bonusTarget, progress: 0, completed: false, rewardCoins: q.eachCoins }
        : { id: 'bonus', title: 'Исследователь слов', kind: 'manualWords', target: q.fallbackWordTarget, progress: 0, completed: false, rewardCoins: q.eachCoins },
    ],
    allRewardCoins: q.allCoins,
    allCompleted: false,
    claimedAll: false,
  };
}

function ensureQuest(draft: RetentionSnapshot, options: DayOptions): QuestInstance | null {
  if (!getFeatureGates(draft).quests) return null;
  if (!draft.questInstances[options.actionDay]) {
    const quest = createQuest(options.actionDay, options);
    if (!quest) return null;
    draft.questInstances[options.actionDay] = quest;
  }
  return draft.questInstances[options.actionDay];
}

function advanceQuests(
  draft: RetentionSnapshot,
  day: string,
  kind: Quest['kind'],
  effects: RewardGrant[],
): void {
  const instance = draft.questInstances[day];
  if (!instance) return;
  for (const quest of instance.quests) {
    if (quest.kind !== kind || quest.completed) continue;
    quest.progress = Math.min(quest.target, quest.progress + 1);
    if (quest.progress === quest.target) {
      quest.completed = true;
      grant(draft, { id: `quest:${day}:${quest.id}`, kind: 'coins', amount: quest.rewardCoins, source: 'quest' }, day, effects);
    }
  }
  if (instance.quests.every((quest) => quest.completed) && !instance.claimedAll) {
    instance.allCompleted = true;
    instance.claimedAll = true;
    grant(draft, { id: `quest:${day}:all`, kind: 'coins', amount: instance.allRewardCoins ?? 10, source: 'quest' }, day, effects);
  }
}

/** Compensate only when promised content was removed or changed after pinning. */
export function compensateUnavailableQuests(
  snapshot: RetentionSnapshot,
  options: DayOptions,
  contentInvalidated: boolean,
): TransitionResult {
  const instance = snapshot.questInstances[options.actionDay];
  if (!RETENTION.featureFlags.quests || !contentInvalidated || !instance) {
    return { snapshot, accepted: false, effects: [] };
  }
  const draft = clone(snapshot);
  const next = draft.questInstances[options.actionDay];
  const effects: RewardGrant[] = [];
  let changed = false;
  for (const quest of next.quests) {
    if (quest.completed) continue;
    const available = quest.kind === 'completions' ? options.remainingNewPuzzles ?? 0
      : quest.kind === 'bonusWords' ? options.availableBonusWords ?? 0
        : options.availableManualWords ?? 0;
    if (available >= quest.target - quest.progress) continue;
    quest.progress = quest.target;
    quest.completed = true;
    changed = true;
    grant(draft, {
      id: `quest:${options.actionDay}:${quest.id}`,
      kind: 'coins',
      amount: quest.rewardCoins,
      source: 'quest-compensation',
    }, options.actionDay, effects);
  }
  if (next.quests.every((quest) => quest.completed) && !next.claimedAll) {
    next.allCompleted = true;
    next.claimedAll = true;
    changed = true;
    grant(draft, {
      id: `quest:${options.actionDay}:all`,
      kind: 'coins',
      amount: next.allRewardCoins ?? RETENTION.quests.allCoins,
      source: 'quest',
    }, options.actionDay, effects);
  }
  return changed ? { snapshot: draft, accepted: true, effects }
    : { snapshot, accepted: false, effects: [] };
}

function eventWindow(day: string): { id: string; startDay: string; endDay: string } | null {
  const config = RETENTION.event;
  if (!RETENTION.featureFlags.event) return null;
  const offset = epochDay(day) - epochDay(config.firstStartDay);
  if (offset < 0) return null;
  const cycle = Math.floor(offset / config.cycleDays);
  if (offset % config.cycleDays >= config.durationDays) return null;
  const startDay = dayFromEpoch(epochDay(config.firstStartDay) + cycle * config.cycleDays);
  return { id: `${config.id}:${startDay}`, startDay, endDay: dayFromEpoch(epochDay(startDay) + config.durationDays) };
}

function createEvent(draft: RetentionSnapshot, day: string): EventInstance | null {
  if (!getFeatureGates(draft).event) return null;
  const pinned = Object.values(draft.eventInstances).find((instance) =>
    day >= instance.startDay && day < instance.endDay);
  if (pinned) return pinned;
  const window = eventWindow(day);
  if (!window) return null;
  if (!draft.eventInstances[window.id]) {
    const postcardId = nextUnowned(draft, 'event');
    const coverId = COLLECTIBLE_CATALOG.find((item) =>
      item.id.startsWith('event-cover-') && !draft.ownedCollectibles[item.id])?.id ?? null;
    draft.eventInstances[window.id] = {
      ...window,
      points: 0,
      tiers: [
        { points: 3, kind: 'coins', amount: RETENTION.event.firstTierCoins, claimed: false },
        { points: 8, kind: 'coins', amount: ECONOMY.legacyTicketCoins, claimed: false },
        postcardId
          ? { points: 15, kind: 'collectible', collectibleId: postcardId, claimed: false }
          : { points: 15, kind: 'coins', amount: ECONOMY.legacyTicketCoins, claimed: false },
        coverId
          ? { points: 25, kind: 'collectible', collectibleId: coverId, claimed: false }
          : { points: 25, kind: 'coins', amount: ECONOMY.legacyTicketCoins, claimed: false },
      ],
    };
  }
  return draft.eventInstances[window.id];
}

function advanceEvent(draft: RetentionSnapshot, day: string, points: number, effects: RewardGrant[]): void {
  if (points <= 0) return;
  const event = createEvent(draft, day);
  if (!event) return;
  event.points += points;
  for (const tier of event.tiers) {
    if (tier.claimed || event.points < tier.points) continue;
    tier.claimed = true;
    grant(draft, {
      id: `event:${event.id}:${tier.points}`,
      kind: tier.kind,
      amount: tier.amount,
      collectibleId: tier.collectibleId,
      source: 'event',
    }, day, effects);
  }
}

export function ensureDay(snapshot: RetentionSnapshot, options: DayOptions): RetentionSnapshot {
  epochDay(options.actionDay);
  const draft = clone(snapshot);
  if (!draft.weeklyAnchorDay && getFeatureGates(draft).week) draft.weeklyAnchorDay = options.actionDay;
  if (getFeatureGates(draft).week) weekForDay(draft, options.actionDay);
  ensureQuest(draft, options);
  return draft;
}

export function reduceCompletion(snapshot: RetentionSnapshot, action: CompletionAction): TransitionResult {
  epochDay(action.actionDay);
  if (!Number.isFinite(action.completedAtMs) || productDayAt(action.completedAtMs) !== action.actionDay) {
    throw new Error('Completion timestamp and product day disagree');
  }
  const dailyDay = action.mode === 'daily' ? action.puzzleDay ?? action.puzzleKey : null;
  if (dailyDay) epochDay(dailyDay);
  const key = action.mode === 'campaign' ? action.puzzleKey : dailyDay!;
  if (!key) throw new Error('Missing stable puzzle key');
  if (action.mode === 'campaign' && !/^[1-9]\d*$/.test(key)) throw new Error('Campaign key must be global level id');
  const existing = action.mode === 'campaign' ? snapshot.campaignCompletions[key] : snapshot.dailyCompletions[key];
  if (existing) return {
    snapshot,
    accepted: false,
    effects: replayCompletionEffects(snapshot, completionId(action.mode, key)),
  };
  if (action.mode === 'daily' && !RETENTION.featureFlags.daily) {
    return { snapshot, accepted: false, effects: [] };
  }

  let draft = clone(snapshot);
  draft.puzzleEffectIds ??= {};
  draft.completionEffectIds ??= {};
  const effects: RewardGrant[] = [];
  for (const acceptedWord of action.acceptedWords ?? []) {
    const wordResult = reduceWord(draft, {
      mode: action.mode,
      puzzleKey: key,
      puzzleDay: dailyDay ?? undefined,
      ...acceptedWord,
      actionDay: acceptedWord.actionDay ?? action.actionDay,
      remainingNewPuzzles: action.remainingNewPuzzles,
      availableBonusWords: action.availableBonusWords,
      availableManualWords: action.availableManualWords,
      contentProof: action.contentProof,
    });
    draft = wordResult.snapshot;
    effects.push(...wordResult.effects);
  }
  // An action that unlocks quests does not retroactively count for them.
  const questsWereOpen = getFeatureGates(draft).quests;
  if (questsWereOpen) ensureQuest(draft, action);
  if (action.mode === 'campaign') {
    draft.campaignCompletions[key] = action.actionDay;
    grantJourney(draft, action.actionDay, effects);
  } else {
    draft.dailyCompletions[key] = action.actionDay;
    grant(draft, { id: `daily:${key}:complete`, kind: 'coins', amount: ECONOMY.dailyPuzzleCoins, source: 'daily' }, action.actionDay, effects);
    grantDailyCollection(draft, action.actionDay, effects);
    if (RETENTION.featureFlags.week && key === action.actionDay) draft.todayDailyByActionDay[action.actionDay] = 1;
  }
  if (RETENTION.featureFlags.week) {
    draft.completionCountsByDay[action.actionDay] = (draft.completionCountsByDay[action.actionDay] ?? 0) + 1;
  }
  if (!draft.weeklyAnchorDay && getFeatureGates(draft).week) draft.weeklyAnchorDay = action.actionDay;
  refreshWeek(draft, action.actionDay, effects);
  if (questsWereOpen) advanceQuests(draft, action.actionDay, 'completions', effects);
  advanceEvent(draft, action.actionDay,
    action.mode === 'campaign' ? RETENTION.event.campaignPoints
      : key === action.actionDay ? RETENTION.event.todayDailyPoints : 0,
    effects);
  // The completed puzzle key now blocks every later word callback. Keep only
  // dedupe keys for unfinished puzzles so long journeys do not retain all words.
  const wordPrefix = `${action.mode}:${key}:`;
  for (const wordKey of Object.keys(draft.manualWordKeys)) {
    if (wordKey.startsWith(wordPrefix)) delete draft.manualWordKeys[wordKey];
  }
  for (const wordKey of Object.keys(draft.bonusWordKeys)) {
    if (wordKey.startsWith(wordPrefix)) delete draft.bonusWordKeys[wordKey];
  }
  const stableId = completionId(action.mode, key);
  const allIds = [...new Set([...(draft.puzzleEffectIds[stableId] ?? []), ...effects.map((effect) => effect.id)])];
  draft.completionEffectIds[stableId] = allIds;
  delete draft.puzzleEffectIds[stableId];
  return { snapshot: draft, accepted: true, effects: grantsForIds(draft, allIds) };
}

export function reduceWord(snapshot: RetentionSnapshot, action: WordAction): TransitionResult {
  epochDay(action.actionDay);
  if (action.mode === 'daily' && !RETENTION.featureFlags.daily) {
    return { snapshot, accepted: false, effects: [] };
  }
  if (!action.manual) return { snapshot, accepted: false, effects: [] };
  const puzzleKey = action.mode === 'campaign' ? action.puzzleKey : action.puzzleDay ?? action.puzzleKey;
  if (!puzzleKey) throw new Error('Missing stable puzzle key');
  if (action.mode === 'campaign' && !/^[1-9]\d*$/.test(puzzleKey)) throw new Error('Campaign key must be global level id');
  if (action.mode === 'daily') epochDay(puzzleKey);
  const completed = action.mode === 'campaign'
    ? snapshot.campaignCompletions[puzzleKey]
    : snapshot.dailyCompletions[puzzleKey];
  if (completed) return { snapshot, accepted: false, effects: [] };
  const word = normalizeWord(action.word);
  if (!/^[а-я]{3,8}$/.test(word)) throw new Error('Invalid accepted word');
  const wordKey = `${action.mode}:${puzzleKey}:${word}`;
  if (snapshot.manualWordKeys[wordKey]) return { snapshot, accepted: false, effects: [] };
  const draft = clone(snapshot);
  draft.puzzleEffectIds ??= {};
  const effects: RewardGrant[] = [];
  ensureQuest(draft, action);
  draft.manualWordKeys[wordKey] = 1;
  if (RETENTION.featureFlags.quests) advanceQuests(draft, action.actionDay, 'manualWords', effects);
  if (action.bonus && !draft.bonusWordKeys[wordKey]) {
    draft.bonusWordKeys[wordKey] = 1;
    grant(draft, { id: `bonus:${wordKey}`, kind: 'coins', amount: ECONOMY.bonusWordCoins, source: 'bonus' }, action.actionDay, effects);
    draft.bonusBankUnits += 1;
    if (draft.bonusBankUnits >= ECONOMY.bonusBankThreshold) {
      draft.bonusBankUnits -= ECONOMY.bonusBankThreshold;
      const bankNumber = Object.keys(draft.rewardGrants).filter((id) => id.startsWith('bonus-bank:')).length + 1;
      grant(draft, { id: `bonus-bank:${bankNumber}`, kind: 'coins', amount: ECONOMY.bonusBankCoins, source: 'bonus-bank' }, action.actionDay, effects);
    }
    if (RETENTION.featureFlags.quests) advanceQuests(draft, action.actionDay, 'bonusWords', effects);
  }
  if (effects.length > 0) {
    const stableId = completionId(action.mode, puzzleKey);
    draft.puzzleEffectIds[stableId] = [...new Set([
      ...(draft.puzzleEffectIds[stableId] ?? []),
      ...effects.map((effect) => effect.id),
    ])];
  }
  return { snapshot: draft, accepted: true, effects };
}
