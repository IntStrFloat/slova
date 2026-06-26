import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import { getJSON, getString, KEYS, setJSON } from '@/core/storage';

type Kind = 'coins' | 'gems';

interface Saved {
  coins: number;
  gems: number;
}

interface CurrencyState extends Saved {
  add: (kind: Kind, n: number) => void;
  spend: (kind: Kind, n: number) => boolean;
}

const firstRun = getString(KEYS.currency) === null;
const init: Saved = firstRun
  ? { coins: ECONOMY.starterCoins, gems: 0 }
  : getJSON<Saved>(KEYS.currency, { coins: 0, gems: 0 });
if (firstRun) setJSON(KEYS.currency, init);

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
