import { create } from 'zustand';

import { getJSON, KEYS, setJSON } from '@/core/storage';

interface Saved {
  removeAds?: boolean;
  proUntil?: number | null;
}

interface EntitlementsState {
  removeAds: boolean;
  proUntil: number | null;
  isPro: () => boolean;
  setRemoveAds: (value: boolean) => void;
  setProUntil: (untilMs: number | null) => void;
}

const saved = getJSON<Saved>(KEYS.entitlements, {});

export const useEntitlements = create<EntitlementsState>((set, get) => ({
  removeAds: saved.removeAds ?? false,
  proUntil: saved.proUntil ?? null,
  isPro: () => {
    const until = get().proUntil;
    return until !== null && until > Date.now();
  },
  setRemoveAds: (value) => {
    set({ removeAds: value });
    setJSON(KEYS.entitlements, { removeAds: value, proUntil: get().proUntil });
  },
  setProUntil: (untilMs) => {
    set({ proUntil: untilMs });
    setJSON(KEYS.entitlements, { removeAds: get().removeAds, proUntil: untilMs });
  },
}));
