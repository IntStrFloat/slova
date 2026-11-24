import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import { mulberry32 } from '@/core/engine/rng';
import { getJSON, KEYS, storage } from '@/core/storage';
import { trackOnce } from '@/features/analytics';
import { selectHelpContext } from '@/features/analytics/helpContext';
import type { WalletTransactionRecord } from '@/features/currency';
import { dayKey } from '@/core/time';
import type { NativeRewardReceipt } from '@/features/monetization/nativeRewardJournal';

const SECTORS = ECONOMY.wheel.sectors;

export interface PendingWheelSpin {
  effectId: string;
  sector: number;
  value: number;
  createdAtMs?: number;
  viaRewarded?: boolean;
  opportunityId?: string;
  requestId?: string;
  flowContext?: Record<string, unknown>;
}

export interface WheelState {
  day: string | null;
  freeUsed: boolean;
  rewardedUsed: number;
  pendingSpin?: PendingWheelSpin | null;
  /** Frozen before show; this is an intention, never evidence that an ad was earned. */
  preparedReward?: NativeRewardReceipt | null;
  grantedSpins?: Record<string, 1>;
  lastGrantedSpin?: PendingWheelSpin | null;
}

function rollover(state: WheelState, today: string): WheelState {
  if (state.day === today) return state;
  return { ...state, day: today, freeUsed: false, rewardedUsed: 0, pendingSpin: state.pendingSpin ?? null };
}

/** Чистый редьюсер: совершить вращение (free | rewarded). */
export function spinWheel(
  state: WheelState,
  today: string,
  viaRewarded: boolean,
  rngSeed: number,
): { state: WheelState } & PendingWheelSpin | { state: WheelState; error: string } {
  const s = rollover(state, today);
  if (s.pendingSpin) return { state: s, error: 'pending_spin' };
  if (!viaRewarded) {
    if (s.freeUsed) return { state: s, error: 'no_free_spin' };
  } else if (s.rewardedUsed >= ECONOMY.wheel.maxRewardedSpins) {
    return { state: s, error: 'no_rewarded_spins' };
  }
  const sector = Math.floor(mulberry32(rngSeed)() * SECTORS.length) % SECTORS.length;
  const pendingSpin: PendingWheelSpin = {
    effectId: viaRewarded ? `wheel:${today}:rewarded:${s.rewardedUsed + 1}` : `wheel:${today}:free`,
    sector,
    value: SECTORS[sector],
  };
  const next: WheelState = viaRewarded
    ? { ...s, rewardedUsed: s.rewardedUsed + 1, pendingSpin }
    : { ...s, freeUsed: true, pendingSpin };
  return { state: next, ...pendingSpin };
}

interface Store extends WheelState {
  canFree: () => boolean;
  rewardedLeft: () => number;
  spin: (viaRewarded: boolean, observation?: { opportunityId: string; requestId: string }, flowContext?: Record<string, unknown>) => PendingWheelSpin | null;
  prepareRewarded: (flowContext?: Record<string, unknown>) => NativeRewardReceipt | null;
  confirmRewarded: (receipt: NativeRewardReceipt, observation?: { opportunityId: string; requestId: string }, callbackAtMs?: number) => boolean;
  releasePrepared: (rewardId: string) => void;
  claimPending: (effectId: string, grant?: WalletTransactionRecord | null) => boolean;
  reset: () => void;
}

function persist(state: WheelState): void {
  const value = JSON.stringify(state);
  storage.set(KEYS.wheel, value);
  if (storage.getString(KEYS.wheel) !== value) throw new Error('Wheel save is not durable yet');
}

function trackSpin(spin: PendingWheelSpin, stage: 'saved' | 'granted', grant?: WalletTransactionRecord | null): void {
  try {
    const context = selectHelpContext(spin.flowContext);
    const knownEarned = Number.isSafeInteger(spin.createdAtMs) && (spin.createdAtMs ?? -1) >= 0;
    const knownGrant = grant && grant.currency === 'coins' && grant.delta > 0
      && Number.isSafeInteger(grant.occurredAtMs) && grant.occurredAtMs >= 0 ? grant : null;
    if (stage === 'saved') trackOnce('wheel_spin_started', spin.effectId, {
      ...context,
      spin_id: spin.effectId, free_or_rewarded: spin.viaRewarded ? 'rewarded' : 'free',
      free_remaining: useWheel.getState().freeUsed ? 0 : 1,
      rewarded_remaining: Math.max(0, ECONOMY.wheel.maxRewardedSpins - useWheel.getState().rewardedUsed),
      opportunity_id: spin.opportunityId, request_id: spin.requestId,
      ...(knownEarned ? { occurredAtMs: spin.createdAtMs } : {}), timeKnown: knownEarned,
    });
    trackOnce('wheel_spin_result', `${spin.effectId}:${stage}`, {
      ...context, free_or_rewarded: spin.viaRewarded ? 'rewarded' : 'free',
      opportunity_id: spin.opportunityId, request_id: spin.requestId,
      spin_id: spin.effectId, result_revision: stage === 'saved' ? 1 : 2, outcome_type: 'coins',
      amount: spin.value, rewardId: spin.effectId, grant_state: stage === 'saved' ? 'pending' : 'granted',
      ...(stage === 'saved' ? { ...(knownEarned ? { occurredAtMs: spin.createdAtMs } : {}),
        timeKnown: knownEarned } : {
        recovery: true,
        timeKnown: knownGrant !== null,
        ...(knownGrant ? { occurredAtMs: knownGrant.occurredAtMs, transaction_id: knownGrant.id } : {}),
      }),
    });
  } catch { /* A telemetry fault cannot interrupt a committed spin. */ }
}

