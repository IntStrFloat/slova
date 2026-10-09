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
  ensure: (nickname?: string) => Promise<boolean>;
  /** Сменить ник на бекенде (POST /api/profile/rename) и сохранить локально. */
  rename: (nickname: string) => Promise<boolean>;
}

/** Дефолтный ник для авто-создания профиля (как у клиента: «Игрок####»). */
export function defaultNickname(): string {
  return `Игрок${Math.floor(1000 + Math.random() * 9000)}`;
}

const init = getJSON<SavedProfile | null>(KEYS.profile, null);

export const useProfile = create<Store>((set, get) => ({
  profile: init,
  busy: false,
  error: null,
  // Идемпотентно: профиль уже есть → true; идёт создание → false (без дублей).
  ensure: async (nickname) => {
    if (get().profile) return true;
    if (get().busy) return false;
    set({ busy: true, error: null });
    try {
      const { profile, authToken } = await getBackend().bootstrap(nickname ?? defaultNickname());
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
  rename: async (nickname) => {
    const p = get().profile;
    if (!p) return false;
    const next = nickname.trim();
    // Та же валидация, что на сервере (2–16, без управляющих) — мгновенный фидбек.
    if (next.length < 2 || next.length > 16) {
      set({ error: 'bad_nickname' });
      return false;
    }
    if (next === p.nickname) return true;
    set({ busy: true, error: null });
    try {
      const updated = await getBackend().rename(p.authToken, next);
      const saved: SavedProfile = { ...p, nickname: updated.nickname, tag: updated.tag };
      set({ profile: saved, busy: false });
      setJSON(KEYS.profile, saved);
      return true;
    } catch (e) {
      set({ busy: false, error: String(e && (e as Error).message) });
      return false;
    }
  },
}));
