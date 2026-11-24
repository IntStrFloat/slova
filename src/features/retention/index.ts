import { create } from 'zustand';

import { getJSON, getString, KEYS, storage } from '@/core/storage';
import { ECONOMY } from '@/core/config/economy';
import { isAnalyticsCollectionEnabled, trackOnce } from '@/features/analytics';
import { captureRetentionMilestoneTimes } from './milestones';
import { recordRetentionEligibilityUse } from '@/features/remote-config/consumption';

import {
  compensateUnavailableQuests,
  ensureDay as ensureDayModel,
  getFeatureGates,
  makeInitialSnapshot,
  reduceCompletion,
  reduceWord,
  sanitizeCompletionEffects,
  type CompletionAction,
  type DayOptions,
  type RetentionSnapshot,
  type RewardGrant,
  type WordAction,
} from './model';
import { getVerifiedQuestAvailability, hasUnavailablePinnedContent, type VerifiedQuestAvailability } from './availability';

export { COLLECTIBLE_CATALOG, RETENTION } from '@/core/config/retention';
export type { CollectibleKind, CollectibleDefinition } from '@/core/config/retention';
export * from './model';
export * from './selectors';
export * from './availability';

const STORAGE_KEY = KEYS.retention;
const BACKUP_KEY = KEYS.retentionBackup;

interface LegacyLevels { completed?: number[] }
interface LegacyDaily { lastDoneDay?: string | null; solvedDates?: string[] }
interface LegacySnapshot {
  mode?: 'normal' | 'daily';
  globalLevel?: number;
  dailyId?: string;
  solvedWords?: string[];
  foundBonus?: string[];
}

function parseSnapshot(raw: string | null): RetentionSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RetentionSnapshot;
    const maps = [
      parsed.campaignCompletions, parsed.dailyCompletions, parsed.manualWordKeys,
      parsed.bonusWordKeys, parsed.completionCountsByDay, parsed.todayDailyByActionDay,
      parsed.weekInstances, parsed.questInstances, parsed.eventInstances,
      parsed.ownedCollectibles, parsed.seenCollectibles, parsed.rewardGrants,
      parsed.pendingCoinGrants, parsed.ticketSpendIds,
    ];
    if (parsed.version !== 1 || maps.some((value) => !value || typeof value !== 'object' || Array.isArray(value))) return null;
    if (!Number.isSafeInteger(parsed.tickets) || parsed.tickets < 0
      || !Number.isSafeInteger(parsed.bonusBankUnits) || parsed.bonusBankUnits < 0
      || parsed.bonusBankUnits >= 10
      || !Number.isSafeInteger(parsed.journeyBaselineCompleted) || parsed.journeyBaselineCompleted < 0) return null;
    const snapshot = sanitizeCompletionEffects(parsed);
    // Only unspent legacy tickets convert. The wallet addOnce ledger and this
    // outbox survive a crash between the grant and its acknowledgement.
    if (snapshot.tickets > 0) {
      const id = 'legacy-ticket-conversion:v1';
      if (!snapshot.rewardGrants[id]) {
        const amount = snapshot.tickets * ECONOMY.legacyTicketCoins;
        snapshot.rewardGrants[id] = { id, kind: 'coins', amount, source: 'ticket-conversion' };
        snapshot.pendingCoinGrants[id] = amount;
      }
      snapshot.tickets = 0;
    }
    for (const event of Object.values(snapshot.eventInstances)) {
      for (const tier of event.tiers) {
        if (tier.kind === 'ticket') {
          tier.kind = 'coins';
          tier.amount = (tier.amount ?? 1) * ECONOMY.legacyTicketCoins;
        }
      }
    }
    return snapshot;
  } catch {
    return null;
  }
}

