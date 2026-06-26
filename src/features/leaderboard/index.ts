import { create } from 'zustand';

import { getBackend, type Snapshot } from '@/core/net';
import { getJSON, KEYS, setJSON } from '@/core/storage';
import { useProfile } from '@/features/profile';

interface Cache {
  pendingLevels: number;
  snapshot: Snapshot | null;
}

interface Store extends Cache {
  loading: boolean;
  offline: boolean;
  load: (scope: 'global' | 'weekly') => Promise<void>;
  /** Отправить прогресс на сервер; offline-first: при сбое копим pending. */
  syncProgress: (levels: number) => Promise<void>;
}

const init = getJSON<Cache>(KEYS.leaderboard, { pendingLevels: 0, snapshot: null });

function persist(c: Cache) {
  setJSON(KEYS.leaderboard, c);
}

export const useLeaderboard = create<Store>((set, get) => ({
  pendingLevels: init.pendingLevels,
  snapshot: init.snapshot,
  loading: false,
  offline: false,
  load: async (scope) => {
    const token = useProfile.getState().profile?.authToken;
    if (!token) {
      set({ offline: false });
      return;
    }
    set({ loading: true });
    try {
      // дослать отложенный прогресс
      const pending = get().pendingLevels;
      if (pending > 0) {
        await getBackend().submitProgress(token, pending);
        set({ pendingLevels: 0 });
        persist({ pendingLevels: 0, snapshot: get().snapshot });
      }
      const snap = await getBackend().leaderboard(token, scope);
      set({ snapshot: snap, loading: false, offline: false });
      persist({ pendingLevels: 0, snapshot: snap });
    } catch {
      set({ loading: false, offline: true });
    }
  },
  syncProgress: async (levels) => {
    const token = useProfile.getState().profile?.authToken;
    if (!token) {
      const pending = Math.max(get().pendingLevels, levels);
      set({ pendingLevels: pending });
      persist({ pendingLevels: pending, snapshot: get().snapshot });
      return;
    }
    try {
      const snap = await getBackend().submitProgress(token, levels);
      set({ snapshot: snap, pendingLevels: 0, offline: false });
      persist({ pendingLevels: 0, snapshot: snap });
    } catch {
      const pending = Math.max(get().pendingLevels, levels);
      set({ pendingLevels: pending, offline: true });
      persist({ pendingLevels: pending, snapshot: get().snapshot });
    }
  },
}));
