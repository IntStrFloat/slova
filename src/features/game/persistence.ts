import { getJSON, KEYS, setJSON, removeKey } from '@/core/storage';
import { initPlayState, type Level, type PlayState } from '@/core/engine/types';

/** Версия снапшота уровня — повышать при несовместимых изменениях формата. */
export const SNAPSHOT_VERSION = 1;

export type PlayMode = 'normal' | 'daily';

/** Сериализуемый снимок незавершённого уровня (спека 10: in-level save). */
export interface GameSnapshot {
  version: number;
  mode: PlayMode;
  world: string;
  levelId: number;
  filled: Record<string, string>;
  solvedWords: string[];
  foundBonus: string[];
  coinsEarned: number;
  disk: string[];
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

/** Чистая сериализация состояния игры в снапшот. */
export function serializeGame(
  level: Level,
  play: PlayState,
  disk: string[],
  mode: PlayMode,
): GameSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    mode,
    world: level.world,
    levelId: level.id,
    filled: play.filled,
    solvedWords: play.solvedWords,
    foundBonus: play.foundBonus,
    coinsEarned: play.coinsEarned,
    disk,
  };
}

/**
 * Чистое восстановление состояния из снапшота. Возвращает null, если снапшот не
 * подходит к уровню (другая версия/мир/уровень/режим) или повреждён — тогда вызывающий
 * стартует чистый уровень. Игнорирует уже завершённый снапшот.
 */
export function restoreGame(
  level: Level,
  mode: PlayMode,
  snap: GameSnapshot | null,
): { play: PlayState; disk: string[] } | null {
  if (!snap || snap.version !== SNAPSHOT_VERSION) return null;
  if (snap.mode !== mode || snap.world !== level.world || snap.levelId !== level.id) return null;
  if (!snap.filled || typeof snap.filled !== 'object') return null;

  const answerSet = new Set(level.answers.map((a) => a.word));
  const bonusSet = new Set(level.bonusPool);
  const solvedWords = (snap.solvedWords ?? []).filter((w) => answerSet.has(w));
  const foundBonus = (snap.foundBonus ?? []).filter((w) => bonusSet.has(w));

  // Только клетки, реально принадлежащие сетке и с верной буквой — отбрасываем мусор.
  const validCell = new Map<string, string>();
  for (const c of level.grid.cells) validCell.set(`${c.row},${c.col}`, c.ch);
  const filled: Record<string, string> = {};
  for (const [key, ch] of Object.entries(snap.filled)) {
    if (validCell.get(key) === ch) filled[key] = ch;
  }

  // Снапшот завершённого уровня не восстанавливаем (новый уровень/реплей — с нуля).
  const allFilled = level.grid.cells.every((c) => filled[`${c.row},${c.col}`] === c.ch);
  if (allFilled) return null;

  const disk =
    Array.isArray(snap.disk) && sameMultiset(snap.disk, level.letters)
      ? snap.disk
      : [...level.letters];

  const base = initPlayState(level);
  const coinsEarned = Number.isFinite(snap.coinsEarned) ? Math.max(0, snap.coinsEarned) : 0;
  return {
    play: { ...base, filled, solvedWords, foundBonus, coinsEarned },
    disk,
  };
}

export function loadGameSnapshot(): GameSnapshot | null {
  return getJSON<GameSnapshot | null>(KEYS.gameCurrent, null);
}

export function saveGameSnapshot(snap: GameSnapshot): void {
  setJSON(KEYS.gameCurrent, snap);
}

export function clearGameSnapshot(): void {
  removeKey(KEYS.gameCurrent);
}
