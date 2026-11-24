import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import { getJSON, getString, KEYS, storage } from '@/core/storage';
import { isAnalyticsCollectionEnabled, trackOnce } from '@/features/analytics';
import { type HelpAnalyticsContext, selectHelpContext } from '@/features/analytics/helpContext';

type Kind = 'coins' | 'gems';

export interface WalletTransactionRecord {
  id: string;
  currency: Kind;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  source: string;
  occurredAtMs: number;
  rewardId?: string;
  context?: HelpAnalyticsContext;
}

function operationId(): string {
  return `wallet:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
}

const TRANSACTION_SOURCES: Record<string, string> = {
  'hint-recovery': 'hint_refund', 'legacy-ticket-conversion': 'legacy_ticket_conversion',
  starter: 'starter', login_gift: 'daily_bonus', daily: 'daily', quest: 'quest', week: 'week',
  event: 'event', marathon: 'marathon', wheel: 'wheel', bonus: 'bonus_word',
  'bonus-bank': 'bonus_bank', 'rewarded-coins': 'rewarded', legacy: 'legacy',
  hint: 'hint_bulb', 'hint-refund': 'hint_refund', semantic: 'hint_semantic',
  'semantic-clue': 'hint_semantic', objective: 'objective', campaign: 'campaign',
};
const KNOWN_TRANSACTION_SOURCES = new Set([...Object.values(TRANSACTION_SOURCES), 'milestone', 'other_spend', 'other_grant']);
const PRIVATE_EFFECT_SOURCES = new Set(['hint_bulb', 'hint_semantic', 'hint_refund', 'bonus_word']);

/** Content-derived effect IDs can contain words. Only a bounded source leaves the wallet. */
function transactionSource(effectId: string | undefined, debit: boolean): string {
  const prefix = effectId?.split(':', 1)[0] ?? '';
  if (prefix === 'legacy' && effectId?.endsWith(':milestone')) return 'milestone';
  if (prefix === 'legacy' && effectId?.endsWith(':objective')) return 'objective';
  return Object.hasOwn(TRANSACTION_SOURCES, prefix) ? TRANSACTION_SOURCES[prefix] : debit ? 'other_spend' : 'other_grant';
}

function telemetryAllowed(): boolean {
  try {
    return !getJSON<{ optOut?: boolean }>(KEYS.analytics, {}).optOut
      && typeof isAnalyticsCollectionEnabled === 'function' && isAnalyticsCollectionEnabled();
  } catch { return false; }
}

function transactionContext(input?: HelpAnalyticsContext): HelpAnalyticsContext {
  try { return selectHelpContext(input); } catch { return {}; }
}

/** Optional metadata is rebuilt from known fields; damaged metadata never resets money. */
function transactionRecord(value: unknown): WalletTransactionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as WalletTransactionRecord;
  if (typeof record.id !== 'string' || !/^wallet:[a-z0-9:]+$/.test(record.id)
    || (record.currency !== 'coins' && record.currency !== 'gems')
    || !Number.isSafeInteger(record.delta) || record.delta === 0
    || !Number.isSafeInteger(record.balanceBefore) || record.balanceBefore < 0
    || !Number.isSafeInteger(record.balanceAfter) || record.balanceAfter < 0
    || record.balanceBefore + record.delta !== record.balanceAfter
    || !Number.isSafeInteger(record.occurredAtMs) || record.occurredAtMs < 0
    || !KNOWN_TRANSACTION_SOURCES.has(record.source)) return null;
  return {
    id: record.id, currency: record.currency, delta: record.delta,
    balanceBefore: record.balanceBefore, balanceAfter: record.balanceAfter,
    source: record.source, occurredAtMs: record.occurredAtMs,
    ...(!PRIVATE_EFFECT_SOURCES.has(record.source) && typeof record.rewardId === 'string'
      && /^[a-z0-9][a-z0-9_.:-]{0,95}$/i.test(record.rewardId)
      ? { rewardId: record.rewardId } : {}),
    context: transactionContext(record.context),
  };
}

function emitFailure(effectId: string | undefined, kind: Kind, delta: number, reason: string): void {
  if (!telemetryAllowed()) return;
  const id = operationId();
  try {
    trackOnce('wallet_transaction_failed', id, {
      operation_id: id, attempt_no: 1, intended_delta: delta, currency: kind,
      source: transactionSource(effectId, delta < 0), reason, retryable: reason === 'save_failed',
    });
  } catch { /* Analytics cannot change a wallet outcome. */ }
}


/** A balance and its idempotency ledger share one atomic MMKV value. */
interface WalletSnapshot {
  version: 2;
  coins: number;
  gems: number;
  newProfile: boolean;
  appliedRewards: Record<string, 1>;
  /** Pending facts are persisted atomically with balances, then acknowledged by analytics. */
  analyticsTransactions?: WalletTransactionRecord[];
  /** Private effect keys never leave this wallet. Records survive analytics acknowledgement. */
  operationTransactions?: Record<string, WalletTransactionRecord>;
  analyticsBaselineRevision?: number;
  analyticsWasDisabled?: boolean;
}

interface CurrencyState extends WalletSnapshot {
  add: (kind: Kind, n: number) => void;
  addOnce: (effectId: string, kind: Kind, n: number, context?: HelpAnalyticsContext) => boolean;
  hasApplied: (effectId: string) => boolean;
  getTransaction: (effectId: string) => WalletTransactionRecord | null;
  spend: (kind: Kind, n: number) => boolean;
  spendOnce: (effectId: string, kind: Kind, n: number, context?: HelpAnalyticsContext) => 'spent' | 'already_spent' | 'insufficient';
}

function natural(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function legacyProfileExists(): boolean {
  return [
    KEYS.levelsProgress, KEYS.collection, KEYS.gameCurrent,
    KEYS.gameCurrentNormal, KEYS.gameCurrentDaily, KEYS.dailyPuzzle,
    KEYS.profile, KEYS.onboardingDone,
  ].some((key) => getString(key) !== null);
}

function readWallet(): WalletSnapshot {
  const raw = getString(KEYS.currency);
  const oldLedger = getJSON<Record<string, number> | null>(KEYS.currencyRewardLedger, null);
  const inheritedRewards: Record<string, 1> = {};
  if (oldLedger && typeof oldLedger === 'object') {
    for (const id of Object.keys(oldLedger)) if (id) inheritedRewards[id] = 1;
  }

  if (raw !== null) {
    let parsed: Partial<WalletSnapshot>;
    try {
      parsed = JSON.parse(raw) as Partial<WalletSnapshot>;
      if (!parsed || typeof parsed !== 'object' || !Number.isSafeInteger(parsed.coins) || (parsed.coins ?? 0) < 0) {
        throw new Error('Invalid wallet');
      }
    } catch {
      const backup = getString(KEYS.currencyBackup);
      try {
        parsed = JSON.parse(backup ?? '') as Partial<WalletSnapshot>;
        if (!parsed || typeof parsed !== 'object' || !Number.isSafeInteger(parsed.coins) || (parsed.coins ?? 0) < 0) {
          throw new Error('Invalid backup');
        }
      } catch {
        throw new Error('Wallet save is unreadable; preserving it for recovery');
      }
    }
    const appliedRewards = { ...inheritedRewards };
    if (parsed.appliedRewards && typeof parsed.appliedRewards === 'object') {
      for (const id of Object.keys(parsed.appliedRewards)) if (id) appliedRewards[id] = 1;
    }
    const operationTransactions: Record<string, WalletTransactionRecord> = {};
    if (parsed.operationTransactions && typeof parsed.operationTransactions === 'object'
      && !Array.isArray(parsed.operationTransactions)) {
      for (const [effectId, value] of Object.entries(parsed.operationTransactions)) {
        const record = transactionRecord(value);
        if (record && Object.hasOwn(appliedRewards, effectId)) operationTransactions[effectId] = record;
      }
    }
    return {
      version: 2,
      coins: natural(parsed.coins),
      gems: natural(parsed.gems),
      newProfile: parsed.version === 2 && parsed.newProfile === true,
      appliedRewards,
      operationTransactions,
      analyticsBaselineRevision: natural(parsed.analyticsBaselineRevision),
      analyticsWasDisabled: parsed.analyticsWasDisabled === true,
      analyticsTransactions: Array.isArray(parsed.analyticsTransactions) ? parsed.analyticsTransactions
        .map(transactionRecord).filter((value): value is WalletTransactionRecord => value !== null) : [],
    };
  }

  const newProfile = !legacyProfileExists();
  return {
    version: 2,
    coins: newProfile ? ECONOMY.starterCoins : 0,
    gems: 0,
    newProfile,
    appliedRewards: newProfile ? { ...inheritedRewards, 'starter:coins': 1 } : inheritedRewards,
  };
}

function persist(wallet: WalletSnapshot): void {
  // MMKV synchronously replaces one value. Throw on write failure so callers
  // never announce a grant or debit that only existed in memory.
  const previous = getString(KEYS.currency);
  if (previous) {
    try {
      const parsed = JSON.parse(previous) as Partial<WalletSnapshot>;
      if (Number.isSafeInteger(parsed?.coins) && (parsed.coins ?? 0) >= 0) {
        storage.set(KEYS.currencyBackup, previous);
      }
    } catch { /* Keep the last valid backup. */ }
  }
  const serialized = JSON.stringify(wallet);
  storage.set(KEYS.currency, serialized);
  if (storage.getString(KEYS.currency) !== serialized) throw new Error('Wallet save is not durable yet');
}

const isFreshWallet = getString(KEYS.currency) === null;
const initial = readWallet();
if (isFreshWallet && initial.newProfile && initial.coins > 0 && telemetryAllowed()) {
  initial.analyticsTransactions = [{ id: operationId(), currency: 'coins', delta: initial.coins,
    balanceBefore: 0, balanceAfter: initial.coins, source: 'starter', occurredAtMs: Date.now(), rewardId: 'starter:coins' }];
  initial.operationTransactions = { 'starter:coins': initial.analyticsTransactions[0] };
}
persist(initial);

function withTransaction(current: WalletSnapshot, next: WalletSnapshot, kind: Kind, delta: number,
  effectId?: string, context?: HelpAnalyticsContext): WalletSnapshot {
  if (!telemetryAllowed()) return { ...next, analyticsTransactions: [], operationTransactions: {}, analyticsWasDisabled: true };
  const source = transactionSource(effectId, delta < 0);
  const transaction: WalletTransactionRecord = {
    id: operationId(), currency: kind, delta, balanceBefore: current[kind], balanceAfter: next[kind],
    source, occurredAtMs: Date.now(),
    ...(!PRIVATE_EFFECT_SOURCES.has(source) && effectId && /^[a-z0-9][a-z0-9_.:-]{0,95}$/i.test(effectId)
      ? { rewardId: effectId } : {}),
    context: transactionContext(context),
  };
  return { ...next, analyticsTransactions: [...(current.analyticsTransactions ?? []), transaction],
    ...(effectId ? { operationTransactions: { ...current.operationTransactions, [effectId]: transaction } } : {}) };
}

function commit(current: WalletSnapshot, next: WalletSnapshot, kind: Kind, delta: number,
  effectId?: string, context?: HelpAnalyticsContext): WalletSnapshot {
  const prepared = withTransaction(current, next, kind, delta, effectId, context);
  try { persist(prepared); } catch (error) {
    emitFailure(effectId, kind, delta, 'save_failed');
    throw error;
  }
  return prepared;
}


function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export const useCurrency = create<CurrencyState>((set, get) => ({
  ...initial,
  add: (kind, n) => {
    if (!positiveInteger(n)) return;
    const next = { ...get(), [kind]: get()[kind] + n };
    if (!Number.isSafeInteger(next[kind])) return;
    set(commit(get(), next, kind, n));
    flushWalletAnalytics();
  },
  addOnce: (effectId, kind, n, context) => {
    if (!effectId || !positiveInteger(n)) return false;
    const current = get();
    if (current.appliedRewards[effectId]) return false;
    const balance = current[kind] + n;
    if (!Number.isSafeInteger(balance)) return false;
    const next: WalletSnapshot = {
      ...current,
      [kind]: balance,
      appliedRewards: { ...current.appliedRewards, [effectId]: 1 },
    };
    set(commit(current, next, kind, n, effectId, context));
    flushWalletAnalytics();
    return true;
  },
  hasApplied: (effectId) => Boolean(get().appliedRewards[effectId]),
  getTransaction: (effectId) => {
    const records = get().operationTransactions;
    return records && Object.hasOwn(records, effectId) ? transactionRecord(records[effectId]) : null;
  },
  spend: (kind, n) => {
    if (!positiveInteger(n)) return false;
    if (get()[kind] < n) { emitFailure(undefined, kind, -n, 'insufficient'); return false; }
    const next = { ...get(), [kind]: get()[kind] - n };
    set(commit(get(), next, kind, -n));
    flushWalletAnalytics();
    return true;
  },
  spendOnce: (effectId, kind, n, context) => {
    if (!effectId || !positiveInteger(n)) return 'insufficient';
    const current = get();
    if (current.appliedRewards[effectId]) return 'already_spent';
    if (current[kind] < n) { emitFailure(effectId, kind, -n, 'insufficient'); return 'insufficient'; }
    const next: WalletSnapshot = {
      ...current,
      [kind]: current[kind] - n,
      appliedRewards: { ...current.appliedRewards, [effectId]: 1 },
    };
    set(commit(current, next, kind, -n, effectId, context));
    flushWalletAnalytics();
    return 'spent';
  },
}));

/** Retry a committed fact after restart without granting its money again. */
export function flushWalletAnalytics(source: 'bootstrap' | 'analytics_enabled' = 'bootstrap'): void {
  let current = useCurrency.getState();
  if (!telemetryAllowed()) {
    if (current.analyticsTransactions?.length || Object.keys(current.operationTransactions ?? {}).length || !current.analyticsWasDisabled) {
      const cleared = { ...current, analyticsTransactions: [], operationTransactions: {}, analyticsWasDisabled: true };
      try { persist(cleared); useCurrency.setState(cleared); } catch { /* retry on next wallet operation */ }
    }
    return;
  }
  if (current.analyticsWasDisabled) {
    const next = { ...current, analyticsWasDisabled: false,
      analyticsBaselineRevision: (current.analyticsBaselineRevision ?? 0) + 1 };
    try { persist(next); useCurrency.setState(next); current = useCurrency.getState(); } catch { return; }
  }
  const balanceWindow = `opening:coins:${current.analyticsBaselineRevision ?? 0}`;
  try {
    trackOnce('wallet_balance_observed', balanceWindow, { balance: current.coins, currency: 'coins',
      source, window_id: balanceWindow });
  } catch { /* optional balance observation cannot block money */ }
  for (const transaction of current.analyticsTransactions ?? []) {
    try {
      const accepted = trackOnce('wallet_transaction', transaction.id, {
        ...transactionContext(transaction.context),
        transaction_id: transaction.id, currency: transaction.currency, delta: transaction.delta,
        balance_before: transaction.balanceBefore, balance_after: transaction.balanceAfter,
        source: transaction.delta > 0 ? transaction.source : 'none',
        sink: transaction.delta < 0 ? transaction.source : 'none',
        occurredAtMs: transaction.occurredAtMs, ...(transaction.rewardId ? { rewardId: transaction.rewardId } : {}),
      });
      if (!accepted) return;
      const state = useCurrency.getState();
      const next = { ...state, analyticsTransactions: state.analyticsTransactions?.filter((value) => value.id !== transaction.id) ?? [] };
      persist(next);
      useCurrency.setState(next);
    } catch { return; }
  }
}
