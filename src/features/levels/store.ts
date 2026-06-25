import { create } from 'zustand';

import { getJSON, KEYS, setJSON } from '@/core/storage';

import { DEFAULT_WORLD } from './loader';

interface Saved {
  world: string;
  currentLevel: number;
  completed: number[];
}

interface LevelsState extends Saved {
  completeLevel: (id: number) => void;
  reset: () => void;
}

const init = getJSON<Saved>(KEYS.levelsProgress, {
  world: DEFAULT_WORLD,
  currentLevel: 1,
  completed: [],
});

function persist(s: Saved): void {
  setJSON(KEYS.levelsProgress, s);
}

export const useLevels = create<LevelsState>((set, get) => ({
  ...init,
  completeLevel: (id) => {
    if (get().completed.includes(id)) return;
    const completed = [...get().completed, id];
    const currentLevel = Math.max(get().currentLevel, id + 1);
    set({ completed, currentLevel });
    persist({ world: get().world, currentLevel, completed });
  },
  reset: () => {
    const fresh: Saved = { world: DEFAULT_WORLD, currentLevel: 1, completed: [] };
    set(fresh);
    persist(fresh);
  },
}));
