import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import { getJSON, getString, KEYS, storage } from '@/core/storage';

type Kind = 'coins' | 'gems';

/** A balance and its idempotency ledger share one atomic MMKV value. */
interface WalletSnapshot {
  version: 2;
  coins: number;
  gems: number;
  newProfile: boolean;
  appliedRewards: Record<string, 1>;
}

interface CurrencyState extends WalletSnapshot {
  add: (kind: Kind, n: number) => void;
  addOnce: (effectId: string, kind: Kind, n: number) => boolean;
  hasApplied: (effectId: string) => boolean;
  spend: (kind: Kind, n: number) => boolean;
  spendOnce: (effectId: string, kind: Kind, n: number) => 'spent' | 'already_spent' | 'insufficient';
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
    return {
      version: 2,
      coins: natural(parsed.coins),
      gems: natural(parsed.gems),
      newProfile: parsed.version === 2 && parsed.newProfile === true,
      appliedRewards,
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
  storage.set(KEYS.currency, JSON.stringify(wallet));
}

const initial = readWallet();
persist(initial);

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export const useCurrency = create<CurrencyState>((set, get) => ({
  ...initial,
  add: (kind, n) => {
    if (!positiveInteger(n)) return;
    const next = { ...get(), [kind]: get()[kind] + n };
    if (!Number.isSafeInteger(next[kind])) return;
    persist(next);
    set(next);
  },
  addOnce: (effectId, kind, n) => {
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
    persist(next);
    set(next);
    return true;
  },
  hasApplied: (effectId) => Boolean(get().appliedRewards[effectId]),
  spend: (kind, n) => {
    if (!positiveInteger(n) || get()[kind] < n) return false;
    const next = { ...get(), [kind]: get()[kind] - n };
    persist(next);
    set(next);
    return true;
  },
  spendOnce: (effectId, kind, n) => {
    if (!effectId || !positiveInteger(n)) return 'insufficient';
    const current = get();
    if (current.appliedRewards[effectId]) return 'already_spent';
    if (current[kind] < n) return 'insufficient';
    const next: WalletSnapshot = {
      ...current,
      [kind]: current[kind] - n,
      appliedRewards: { ...current.appliedRewards, [effectId]: 1 },
    };
    persist(next);
    set(next);
    return 'spent';
  },
}));
