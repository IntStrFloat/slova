import { initPlayState, type CompletionSource, type HintType, type Level, type PlayState } from '@/core/engine/types';
import { getJSON, getString, KEYS, removeKey, setJSON, storage } from '@/core/storage';

/** Versioned, mode-separated in-level snapshots. */
export const SNAPSHOT_VERSION = 2;
export type PlayMode = 'normal' | 'daily';
export type CompletionStatus = 'playing' | 'completion_pending' | 'reward_claimed' | 'finished';

export interface CompletionState {
  status: CompletionStatus;
  source?: CompletionSource;
  completionId?: string;
  /** Frozen at the winning action, including if settlement resumes tomorrow. */
  completedAt?: string;
}

export interface GameSnapshot {
  version: number;
  revision: number;
  updatedAt: string;
  /** Unknown on saves made before this measurement revision. */
  createdAt?: string;
  /** Foreground, focused gameplay only; excludes menus and result overlays. */
  activeTimeMs?: number;
  mode: PlayMode;
  attemptId: string;
  globalLevel: number;
  world: string;
  levelId: number;
  dailyId?: string;
  contentVersion: string;
  levelFingerprint: string;
  policyRevision: number | null;
  filled: Record<string, string>;
  solvedWords: string[];
  foundBonus: string[];
  /** Product date at the moment each word was manually accepted. */
  wordDates?: Record<string, string>;
  mistakes?: number;
  hintsUsed: HintType[];
  coinsEarned: number;
  disk: string[];
  completion: CompletionState;
}

type LegacyGameSnapshot = {
  version?: number; mode?: PlayMode; world?: string; levelId?: number;
  filled?: Record<string, string>; solvedWords?: string[]; foundBonus?: string[];
  coinsEarned?: number; disk?: string[];
};

function slotKey(mode: PlayMode): string {
  return mode === 'daily' ? KEYS.gameCurrentDaily : KEYS.gameCurrentNormal;
}

function readSnapshot(key: string): GameSnapshot | null {
  const raw = getString(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as GameSnapshot;
    return value?.version === SNAPSHOT_VERSION && value.completion && Array.isArray(value.disk)
      ? value
      : null;
  } catch {
    return null;
  }
}

function readDailySnapshots(key: string): Record<string, GameSnapshot> | null {
  const raw = getString(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, GameSnapshot>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value).filter(([date, snapshot]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date)
      && snapshot?.version === SNAPSHOT_VERSION
      && snapshot.mode === 'daily'
      && snapshot.dailyId === date,
    ));
  } catch {
    return null;
  }
}

function dailySnapshots(): Record<string, GameSnapshot> {
  const stored = readDailySnapshots(KEYS.gameDailySnapshots)
    ?? readDailySnapshots(KEYS.gameDailySnapshotsBackup)
    ?? {};
  // Pre-migration builds kept only one daily slot. Preserve its pinned date.
  const old = readSnapshot(KEYS.gameCurrentDaily);
  if (old?.mode === 'daily' && old.dailyId && !stored[old.dailyId]) {
    stored[old.dailyId] = old;
  }
  return stored;
}

function writeCritical(key: string, value: unknown): void {
  // The caller must know when a gameplay write failed before announcing success.
  storage.set(key, JSON.stringify(value));
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const count = new Map<string, number>();
  for (const ch of a) count.set(ch, (count.get(ch) ?? 0) + 1);
  for (const ch of b) {
    const n = count.get(ch) ?? 0;
    if (n === 0) return false;
    count.set(ch, n - 1);
  }
  return true;
}

function fingerprint(level: Level): string {
  return level.fingerprint ?? `${level.globalId ?? level.id}:${level.letters.join('')}:${level.answers.map((a) => a.word).join(',')}`;
}

