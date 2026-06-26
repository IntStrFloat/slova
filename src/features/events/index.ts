import { create } from 'zustand';

import { getBackend, type EventBoard } from '@/core/net';
import { useProfile } from '@/features/profile';

interface Store {
  data: EventBoard | null;
  loading: boolean;
  offline: boolean;
  load: () => Promise<void>;
}

export const useEvents = create<Store>((set) => ({
  data: null,
  loading: false,
  offline: false,
  load: async () => {
    const token = useProfile.getState().profile?.authToken;
    if (!token) {
      set({ offline: false });
      return;
    }
    set({ loading: true });
    try {
      const d = await getBackend().eventsCurrent(token);
      set({ data: d, loading: false, offline: false });
    } catch {
      set({ loading: false, offline: true });
    }
  },
}));
