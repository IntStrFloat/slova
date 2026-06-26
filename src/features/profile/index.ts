import { create } from 'zustand';

import { getBackend } from '@/core/net';
import { getJSON, KEYS, setJSON } from '@/core/storage';

export interface SavedProfile {
  userId: string;
  authToken: string;
  nickname: string;
  tag: string;
}

interface Store {
  profile: SavedProfile | null;
  busy: boolean;
  error: string | null;
  ensure: (nickname: string) => Promise<boolean>;
}

const init = getJSON<SavedProfile | null>(KEYS.profile, null);

export const useProfile = create<Store>((set, get) => ({
  profile: init,
  busy: false,
  error: null,
  ensure: async (nickname) => {
    if (get().profile) return true;
    set({ busy: true, error: null });
    try {
      const { profile, authToken } = await getBackend().bootstrap(nickname);
      const saved: SavedProfile = {
        userId: profile.userId,
        authToken,
        nickname: profile.nickname,
        tag: profile.tag,
      };
      set({ profile: saved, busy: false });
      setJSON(KEYS.profile, saved);
      return true;
    } catch (e) {
      set({ busy: false, error: String(e && (e as Error).message) });
      return false;
    }
  },
}));