function initialSnapshot(): RetentionSnapshot {
  const primary = getString(STORAGE_KEY);
  const saved = parseSnapshot(primary);
  if (saved) return saved;
  if (primary !== null) {
    const backup = parseSnapshot(getString(BACKUP_KEY));
    if (backup) return backup;
    throw new Error('Retention save is unreadable; preserving it for recovery');
  }

  const currency = getJSON<{ version?: number; newProfile?: boolean } | null>(KEYS.currency, null);
  const legacyLevels = getJSON<LegacyLevels | null>(KEYS.levelsProgress, null);
  const legacyDaily = getJSON<LegacyDaily | null>(KEYS.dailyPuzzle, null);
  const legacyNormalRun = getJSON<LegacySnapshot | null>(KEYS.gameCurrentNormal, null);
  const legacyDailyRun = getJSON<LegacySnapshot | null>(KEYS.gameCurrentDaily, null);
  const existingBonusKeys: string[] = [];
  const existingManualKeys: string[] = [];
  for (const run of [legacyNormalRun, legacyDailyRun]) {
    if (!run) continue;
    const mode = run.mode === 'daily' ? 'daily' : 'campaign';
    const key = mode === 'daily' ? run.dailyId : run.globalLevel;
    if (!key) continue;
    for (const word of run.solvedWords ?? []) existingManualKeys.push(`${mode}:${key}:${word}`);
    for (const word of run.foundBonus ?? []) {
      existingBonusKeys.push(`${mode}:${key}:${word}`);
      existingManualKeys.push(`${mode}:${key}:${word}`);
    }
  }
  const newProfile = currency?.version === 2 && currency.newProfile === true
    || currency === null && !legacyLevels && !legacyDaily
      && getString(KEYS.collection) === null
      && getString(KEYS.gameCurrent) === null
      && getString(KEYS.profile) === null;
  return makeInitialSnapshot({
    newProfile,
    legacyCampaignIds: legacyLevels?.completed,
    legacyDailyDay: legacyDaily?.lastDoneDay,
    legacyDailyDays: legacyDaily?.solvedDates,
    existingBonusKeys,
    existingManualKeys,
  });
}

function persist(snapshot: RetentionSnapshot): void {
  const previous = getString(STORAGE_KEY);
  if (previous && parseSnapshot(previous)) storage.set(BACKUP_KEY, previous);
  storage.set(STORAGE_KEY, JSON.stringify(snapshot));
}

function copy(snapshot: RetentionSnapshot): RetentionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as RetentionSnapshot;
}

function verifiedForAction(snapshot: RetentionSnapshot, actionDay: string): VerifiedQuestAvailability {
  // Once the day's rules are pinned, word input stays on the fast path.
  if (snapshot.questInstances[actionDay] || !getFeatureGates(snapshot).quests) {
    return {
      actionDay,
      remainingNewPuzzles: 0,
      availableManualWords: 0,
      availableBonusWords: 0,
      contentProof: [],
    };
  }
  return getVerifiedQuestAvailability(snapshot, actionDay);
}

function verifiedForDay(snapshot: RetentionSnapshot, actionDay: string): VerifiedQuestAvailability {
  return getFeatureGates(snapshot).quests
    ? getVerifiedQuestAvailability(snapshot, actionDay)
    : verifiedForAction(snapshot, actionDay);
}

interface RetentionActions {
  ensureDay: (options: DayOptions) => void;
  recordCompletion: (action: CompletionAction) => { accepted: boolean; effects: RewardGrant[] };
  recordWord: (action: WordAction) => { accepted: boolean; effects: RewardGrant[] };
  reconcileRewards: (applyCoinOnce: (effectId: string, amount: number) => boolean) => number;
  grantLegacyTicketRefundOnce: (effectId: string) => boolean;
  hasSpentTicket: (effectId: string) => boolean;
  markCollectibleSeen: (id: string) => boolean;
  compensateQuest: (actionDay: string, questId: string) => boolean;
}

export type RetentionState = RetentionSnapshot & RetentionActions;

const initial = initialSnapshot();
if (getString(STORAGE_KEY) !== JSON.stringify(initial)) persist(initial);

