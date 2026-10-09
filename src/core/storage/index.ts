import { createMMKV } from 'react-native-mmkv';

export const storage = createMMKV({ id: 'slova' });

/** Все ключи персиста — в одном месте (спека 02). */
export const KEYS = {
  gameCurrent: 'game.current',
  gameCurrentNormal: 'game.current.normal',
  gameCurrentDaily: 'game.current.daily',
  gameDailySnapshots: 'game.daily.snapshots.v1',
  gameDailySnapshotsBackup: 'game.daily.snapshots.backup.v1',
  gameCurrentNormalBackup: 'game.current.normal.backup.v1',
  gameSnapshotMigrationV2: 'game.snapshot.migration.v2',
  introSurface: 'onboarding.surface.v1',
  pendingHint: 'game.pending-hint.v1',
  helpNudge: 'game.help-nudge.v1',
  levelsProgress: 'levels.progress',
  levelsRewardLedger: 'levels.reward-ledger.v1',
  collection: 'collection.v1',
  currency: 'currency.v1',
  currencyRewardLedger: 'currency.reward-ledger.v1',
  currencyBackup: 'currency.v1.backup',
  retention: 'retention.v1',
  retentionBackup: 'retention.v1.backup',
  hints: 'hints.v1',
  dailyPuzzle: 'daily.puzzle',
  dailyPuzzleBackup: 'daily.puzzle.backup.v2',
  levelsProgressBackup: 'levels.progress.backup.v1',
  dailyBonus: 'daily.bonus',
  dailyBonusBackup: 'daily.bonus.backup.v1',
  wheel: 'wheel.v1',
  settings: 'settings.v1',
  entitlements: 'iap.entitlements',
  subscription: 'billing.subscription.v1',
  adsMeta: 'ads.meta',
  profile: 'profile.v1',
  cloudsave: 'cloudsave.v1',
  leaderboard: 'leaderboard.v1',
  analytics: 'analytics.v1',
  onboardingDone: 'onboarding.done.v1',
  pushPrompt: 'push.prompt.v1',
  reviewPrompt: 'review.prompt.v1',
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
