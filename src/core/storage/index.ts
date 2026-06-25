import { createMMKV } from 'react-native-mmkv';

export const storage = createMMKV({ id: 'slova' });

/** Все ключи персиста — в одном месте (спека 02). */
export const KEYS = {
  gameCurrent: 'game.current',
  levelsProgress: 'levels.progress',
  collection: 'collection.v1',
  currency: 'currency.v1',
  hints: 'hints.v1',
  dailyPuzzle: 'daily.puzzle',
  dailyBonus: 'daily.bonus',
  wheel: 'wheel.v1',
  settings: 'settings.v1',
  entitlements: 'iap.entitlements',
  adsMeta: 'ads.meta',
  profile: 'profile.v1',
  cloudsave: 'cloudsave.v1',
  leaderboard: 'leaderboard.v1',
  analytics: 'analytics.v1',
  onboardingDone: 'onboarding.done.v1',
} as const;

export function getString(key: string): string | null {
  try {
    return storage.getString(key) ?? null;
  } catch {
    return null;
  }
}

export function setString(key: string, value: string): void {
  try {
    storage.set(key, value);
  } catch {
    // storage недоступен при server-rendering web
  }
}

export function getJSON<T>(key: string, fallback: T): T {
  const raw = getString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  setString(key, JSON.stringify(value));
}

export function removeKey(key: string): void {
  try {
    storage.remove(key);
  } catch {
    // noop
  }
}
