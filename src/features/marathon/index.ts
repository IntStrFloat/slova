import { create } from 'zustand';

import { MARATHON } from '@/core/config/marathon';
import { storage } from '@/core/storage';
import type { RetentionSnapshot, RewardGrant } from '@/features/retention/model';

import {
  isMarathonCompletionKey, makeInitialMarathonSnapshot, marathonFinalRewardId,
  marathonStageRewardId, reduceMarathonCompletion, reduceMarathonRecovery,
  type MarathonCompletionAction, type MarathonSnapshot,
} from './model';

export { MARATHON } from '@/core/config/marathon';
export * from './model';
export * from './selectors';

export const MARATHON_STORAGE_KEYS = { primary: 'marathon.v1', backup: 'marathon.v1.backup' } as const;

type CompletionProof = Pick<RetentionSnapshot, 'campaignCompletions' | 'dailyCompletions'>;
type Result = { accepted: boolean; effects: RewardGrant[] };

function isMap(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Validate progress and its reward ledger together before restoring pending rewards. */
export function decodeMarathonSnapshot(raw: string | null): MarathonSnapshot | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isMap(value) || value.version !== 1 || value.eventId !== MARATHON.id
      || !isMap(value.completions) || !isMap(value.rewardGrants)
      || !isMap(value.completionEffectIds) || !isMap(value.pendingCoinGrants)
      || !Array.isArray(value.claimedTiers)) return null;
    for (const [key, day] of Object.entries(value.completions)) {
      if (typeof day !== 'string' || !isMarathonCompletionKey(key, day)) return null;
    }
    const reached = MARATHON.thresholds.filter((target) => Object.keys(value.completions as object).length >= target);
    if (value.claimedTiers.length !== reached.length
      || new Set(value.claimedTiers).size !== reached.length
      || reached.some((target) => !(value.claimedTiers as unknown[]).includes(target))) return null;
    const rewards = new Map(reached.map((target) => [marathonStageRewardId(target), MARATHON.stageCoins as number]));
    if (reached.includes(MARATHON.thresholds[MARATHON.thresholds.length - 1])) {
      rewards.set(marathonFinalRewardId(), MARATHON.finalBonusCoins);
    }
    if (Object.keys(value.rewardGrants).length !== rewards.size) return null;
    for (const [id, amount] of rewards) {
      const reward = value.rewardGrants[id];
      if (!isMap(reward) || reward.id !== id || reward.kind !== 'coins'
        || reward.amount !== amount || reward.source !== 'marathon') return null;
    }
    for (const [id, amount] of Object.entries(value.pendingCoinGrants)) {
      if (rewards.get(id) !== amount) return null;
    }
    const completionIds = Object.keys(value.completions);
    if (Object.keys(value.completionEffectIds).length !== completionIds.length) return null;
    const allEffectIds = new Set<string>();
    for (const [key, ids] of Object.entries(value.completionEffectIds)) {
      if (!completionIds.includes(key) || !Array.isArray(ids) || new Set(ids).size !== ids.length) return null;
      for (const id of ids) {
        if (typeof id !== 'string' || !rewards.has(id) || allEffectIds.has(id)) return null;
        allEffectIds.add(id);
      }
    }
    if (allEffectIds.size !== rewards.size) return null;
    return value as unknown as MarathonSnapshot;
  } catch {
    return null;
  }
}

function writeVerified(key: string, serialized: string): void {
  storage.set(key, serialized);
  if (storage.getString(key) !== serialized) throw new Error('Marathon save is not durable yet');
}

export function loadMarathonSnapshot(): MarathonSnapshot {
  // Use MMKV directly: read errors must not be treated as a new profile.
  const primaryRaw = storage.getString(MARATHON_STORAGE_KEYS.primary) ?? null;
  const primary = decodeMarathonSnapshot(primaryRaw);
  if (primary) return primary;
  const backupRaw = storage.getString(MARATHON_STORAGE_KEYS.backup) ?? null;
  const backup = decodeMarathonSnapshot(backupRaw);
  if (backup) {
    writeVerified(MARATHON_STORAGE_KEYS.primary, JSON.stringify(backup));
    return backup;
  }
  if (primaryRaw !== null || backupRaw !== null) {
    throw new Error('Marathon save is unreadable; preserving it for recovery');
  }
  return makeInitialMarathonSnapshot();
}

function saved(state: MarathonState): MarathonSnapshot {
  const { version, eventId, completions, claimedTiers, rewardGrants, completionEffectIds, pendingCoinGrants } = state;
  return { version, eventId, completions, claimedTiers, rewardGrants, completionEffectIds, pendingCoinGrants };
}

function persist(snapshot: MarathonSnapshot): void {
  const previous = storage.getString(MARATHON_STORAGE_KEYS.primary) ?? null;
  if (previous !== null && !decodeMarathonSnapshot(previous)) {
    throw new Error('Marathon save is unreadable; preserving it for recovery');
  }
  writeVerified(MARATHON_STORAGE_KEYS.backup, previous ?? JSON.stringify(makeInitialMarathonSnapshot()));
  writeVerified(MARATHON_STORAGE_KEYS.primary, JSON.stringify(snapshot));
}

interface MarathonActions {
  recordCompletion: (action: MarathonCompletionAction, retention: CompletionProof) => Result;
  recoverProgress: (retention: CompletionProof) => Result;
  /** False means the trusted wallet already contains the stable reward ID. */
  reconcileRewards: (applyCoinOnce: (id: string, amount: number) => boolean) => number;
}

export type MarathonState = MarathonSnapshot & MarathonActions;

export const useMarathon = create<MarathonState>((set, get) => ({
  ...loadMarathonSnapshot(),
  recordCompletion: (action, retention) => {
    const result = reduceMarathonCompletion(saved(get()), action, retention);
    if (result.accepted) {
      persist(result.snapshot);
      set(result.snapshot);
    }
    return { accepted: result.accepted, effects: result.effects };
  },
  recoverProgress: (retention) => {
    const result = reduceMarathonRecovery(saved(get()), retention);
    if (result.accepted) {
      persist(result.snapshot);
      set(result.snapshot);
    }
    return { accepted: result.accepted, effects: result.effects };
  },
  reconcileRewards: (applyCoinOnce) => {
    let reconciled = 0;
    for (const [id, amount] of Object.entries(get().pendingCoinGrants)) {
      applyCoinOnce(id, amount);
      const current = saved(get());
      const next = { ...current, pendingCoinGrants: { ...current.pendingCoinGrants } };
      delete next.pendingCoinGrants[id];
      persist(next);
      set(next);
      reconciled += 1;
    }
    return reconciled;
  },
}));

export function recordMarathonCompletion(action: MarathonCompletionAction, retention: CompletionProof): Result {
  return useMarathon.getState().recordCompletion(action, retention);
}

export function recoverMarathonProgress(retention: CompletionProof): Result {
  return useMarathon.getState().recoverProgress(retention);
}

export function reconcileMarathonRewards(applyCoinOnce: (id: string, amount: number) => boolean): number {
  return useMarathon.getState().reconcileRewards(applyCoinOnce);
}
