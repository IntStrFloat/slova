import type { Answer, Cell, Level } from '@/core/engine/types';
import { KEYS, storage } from '@/core/storage';
import legacyEarlyLevels from '../../../assets/content/legacy-early-levels.json';

/** A fixed, locally bundled route for profiles first created on onboarding v1. */
export const INTRO_PACK_VERSION = 'intro-v2';
export const INTRO_PACK_ASSIGNMENT_KEY = 'onboarding.intro-pack.v1';

type Placement = { word: string; row: number; col: number; dir: Answer['dir'] };

function makeLevel(
  id: number,
  letters: string,
  placements: Placement[],
  acceptedBonus: string[] = [],
): Level {
  const cells = new Map<string, Cell>();
  const answers: Answer[] = placements.map(({ word, row, col, dir }) => ({
    word,
    dir,
    cells: [...word].map((ch, offset) => {
      const cell = {
        row: row + (dir === 'V' ? offset : 0),
        col: col + (dir === 'H' ? offset : 0),
        ch,
      };
      const key = `${cell.row},${cell.col}`;
      const existing = cells.get(key);
      if (existing && existing.ch !== ch) {
        throw new Error(`Intro level ${id} has conflicting letters at ${key}`);
      }
      cells.set(key, cell);
      return cell;
    }),
  }));
  const gridCells = [...cells.values()].sort((a, b) => a.row - b.row || a.col - b.col);

  return {
    id,
    globalId: id,
    world: 'world1',
    contentVersion: INTRO_PACK_VERSION,
    fingerprint: `${INTRO_PACK_VERSION}:${id}:${letters}:${placements.map((p) => p.word).join(',')}`,
    letters: [...letters],
    grid: {
      rows: Math.max(...gridCells.map((cell) => cell.row)) + 1,
      cols: Math.max(...gridCells.map((cell) => cell.col)) + 1,
      cells: gridCells,
    },
    answers,
    acceptedBonus,
    bonusPool: acceptedBonus,
    rewardedBonus: acceptedBonus,
    blockedPool: [],
    difficulty: id <= 2 ? 1 : 2,
    difficultyTier: id <= 2 ? 1 : 2,
    difficultyRole: 'easy',
    mechanic: 'classic',
    milestone: id === 5 ? 'landmark' : null,
  };
}

const INTRO_LEVELS: readonly Level[] = [
  makeLevel(1, 'кот', [
    { word: 'кот', row: 0, col: 0, dir: 'H' },
    { word: 'ток', row: 0, col: 2, dir: 'V' },
  ]),
  makeLevel(2, 'сон', [
    { word: 'сон', row: 0, col: 0, dir: 'H' },
    { word: 'нос', row: 0, col: 2, dir: 'V' },
  ]),
  makeLevel(3, 'дело', [
    { word: 'дело', row: 0, col: 0, dir: 'H' },
    { word: 'лед', row: 0, col: 2, dir: 'V' },
  ]),
  makeLevel(4, 'рост', [
    { word: 'рост', row: 0, col: 0, dir: 'H' },
    { word: 'рот', row: 0, col: 0, dir: 'V' },
    { word: 'трос', row: 2, col: 0, dir: 'H' },
  ], ['сорт', 'торс']),
  makeLevel(5, 'клуб', [
    { word: 'клуб', row: 0, col: 0, dir: 'H' },
    { word: 'лук', row: 0, col: 1, dir: 'V' },
    { word: 'куб', row: 2, col: 1, dir: 'H' },
  ]),
];

/** The caller decides whether the profile was assigned this pack. */
export function getIntroLevel(globalId: number): Level | null {
  return Number.isInteger(globalId) ? INTRO_LEVELS[globalId - 1] ?? null : null;
}

export function getIntroLevelForFingerprint(globalId: number, fingerprint: string, contentVersion: string): Level | null {
  const current = getIntroLevel(globalId);
  if (current?.fingerprint === fingerprint && current.contentVersion === contentVersion) return current;
  return (legacyEarlyLevels.intro as unknown as Level[]).find((level) => level.globalId === globalId
    && level.contentVersion === contentVersion && level.fingerprint === fingerprint) ?? null;
}

export function hasIntroPackAssignment(): boolean {
  return getAssignedIntroVersion() !== null;
}

export function getAssignedIntroVersion(): string | null {
  try {
    const version = storage.getString(INTRO_PACK_ASSIGNMENT_KEY);
    return version === INTRO_PACK_VERSION || version === 'intro-v1' ? version : null;
  } catch {
    return null;
  }
}

/** Authenticate both the current route and genuine already-started intro puzzles. */
export function isVerifiedIntroLevel(level: Level): boolean {
  const candidates = [getIntroLevel(level.globalId ?? level.id),
    ...(legacyEarlyLevels.intro as unknown as Level[])];
  return candidates.some((candidate) => candidate != null
    && candidate.id === level.id && candidate.globalId === level.globalId
    && candidate.world === level.world && candidate.contentVersion === level.contentVersion
    && candidate.fingerprint === level.fingerprint
    && JSON.stringify([candidate.letters, candidate.grid, candidate.answers, candidate.acceptedBonus,
      candidate.rewardedBonus, candidate.blockedPool, candidate.mechanic, candidate.milestone])
    === JSON.stringify([level.letters, level.grid, level.answers, level.acceptedBonus,
      level.rewardedBonus, level.blockedPool, level.mechanic, level.milestone]));
}

/** Call before creating any progress or onboarding-done record for a new profile. */
export function assignIntroPackForCurrentProfile(): boolean {
  try {
    if (hasIntroPackAssignment()) return true;
    if (storage.getString(KEYS.levelsProgress) != null) return false;
    if (storage.getString(KEYS.onboardingDone) != null) return false;
    storage.set(INTRO_PACK_ASSIGNMENT_KEY, INTRO_PACK_VERSION);
    return hasIntroPackAssignment();
  } catch {
    return false;
  }
}
