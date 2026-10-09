import { create } from 'zustand';

import { totalCampaignLevels, worldForCampaignLevel } from '@/core/config/worlds';
import { getJSON, getString, KEYS, storage } from '@/core/storage';

import { DEFAULT_WORLD } from './loader';

interface Saved {
  world: string;
  currentLevel: number;
  completed: number[];
}

interface LevelsState extends Saved {
  completeLevel: (id: number) => void;
  completeLevelOnce: (effectId: string, id: number) => boolean;
  reset: () => void;
}

function sanitizeCompleted(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<number>();
  for (const entry of value) {
    if (!Number.isInteger(entry)) continue;
    const levelId = Math.trunc(entry);
    if (levelId < 1 || levelId > totalCampaignLevels()) continue;
    unique.add(levelId);
  }
  return [...unique].sort((left, right) => left - right);
}

function sanitizeCurrentLevel(value: unknown): number {
  if (!Number.isInteger(value)) return 1;
  return Math.max(1, Math.trunc(value as number));
}

function sanitizeSaved(value: Saved | null | undefined): Saved {
  const currentLevel = sanitizeCurrentLevel(value?.currentLevel);
  const completed = sanitizeCompleted(value?.completed);
  return {
    world: value?.world === DEFAULT_WORLD && currentLevel === 1
      ? DEFAULT_WORLD
      : worldForCampaignLevel(currentLevel),
    currentLevel,
    completed,
  };
}

function sanitizeRewardLedger(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const sanitized: Record<string, number> = {};
  for (const [effectId, appliedAt] of Object.entries(value as Record<string, unknown>)) {
    if (!effectId || !Number.isFinite(appliedAt)) continue;
    sanitized[effectId] = Math.trunc(appliedAt as number);
  }
  return sanitized;
}

function saveState(currentLevel: number, completed: number[]): Saved {
  return {
    world: worldForCampaignLevel(currentLevel),
    currentLevel,
    completed,
  };
}

function parseSaved(raw: string | null): Saved | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<Saved>;
    if (!value || typeof value !== 'object'
      || !Number.isInteger(value.currentLevel) || (value.currentLevel ?? 0) < 1
      || (value.currentLevel ?? 0) > totalCampaignLevels() + 1
      || !Array.isArray(value.completed)) return null;
    const sanitized = sanitizeSaved(value as Saved);
    if (value.completed.length > 0 && sanitized.completed.length === 0) return null;
    return sanitized;
  } catch {
    return null;
  }
}

function loadProgress(): Saved {
  const primary = getString(KEYS.levelsProgress);
  const parsed = parseSaved(primary);
  if (parsed) return parsed;
  const backupRaw = getString(KEYS.levelsProgressBackup);
  const backup = parseSaved(backupRaw);
  if (backup) {
    // Restore only a validated snapshot. The damaged primary remains untouched
    // if this write fails, and the backup can be retried at next launch.
    storage.set(KEYS.levelsProgress, JSON.stringify(backup));
    return backup;
  }
  if (primary !== null || backupRaw !== null) {
    throw new Error('Levels progress is unreadable; preserving it for recovery');
  }
  return sanitizeSaved(null);
}

const init = loadProgress();
const rewardLedger = sanitizeRewardLedger(getJSON<Record<string, number> | null>(KEYS.levelsRewardLedger, null));

function persist(previous: Saved, next: Saved): void {
  // Both writes are synchronous. The backup contains the last valid progress
  // before the main value is replaced; React state changes only afterwards.
  storage.set(KEYS.levelsProgressBackup, JSON.stringify(sanitizeSaved(previous)));
  storage.set(KEYS.levelsProgress, JSON.stringify(next));
}

function currentSaved(state: LevelsState): Saved {
  return { world: state.world, currentLevel: state.currentLevel, completed: state.completed };
}

export const useLevels = create<LevelsState>((set, get) => ({
  ...init,
  completeLevel: (id) => {
    if (get().completed.includes(id)) return;
    const completed = [...get().completed, id].sort((left, right) => left - right);
    const currentLevel = Math.max(get().currentLevel, id + 1);
    const next = saveState(currentLevel, completed);
    persist(currentSaved(get()), next);
    set(next);
  },
  completeLevelOnce: (effectId, id) => {
    if (rewardLedger[effectId]) return false;
    const completed = get().completed.includes(id)
      ? get().completed
      : [...get().completed, id].sort((left, right) => left - right);
    const currentLevel = Math.max(get().currentLevel, id + 1);
    const next = saveState(currentLevel, completed);
    const appliedAt = Date.now();
    persist(currentSaved(get()), next);
    storage.set(KEYS.levelsRewardLedger, JSON.stringify({ ...rewardLedger, [effectId]: appliedAt }));
    rewardLedger[effectId] = appliedAt;
    set(next);
    return true;
  },
  reset: () => {
    const fresh = saveState(1, []);
    persist(currentSaved(get()), fresh);
    set(fresh);
  },
}));
