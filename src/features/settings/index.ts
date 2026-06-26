import { create } from 'zustand';

import { getJSON, KEYS, setJSON } from '@/core/storage';

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
}

interface Store extends Settings {
  set: (p: Partial<Settings>) => void;
}

const init = getJSON<Settings>(KEYS.settings, { sound: true, music: true, haptics: true });

export const useSettings = create<Store>((set, get) => ({
  ...init,
  set: (p) => {
    set(p);
    const s = get();
    setJSON(KEYS.settings, { sound: s.sound, music: s.music, haptics: s.haptics });
  },
}));
