import { create } from 'zustand';

import { totalCampaignLevels, WORLDS } from '@/core/config/worlds';
import { getJSON, setJSON } from '@/core/storage';
import { useCurrency } from '@/features/currency';

const PROGRESSION_STORAGE_KEY = 'progression.milestones.v1';
// Every ordinary gift pays for at least one 50-coin letter hint.
const BASE_MILESTONE_REWARD = 50;
const WORLD_FINALE_REWARD = 75;
const CAMPAIGN_FINALE_REWARD = 150;
// Keep the reward promised at the original end of chapter one after expansion.
const PREVIOUS_CHAPTER_FINALES = new Set([500]);

interface ProgressionSaved {
  claimAmountsByKey: Record<string, number>;
  claimedLevelRewards: Record<string, number>;
}

interface ProgressionState extends ProgressionSaved {
  claimMilestoneReward: (completionId: string, levelId: number) => number;
  reset: () => void;
}

const WORLD_FINALES = new Set(WORLDS.map((world) => world.endsAt));
const CHEST_LEVELS = Array.from(
  { length: Math.floor(totalCampaignLevels() / 10) },
  (_, index) => (index + 1) * 10,
);

export interface GiftProgress {
  targetLevel: number;
  completedLevel: number;
  amountCoins: number;
  previousLevel: number;
  nextGiftLevel: number;
  remaining: number;
  amount: number;
  previousGiftLevel: number;
  completedInStep: number;
  stepLevels: number;
  fraction: number;
}

/** Pure countdown for the result and home surfaces after an absolute campaign level. */
export function giftProgress(completedLevel: number): GiftProgress | null {
  const level = Number.isFinite(completedLevel)
    ? Math.max(0, Math.min(totalCampaignLevels(), Math.trunc(completedLevel)))
    : 0;
  const nextGiftLevel = CHEST_LEVELS.find((milestone) => milestone > level);
  if (nextGiftLevel == null) return null;
  const previousGiftLevel = nextGiftLevel - 10;
  const completedInStep = level - previousGiftLevel;
  const amountCoins = milestoneRewardForLevel(nextGiftLevel);
  return {
    targetLevel: nextGiftLevel,
    completedLevel: level,
    amountCoins,
    previousLevel: previousGiftLevel,
    nextGiftLevel,
    remaining: nextGiftLevel - level,
    amount: amountCoins,
    previousGiftLevel,
    completedInStep,
    stepLevels: 10,
    fraction: completedInStep / 10,
  };
}

function sanitizeNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const sanitized: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value as Record<string, unknown>)) {
    if (!key || !Number.isFinite(amount)) continue;
    sanitized[key] = Math.max(0, Math.trunc(amount as number));
  }
  return sanitized;
}

function sanitizeSaved(value: ProgressionSaved | null | undefined): ProgressionSaved {
  const claimAmountsByKey = sanitizeNumberMap(value?.claimAmountsByKey);
  const claimedLevelRewards = sanitizeNumberMap(value?.claimedLevelRewards);
  for (const levelId of Object.keys(claimedLevelRewards)) {
    const numericLevelId = Number(levelId);
    if (!Number.isInteger(numericLevelId) || !isMilestoneLevel(numericLevelId)) {
      delete claimedLevelRewards[levelId];
    }
  }
  return { claimAmountsByKey, claimedLevelRewards };
}

function persist(state: ProgressionSaved): void {
  setJSON(PROGRESSION_STORAGE_KEY, state);
}

function claimKeyFor(completionId: string, levelId: number): string {
  return `${completionId}:milestone:${levelId}`;
}

export function isMilestoneLevel(levelId: number): boolean {
  return Number.isInteger(levelId) && levelId > 0 && levelId <= totalCampaignLevels() && levelId % 10 === 0;
}

export function milestoneRewardForLevel(levelId: number): number {
  if (!isMilestoneLevel(levelId)) return 0;
  if (levelId === totalCampaignLevels() || PREVIOUS_CHAPTER_FINALES.has(levelId)) return CAMPAIGN_FINALE_REWARD;
  if (WORLD_FINALES.has(levelId)) return WORLD_FINALE_REWARD;
  return BASE_MILESTONE_REWARD;
}

export function isMilestoneClaimed(levelId: number): boolean {
  return useProgression.getState().claimedLevelRewards[String(levelId)] != null;
}

export function nearestMilestoneLevel(levelId: number): number | null {
  const progress = Number.isFinite(levelId) ? Math.max(1, Math.trunc(levelId)) : 1;
  const claimedLevelRewards = useProgression.getState().claimedLevelRewards;
  for (const chestLevel of CHEST_LEVELS) {
    if (claimedLevelRewards[String(chestLevel)] != null) continue;
    if (chestLevel >= progress) return chestLevel;
  }
  return null;
}

const init = sanitizeSaved(getJSON<ProgressionSaved | null>(PROGRESSION_STORAGE_KEY, null));

export const useProgression = create<ProgressionState>((set, get) => ({
  ...init,
  claimMilestoneReward: (completionId, levelId) => {
    if (!completionId) return 0;
    const normalizedLevelId = Math.trunc(levelId);
    const claimKey = claimKeyFor(completionId, normalizedLevelId);
    const existingAmount = get().claimAmountsByKey[claimKey];
    if (existingAmount != null) return existingAmount;
    if (!isMilestoneLevel(normalizedLevelId)) return 0;

    const levelKey = String(normalizedLevelId);
    if (get().claimedLevelRewards[levelKey] != null) {
      const next = {
        claimAmountsByKey: {
          ...get().claimAmountsByKey,
          [claimKey]: 0,
        },
        claimedLevelRewards: get().claimedLevelRewards,
      };
      set(next);
      persist(next);
      return 0;
    }

    const amount = milestoneRewardForLevel(normalizedLevelId);
    const next = {
      claimAmountsByKey: {
        ...get().claimAmountsByKey,
        [claimKey]: amount,
      },
      claimedLevelRewards: {
        ...get().claimedLevelRewards,
        [levelKey]: amount,
      },
    };
    set(next);
    persist(next);
    return amount;
  },
  reset: () => {
    const fresh = { claimAmountsByKey: {}, claimedLevelRewards: {} };
    set(fresh);
    persist(fresh);
  },
}));

export function claimMilestoneReward(completionId: string, levelId: number): number {
  return useProgression.getState().claimMilestoneReward(completionId, levelId);
}

/** Restore unpaid gifts for profiles that passed chest levels before intro parity. */
export function backfillCompletedChestCoins(completedLevels: readonly number[]): number {
  let coinsAdded = 0;
  for (const levelId of new Set(completedLevels)) {
    if (!isMilestoneLevel(levelId)) continue;
    const amount = claimMilestoneReward(`campaign:${levelId}`, levelId);
    if (amount > 0 && useCurrency.getState().addOnce(`legacy:campaign:${levelId}:milestone`, 'coins', amount)) {
      coinsAdded += amount;
    }
  }
  return coinsAdded;
}
