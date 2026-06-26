import { create } from 'zustand';

import { landmarkUnlockedAt } from '@/core/config/worlds';
import { getJSON, KEYS, setJSON } from '@/core/storage';

interface Saved {
  opened: string[];
}

interface Store extends Saved {
  has: (id: string) => boolean;
  unlock: (id: string) => void;
  /** Открыть достопримечательность, если уровень — последний в её диапазоне. */
  maybeUnlockAtLevel: (world: string, levelId: number) => string | null;
}

const init = getJSON<Saved>(KEYS.collection, { opened: [] });

export const useCollection = create<Store>((set, get) => ({
  opened: init.opened,
  has: (id) => get().opened.includes(id),
  unlock: (id) => {
    if (get().opened.includes(id)) return;
    const opened = [...get().opened, id];
    set({ opened });
    setJSON(KEYS.collection, { opened });
  },
  maybeUnlockAtLevel: (world, levelId) => {
    const lm = landmarkUnlockedAt(world, levelId);
    if (lm && !get().opened.includes(lm.id)) {
      get().unlock(lm.id);
      return lm.id;
    }
    return null;
  },
}));

export { LandmarkReveal } from './LandmarkReveal';
