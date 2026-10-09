import { create } from 'zustand';

import { allLandmarks, landmarkUnlockedAt } from '@/core/config/worlds';
import { getJSON, KEYS, storage } from '@/core/storage';
import { useRetention } from '@/features/retention';

import { coverImageForId } from './coverArt';

interface Saved {
  opened: string[];
  selectedCoverId: string | null;
}

interface Store extends Saved {
  has: (id: string) => boolean;
  unlock: (id: string) => boolean;
  maybeUnlockAtLevel: (world: string, levelId: number) => string | null;
  backfillCompleted: (completedLevels: readonly number[]) => string[];
  selectCover: (id: string | null) => boolean;
}

export function loadCollectionSaved(): Saved {
  const stored = getJSON<Partial<Saved>>(KEYS.collection, {});
  return {
    opened: Array.isArray(stored.opened) ? stored.opened.filter((id): id is string => typeof id === 'string') : [],
    selectedCoverId: typeof stored.selectedCoverId === 'string' &&
      coverImageForId(stored.selectedCoverId, useRetention.getState().ownedCollectibles)
      ? stored.selectedCoverId : null,
  };
}

const init = loadCollectionSaved();

function persist(saved: Saved): boolean {
  try {
    const serialized = JSON.stringify(saved);
    storage.set(KEYS.collection, serialized);
    return storage.getString(KEYS.collection) === serialized;
  } catch {
    return false;
  }
}

export const useCollection = create<Store>((set, get) => ({
  opened: init.opened,
  selectedCoverId: init.selectedCoverId,
  has: (id) => get().opened.includes(id),
  unlock: (id) => {
    if (get().opened.includes(id)) return true;
    const opened = [...get().opened, id];
    if (!persist({ opened, selectedCoverId: get().selectedCoverId })) return false;
    set({ opened });
    return true;
  },
  maybeUnlockAtLevel: (world, levelId) => {
    const landmark = landmarkUnlockedAt(world, levelId);
    if (landmark && !get().opened.includes(landmark.id)) {
      return get().unlock(landmark.id) ? landmark.id : null;
    }
    return null;
  },
  backfillCompleted: (completedLevels) => {
    const completed = new Set(completedLevels.filter((levelId) => Number.isInteger(levelId)));
    const existing = new Set(get().opened);
    const missing = allLandmarks()
      .filter((landmark) => completed.has(landmark.untilLevel) && !existing.has(landmark.id))
      .map((landmark) => landmark.id);
    if (missing.length === 0) return [];
    const opened = [...get().opened, ...missing];
    if (!persist({ opened, selectedCoverId: get().selectedCoverId })) return [];
    set({ opened });
    return missing;
  },
  selectCover: (id) => {
    if (id !== null && !coverImageForId(id, useRetention.getState().ownedCollectibles)) return false;
    if (id === get().selectedCoverId) return true;
    if (!persist({ opened: get().opened, selectedCoverId: id })) return false;
    set({ selectedCoverId: id });
    return true;
  },
}));

/** Add cards introduced after a profile passed their levels, without replaying rewards. */
export function backfillUnlockedLandmarks(completedLevels: readonly number[]): string[] {
  return useCollection.getState().backfillCompleted(completedLevels);
}
