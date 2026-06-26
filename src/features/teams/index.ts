import { create } from 'zustand';

import { getBackend, type Team } from '@/core/net';
import { useProfile } from '@/features/profile';

interface Store {
  list: Team[];
  mine: Team | null;
  loading: boolean;
  offline: boolean;
  load: () => Promise<void>;
  create: (name: string) => Promise<void>;
  join: (id: string) => Promise<void>;
  leave: () => Promise<void>;
}

function token() {
  return useProfile.getState().profile?.authToken;
}

export const useTeams = create<Store>((set, get) => ({
  list: [],
  mine: null,
  loading: false,
  offline: false,
  load: async () => {
    const t = token();
    if (!t) return;
    set({ loading: true });
    try {
      const [list, mine] = await Promise.all([getBackend().teamsList(t), getBackend().teamMine(t)]);
      set({ list: list.teams, mine: mine.team, loading: false, offline: false });
    } catch {
      set({ loading: false, offline: true });
    }
  },
  create: async (name) => {
    const t = token();
    if (!t) return;
    try {
      await getBackend().teamCreate(t, name);
      await get().load();
    } catch {
      set({ offline: true });
    }
  },
  join: async (id) => {
    const t = token();
    if (!t) return;
    try {
      await getBackend().teamJoin(t, id);
      await get().load();
    } catch {
      set({ offline: true });
    }
  },
  leave: async () => {
    const t = token();
    if (!t) return;
    try {
      await getBackend().teamLeave(t);
      await get().load();
    } catch {
      set({ offline: true });
    }
  },
}));
