import { create } from 'zustand';

import { MARATHON } from '@/core/config/marathon';
import { storage } from '@/core/storage';
import { isAnalyticsCollectionEnabled, trackOnce } from '@/features/analytics';
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
    for (const name of ['completionTimes', 'milestoneTimes', 'grantedTimes'] as const) {
      const times = value[name];
      if (times !== undefined && (!isMap(times) || Object.values(times).some((time) =>
        typeof time !== 'number' || !Number.isFinite(time) || time < 0))) return null;
    }
    if (value.terminalStatus !== undefined) {
      const terminal = value.terminalStatus;
      if (!isMap(terminal) || !['expired', 'completed'].includes(String(terminal.result))
        || !Number.isSafeInteger(terminal.revision) || (terminal.revision as number) < 1
        || !Number.isSafeInteger(terminal.progress) || (terminal.progress as number) < 0
        || terminal.occurredAtMs !== undefined && (typeof terminal.occurredAtMs !== 'number' || !Number.isFinite(terminal.occurredAtMs))) return null;
    }
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
  const { version, eventId, completions, claimedTiers, rewardGrants, completionEffectIds, pendingCoinGrants, completionTimes, milestoneTimes, grantedTimes, terminalStatus, analyticsSuppressed } = state;
  return { version, eventId, completions, claimedTiers, rewardGrants, completionEffectIds, pendingCoinGrants, completionTimes, milestoneTimes, grantedTimes, terminalStatus, analyticsSuppressed };
}

function persist(snapshot: MarathonSnapshot): void {
  const previous = storage.getString(MARATHON_STORAGE_KEYS.primary) ?? null;
  if (previous !== null && !decodeMarathonSnapshot(previous)) {
    throw new Error('Marathon save is unreadable; preserving it for recovery');
  }
  writeVerified(MARATHON_STORAGE_KEYS.backup, previous ?? JSON.stringify(makeInitialMarathonSnapshot()));
  writeVerified(MARATHON_STORAGE_KEYS.primary, JSON.stringify(snapshot));
}

function withMarathonAnalyticsPolicy(snapshot: MarathonSnapshot): MarathonSnapshot {
  if (typeof isAnalyticsCollectionEnabled === 'function' && isAnalyticsCollectionEnabled()) return snapshot;
  const keys = [
    ...Object.keys(snapshot.completions).map((key) => `marathon_progressed:${snapshot.eventId}:${key}`),
    ...snapshot.claimedTiers.map((tier) => `marathon_milestone_reached:${snapshot.eventId}:${tier}`),
    ...Object.keys(snapshot.rewardGrants).filter((id) => snapshot.pendingCoinGrants[id] === undefined).map((id) => `marathon_reward_granted:${id}`),
    ...(snapshot.terminalStatus ? [`marathon_finished:${snapshot.eventId}:terminal:${snapshot.terminalStatus.revision}:${snapshot.terminalStatus.result}`] : []),
  ];
  if (keys.every((key) => snapshot.analyticsSuppressed?.[key])) return snapshot;
  const suppressed = { ...snapshot.analyticsSuppressed };
  for (const key of keys) suppressed[key] = 1;
  return { ...snapshot, analyticsSuppressed: suppressed };
}

/** Late recovery can correct expiry, but never creates a second event cycle. */
function withTerminalStatus(snapshot: MarathonSnapshot, nowMs: number): MarathonSnapshot {
  const complete = snapshot.claimedTiers.includes(MARATHON.thresholds[MARATHON.thresholds.length - 1]);
  if (!complete && nowMs < MARATHON.endAtMs) return snapshot;
  const result = complete ? 'completed' : 'expired';
  if (snapshot.terminalStatus?.result === result) return snapshot;
  const at = complete ? snapshot.milestoneTimes?.[MARATHON.thresholds[MARATHON.thresholds.length - 1]] : MARATHON.endAtMs;
  return { ...snapshot, terminalStatus: { result, revision: (snapshot.terminalStatus?.revision ?? 0) + 1,
    progress: Object.keys(snapshot.completions).length, ...(Number.isFinite(at) ? { occurredAtMs: at } : {}) } };
}