const init = getJSON<WheelState>(KEYS.wheel, { day: null, freeUsed: false, rewardedUsed: 0 });

export const useWheel = create<Store>((set, get) => ({
  ...init,
  canFree: () => {
    const s = rollover({ day: get().day, freeUsed: get().freeUsed, rewardedUsed: get().rewardedUsed, pendingSpin: get().pendingSpin }, dayKey());
    return !s.freeUsed && !s.pendingSpin;
  },
  rewardedLeft: () => {
    const s = rollover({ day: get().day, freeUsed: get().freeUsed, rewardedUsed: get().rewardedUsed, pendingSpin: get().pendingSpin }, dayKey());
    return s.pendingSpin ? 0 : ECONOMY.wheel.maxRewardedSpins - s.rewardedUsed;
  },
  spin: (viaRewarded, observation, flowContext) => {
    // Rewarded spins must enter through the earned receipt path below.
    if (viaRewarded || get().preparedReward) return null;
    const res = spinWheel(
      { ...get() },
      dayKey(),
      viaRewarded,
      (Date.now() & 0xffffffff) >>> 0,
    );
    if ('error' in res) return null;
    const pending: PendingWheelSpin = { effectId: res.effectId, value: res.value, sector: res.sector,
      createdAtMs: Date.now(), viaRewarded, ...(observation ?? {}), ...(flowContext ? { flowContext: { ...flowContext } } : {}) };
    const next = { ...res.state, pendingSpin: pending };
    persist(next);
    set(next);
    trackSpin(pending, 'saved');
    return pending;
  },
  prepareRewarded: (flowContext) => {
    if (get().pendingSpin || get().preparedReward || get().rewardedLeft() <= 0) return null;
    const now = Date.now();
    const sector = Math.floor(mulberry32((now & 0xffffffff) >>> 0)() * SECTORS.length) % SECTORS.length;
    const receipt: NativeRewardReceipt = { version: 1, kind: 'wheel',
      rewardId: `wheel:${dayKey()}:rewarded:${now.toString(36)}:${Math.random().toString(36).slice(2, 10)}`,
      createdAtMs: now, offerDay: dayKey(), sector, amount: SECTORS[sector],
      ...(flowContext ? { flowContext: { ...flowContext } } : {}) };
    const next = { ...rollover(get(), dayKey()), preparedReward: receipt };
    persist(next);
    set(next);
    return receipt;
  },
  confirmRewarded: (receipt, observation, callbackAtMs) => {
    if (receipt.kind !== 'wheel' || receipt.sector === undefined || SECTORS[receipt.sector] !== receipt.amount) return false;
    if (get().grantedSpins?.[receipt.rewardId]) return true;
    if (get().pendingSpin) return get().pendingSpin?.effectId === receipt.rewardId;
    const current = rollover(get(), dayKey());
    const occurredAtMs = receipt.earnedAtMs ?? callbackAtMs;
    const pending: PendingWheelSpin = { effectId: receipt.rewardId, sector: receipt.sector,
      value: receipt.amount, ...(Number.isSafeInteger(occurredAtMs) && (occurredAtMs ?? -1) >= 0 ? { createdAtMs: occurredAtMs } : {}),
      viaRewarded: true, ...(observation ?? {}),
      ...(receipt.flowContext ? { flowContext: { ...receipt.flowContext } } : {}) };
    const next = { ...current, pendingSpin: pending, preparedReward: null,
      rewardedUsed: current.rewardedUsed + Number(receipt.offerDay === current.day) };
    persist(next);
    set(next);
    trackSpin(pending, 'saved');
    return true;
  },
  releasePrepared: (rewardId) => {
    if (get().preparedReward?.rewardId !== rewardId) return;
    const next = { ...get(), preparedReward: null };
    persist(next);
    set(next);
  },
  claimPending: (effectId, grant) => {
    if (!effectId || get().pendingSpin?.effectId !== effectId) return false;
    const pending = get().pendingSpin!;
    const next = { ...get(), pendingSpin: null, lastGrantedSpin: pending,
      grantedSpins: { ...get().grantedSpins, [effectId]: 1 as const } };
    persist(next);
    set(next);
    trackSpin(pending, 'granted', grant);
    return true;
  },
  reset: () => {
    const s = { day: null, freeUsed: false, rewardedUsed: 0, pendingSpin: null, preparedReward: null, grantedSpins: {}, lastGrantedSpin: null };
    persist(s);
    set(s);
  },
}));
