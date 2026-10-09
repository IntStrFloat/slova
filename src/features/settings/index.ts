import { create } from 'zustand';

import { track } from '@/features/analytics';
import { getJSON, KEYS, setJSON } from '@/core/storage';

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  notifications: boolean;
}

interface Store extends Settings {
  set: (p: Partial<Settings>) => void;
}

const defaults: Settings = { sound: true, music: true, haptics: true, notifications: false };
const init = { ...defaults, ...getJSON<Partial<Settings>>(KEYS.settings, {}) };

export const useSettings = create<Store>((set, get) => ({
  ...init,
  set: (p) => {
    set(p);
    const s = get();
    setJSON(KEYS.settings, {
      sound: s.sound,
      music: s.music,
      haptics: s.haptics,
      notifications: s.notifications,
    });
    for (const [setting, enabled] of Object.entries(p)) {
      track('setting_changed', { setting, enabled });
    }
  },
}));