export function trackMarathonFacts(snapshot: MarathonSnapshot, recovery: boolean, nowMs = Date.now()): void {
  const common = { eventInstanceId: snapshot.eventId, recovery, observedAtMs: nowMs };
  const emit = (name: string, key: string, properties: Record<string, unknown>, atMs?: number) => {
    if (snapshot.analyticsSuppressed?.[`${name}:${key}`]) return;
    try { trackOnce(name, key, { ...common, ...properties, timeKnown: Number.isFinite(atMs),
      ...(Number.isFinite(atMs) ? { occurredAtMs: atMs } : {}) }); } catch { /* domain progress is already committed */ }
  };
  let progress = 0;
  for (const [key] of Object.entries(snapshot.completions)) {
    progress += 1;
    emit('marathon_progressed', `${snapshot.eventId}:${key}`, {
      contribution_id: key, completionId: key, mode: key.startsWith('daily:') ? 'daily' : 'campaign',
      points_delta: 1, progress,
    }, snapshot.completionTimes?.[key]);
  }
  for (const threshold of snapshot.claimedTiers) {
    emit('marathon_milestone_reached', `${snapshot.eventId}:${threshold}`, {
      milestone_id: String(threshold), threshold, progress: threshold,
    }, snapshot.milestoneTimes?.[threshold]);
  }
  for (const [rewardId, grant] of Object.entries(snapshot.rewardGrants)) {
    if (snapshot.pendingCoinGrants[rewardId] !== undefined) continue;
    emit('marathon_reward_granted', rewardId, { rewardId, amount: grant.amount ?? 0,
      milestone_id: rewardId.endsWith(':finish') ? 'finish' : rewardId.split(':').pop() }, snapshot.grantedTimes?.[rewardId]);
  }
  const terminal = snapshot.terminalStatus;
  if (terminal) emit('marathon_finished', `${snapshot.eventId}:terminal:${terminal.revision}:${terminal.result}`, {
    result: terminal.result, final_status_revision: terminal.revision, final_progress: terminal.progress,
    max_progress: MARATHON.thresholds[MARATHON.thresholds.length - 1],
  }, terminal.occurredAtMs);
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
    const next = withMarathonAnalyticsPolicy(withTerminalStatus(result.snapshot, Date.now()));
    if (result.accepted || next !== result.snapshot) {
      persist(next);
      set(next);
    }
    trackMarathonFacts(next, false);
    return { accepted: result.accepted, effects: result.effects };
  },
  recoverProgress: (retention) => {
    const result = reduceMarathonRecovery(saved(get()), retention);
    const next = withMarathonAnalyticsPolicy(withTerminalStatus(result.snapshot, Date.now()));
    if (result.accepted || next !== result.snapshot) {
      persist(next);
      set(next);
    }
    trackMarathonFacts(next, true);
    return { accepted: result.accepted, effects: result.effects };
  },
  reconcileRewards: (applyCoinOnce) => {
    let reconciled = 0;
    for (const [id, amount] of Object.entries(get().pendingCoinGrants)) {
      let applied: boolean;
      try { applied = applyCoinOnce(id, amount); } catch (error) {
        try { trackOnce('reward_grant_failed', `${id}:failure`, { rewardId: id, operation_id: id,
          attempt_no: 1, source: 'marathon', reason: 'save_failed', retryable: true }); } catch { /* keep pending */ }
        throw error;
      }
      const current = saved(get());
      const next = { ...current, pendingCoinGrants: { ...current.pendingCoinGrants } };
      delete next.pendingCoinGrants[id];
      if (applied) next.grantedTimes = { ...next.grantedTimes, [id]: Date.now() };
      const prepared = withMarathonAnalyticsPolicy(next);
      persist(prepared);
      set(prepared);
      trackMarathonFacts(prepared, !applied);
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
