import { create } from 'zustand';

import { getJSON, KEYS, setJSON } from '@/core/storage';

type Kind = 'coins' | 'gems';

interface Saved {
  coins: number;
  gems: number;
}

interface CurrencyState extends Saved {
  add: (kind: Kind, n: number) => void;
  spend: (kind: Kind, n: number) => boolean;
}

const init = getJSON<Saved>(KEYS.currency, { coins: 0, gems: 0 });

export const useCurrency = create<CurrencyState>((set, get) => ({
  coins: init.coins,
  gems: init.gems,
  add: (kind, n) => {
    const next: Saved = { coins: get().coins, gems: get().gems };
    next[kind] += n;
    set(next);
    setJSON(KEYS.currency, next);
  },
  spend: (kind, n) => {
    if (get()[kind] < n) return false;
    const next: Saved = { coins: get().coins, gems: get().gems };
    next[kind] -= n;
    set(next);
    setJSON(KEYS.currency, next);
    return true;
  },
}));