function attemptId(level: Level, mode: PlayMode, dailyId?: string): string {
  return `${mode}:${dailyId ?? level.globalId ?? level.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function completionIdFor(level: Level, mode: PlayMode, attempt: string, dailyId?: string): string {
  return `${mode}:${dailyId ?? level.globalId ?? level.id}:${level.contentVersion ?? 'legacy'}:${attempt}`;
}

export function serializeGame(
  level: Level,
  play: PlayState,
  disk: string[],
  mode: PlayMode,
  completion: CompletionState = { status: 'playing' },
  previous?: GameSnapshot | null,
  hintsUsed: HintType[] = [],
  dailyId?: string,
  wordDates: Record<string, string> = {},
  mistakes = 0,
): GameSnapshot {
  const id = previous?.attemptId ?? attemptId(level, mode, dailyId);
  return {
    version: SNAPSHOT_VERSION,
    revision: (previous?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    createdAt: previous ? previous.createdAt : new Date().toISOString(),
    activeTimeMs: previous?.activeTimeMs ?? 0,
    mode,
    attemptId: id,
    globalLevel: level.globalId ?? level.id,
    world: level.world,
    levelId: level.id,
    dailyId,
    contentVersion: level.contentVersion ?? 'legacy',
    levelFingerprint: fingerprint(level),
    policyRevision: level.policyRevision ?? null,
    filled: { ...play.filled },
    solvedWords: [...play.solvedWords],
    foundBonus: [...play.foundBonus],
    wordDates: { ...wordDates },
    mistakes: Math.max(0, Math.trunc(mistakes)),
    hintsUsed: [...hintsUsed],
    coinsEarned: play.coinsEarned,
    disk: [...disk],
    completion: completion.completionId ? completion : {
      ...completion,
      completionId: completion.status === 'completion_pending'
        ? completionIdFor(level, mode, id, dailyId)
        : undefined,
    },
  };
}

function migrateLegacy(level: Level, mode: PlayMode): GameSnapshot | null {
  if (getString(KEYS.gameSnapshotMigrationV2) !== null) return null;
  const legacy = getJSON<LegacyGameSnapshot | null>(KEYS.gameCurrent, null);
  if (!legacy || legacy.mode !== mode || legacy.world !== level.world || legacy.levelId !== level.id) return null;
  const base = initPlayState(level);
  const play: PlayState = {
    ...base,
    filled: legacy.filled ?? {},
    solvedWords: legacy.solvedWords ?? [],
    foundBonus: legacy.foundBonus ?? [],
    coinsEarned: Number.isFinite(legacy.coinsEarned) ? Math.max(0, legacy.coinsEarned!) : 0,
  };
  const allFilled = level.grid.cells.every((c) => play.filled[`${c.row},${c.col}`] === c.ch);
  const snap = serializeGame(
    level,
    play,
    Array.isArray(legacy.disk) ? legacy.disk : level.letters,
    mode,
    allFilled ? { status: 'completion_pending', source: 'revealWord' } : { status: 'playing' },
  );
  setJSON(slotKey(mode), snap);
  // Marker is only written after the target was materialized; retry remains safe.
  setJSON(KEYS.gameSnapshotMigrationV2, { version: SNAPSHOT_VERSION, mode, migratedAt: snap.updatedAt });
  removeKey(KEYS.gameCurrent);
  return snap;
}

export function loadGameSnapshot(mode: PlayMode = 'normal', level?: Level, dailyId?: string): GameSnapshot | null {
  const snapshot = mode === 'daily'
    ? dailyId ? dailySnapshots()[dailyId] ?? null : Object.values(dailySnapshots()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    : readSnapshot(KEYS.gameCurrentNormal) ?? readSnapshot(KEYS.gameCurrentNormalBackup);
  if (snapshot?.version === SNAPSHOT_VERSION && snapshot.mode === mode) return snapshot;
  return level ? migrateLegacy(level, mode) : null;
}

export function saveGameSnapshot(mode: PlayMode, snapshot?: GameSnapshot): void {
  // Compatibility with the old one-argument helper during incremental migration.
  const actualMode = snapshot ? mode : 'normal';
  const actualSnapshot = snapshot ?? (mode as unknown as GameSnapshot);
  if (actualMode === 'daily' && actualSnapshot.dailyId) {
    const current = dailySnapshots();
    const next = { ...current, [actualSnapshot.dailyId]: actualSnapshot };
    writeCritical(KEYS.gameDailySnapshotsBackup, current);
    writeCritical(KEYS.gameDailySnapshots, next);
    return;
  }
  const previous = readSnapshot(KEYS.gameCurrentNormal);
  if (previous) writeCritical(KEYS.gameCurrentNormalBackup, previous);
  writeCritical(slotKey(actualMode), actualSnapshot);
}

export function clearGameSnapshot(mode: PlayMode = 'normal', dailyId?: string): void {
  if (mode === 'daily') {
    if (!dailyId) {
      removeKey(KEYS.gameDailySnapshots);
      removeKey(KEYS.gameDailySnapshotsBackup);
      removeKey(KEYS.gameCurrentDaily);
      return;
    }
    const current = dailySnapshots();
    delete current[dailyId];
    setJSON(KEYS.gameDailySnapshotsBackup, current);
    setJSON(KEYS.gameDailySnapshots, current);
    if (readSnapshot(KEYS.gameCurrentDaily)?.dailyId === dailyId) removeKey(KEYS.gameCurrentDaily);
    return;
  }
  removeKey(slotKey(mode));
  removeKey(KEYS.gameCurrentNormalBackup);
}

/** Restore a compatible snapshot, including an unclaimed completed level. */
export function restoreGame(
  level: Level,
  mode: PlayMode,
  snap: GameSnapshot | null,
  dailyId?: string,
): { play: PlayState; disk: string[]; snapshot: GameSnapshot } | null {
  if (!snap || snap.version !== SNAPSHOT_VERSION) return null;
  if (snap.mode !== mode || snap.world !== level.world || snap.globalLevel !== (level.globalId ?? level.id)) return null;
  if (mode === 'daily' && snap.dailyId !== dailyId) return null;
  if (snap.contentVersion !== (level.contentVersion ?? 'legacy') || snap.levelFingerprint !== fingerprint(level)) return null;
  if (!snap.filled || typeof snap.filled !== 'object') return null;

  const answerSet = new Set(level.answers.map((a) => a.word));
  const bonusSet = new Set(level.acceptedBonus ?? level.bonusPool ?? []);
  const solvedWords = (snap.solvedWords ?? []).filter((word) => answerSet.has(word));
  const foundBonus = (snap.foundBonus ?? []).filter((word) => bonusSet.has(word));
  const acceptedKeys = new Set([
    ...solvedWords.map((word) => `grid:${word}`),
    ...foundBonus.map((word) => `bonus:${word}`),
  ]);
  const wordDates = Object.fromEntries(Object.entries(snap.wordDates ?? {}).filter(([key, date]) =>
    acceptedKeys.has(key) && /^\d{4}-\d{2}-\d{2}$/.test(date),
  ));
  const validCell = new Map(level.grid.cells.map((c) => [`${c.row},${c.col}`, c.ch]));
  const filled: Record<string, string> = {};
  for (const [key, char] of Object.entries(snap.filled)) if (validCell.get(key) === char) filled[key] = char;
  const disk = Array.isArray(snap.disk) && sameMultiset(snap.disk, level.letters) ? snap.disk : [...level.letters];
  const base = initPlayState(level);
  return {
    play: {
      ...base, filled, solvedWords, foundBonus,
      coinsEarned: Number.isFinite(snap.coinsEarned) ? Math.max(0, snap.coinsEarned) : 0,
    },
    disk,
    snapshot: {
      ...snap, filled, solvedWords, foundBonus, wordDates, disk,
      mistakes: Number.isFinite(snap.mistakes) ? Math.max(0, Math.trunc(snap.mistakes!)) : 0,
    },
  };
}