export const useRetention = create<RetentionState>((set, get) => ({
  ...initial,
  ensureDay: (options) => {
    const verified = verifiedForDay(get(), options.actionDay);
    const prepared = ensureDayModel(get(), verified);
    const pinned = prepared.questInstances[options.actionDay]?.contentProof;
    const invalidated = getFeatureGates(prepared).quests
      && hasUnavailablePinnedContent(pinned, verified.contentProof, prepared);
    const next = compensateUnavailableQuests(prepared, verified, invalidated).snapshot;
    recordRetentionEligibilityUse(get());
    if (JSON.stringify(next) === JSON.stringify(get() as RetentionSnapshot)) return;
    const timed = captureRetentionMilestoneTimes(get(), next, Date.now(), typeof isAnalyticsCollectionEnabled === 'function' && isAnalyticsCollectionEnabled());
    persist(timed);
    set(timed);
  },
  recordCompletion: (action) => {
    const verified = verifiedForAction(get(), action.actionDay);
    const result = reduceCompletion(get(), { ...action, ...verified });
    if (!result.accepted) return { accepted: false, effects: result.effects };
    recordRetentionEligibilityUse(get());
    const timed = captureRetentionMilestoneTimes(get(), result.snapshot, action.completedAtMs, typeof isAnalyticsCollectionEnabled === 'function' && isAnalyticsCollectionEnabled());
    persist(timed);
    set(timed);
    return { accepted: true, effects: result.effects };
  },
  recordWord: (action) => {
    const verified = verifiedForAction(get(), action.actionDay);
    const result = reduceWord(get(), {
      ...action,
      ...verified,
      availableManualWords: verified.availableManualWords + (action.manual ? 1 : 0),
      availableBonusWords: verified.availableBonusWords + (action.manual && action.bonus ? 1 : 0),
    });
    if (!result.accepted) return { accepted: false, effects: [] };
    recordRetentionEligibilityUse(get());
    const timed = captureRetentionMilestoneTimes(get(), result.snapshot, action.occurredAtMs ?? Date.now(), typeof isAnalyticsCollectionEnabled === 'function' && isAnalyticsCollectionEnabled());
    persist(timed);
    set(timed);
    return { accepted: true, effects: result.effects };
  },
  reconcileRewards: (applyCoinOnce) => {
    const outstanding = Object.entries(get().pendingCoinGrants);
    if (outstanding.length === 0) return 0;
    let reconciled = 0;
    for (const [id, amount] of outstanding) {
      // A false result means the effect was already in the wallet ledger.
      // Wallet persistence errors throw and retain this outbox entry.
      try { applyCoinOnce(id, amount); } catch (error) {
        try { trackOnce('reward_grant_failed', `${id}:failure`, { rewardId: id, operation_id: id,
          attempt_no: 1, source: 'retention', reason: 'save_failed', retryable: true }); } catch { /* preserve the pending reward */ }
        throw error;
      }
      const next = copy(get());
      delete next.pendingCoinGrants[id];
      persist(next);
      set(next);
      reconciled += 1;
    }
    return reconciled;
  },
  grantLegacyTicketRefundOnce: (effectId) => {
    if (!effectId) return false;
    const current = get();
    if (current.rewardGrants[effectId]) return false;
    const next = copy(current);
    next.rewardGrants[effectId] = { id: effectId, kind: 'coins', amount: ECONOMY.legacyTicketCoins, source: 'hint-recovery' };
    next.pendingCoinGrants[effectId] = ECONOMY.legacyTicketCoins;
    persist(next);
    set(next);
    return true;
  },
  hasSpentTicket: (effectId) => Boolean(get().ticketSpendIds[effectId]),
  markCollectibleSeen: (id) => {
    if (!get().ownedCollectibles[id] || get().seenCollectibles[id]) return false;
    const next = copy(get());
    next.seenCollectibles[id] = 1;
    persist(next);
    set(next);
    return true;
  },
  compensateQuest: (actionDay, questId) => {
    const current = get();
    const instance = current.questInstances[actionDay];
    const quest = instance?.quests.find((item) => item.id === questId);
    if (!quest || quest.completed) return false;
    const next = copy(current);
    const nextInstance = next.questInstances[actionDay];
    const nextQuest = nextInstance.quests.find((item) => item.id === questId)!;
    nextQuest.progress = nextQuest.target;
    nextQuest.completed = true;
    const id = `quest:${actionDay}:${questId}`;
    next.rewardGrants[id] = { id, kind: 'coins', amount: quest.rewardCoins, source: 'quest-compensation' };
    next.pendingCoinGrants[id] = quest.rewardCoins;
    if (nextInstance.quests.every((item) => item.completed) && !nextInstance.claimedAll) {
      nextInstance.allCompleted = true;
      nextInstance.claimedAll = true;
      const allId = `quest:${actionDay}:all`;
      const amount = nextInstance.allRewardCoins ?? 10;
      next.rewardGrants[allId] = { id: allId, kind: 'coins', amount, source: 'quest' };
      next.pendingCoinGrants[allId] = amount;
    }
    const timed = captureRetentionMilestoneTimes(get(), next, Date.now(), typeof isAnalyticsCollectionEnabled === 'function' && isAnalyticsCollectionEnabled());
    persist(timed);
    set(timed);
    return true;
  },
}));

export function recordCompletion(action: CompletionAction): { accepted: boolean; effects: RewardGrant[] } {
  return useRetention.getState().recordCompletion(action);
}

export function recordWord(action: WordAction): { accepted: boolean; effects: RewardGrant[] } {
  return useRetention.getState().recordWord(action);
}

export function reconcileRewards(applyCoinOnce: (effectId: string, amount: number) => boolean): number {
  return useRetention.getState().reconcileRewards(applyCoinOnce);
}
