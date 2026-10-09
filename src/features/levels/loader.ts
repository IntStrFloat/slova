import type { Level } from '@/core/engine';
import { validateLevel } from '@/core/engine';
import { WORLDS } from '@/core/config/worlds';
import { getIntroLevel, hasIntroPackAssignment } from '@/features/onboarding';
import { loadGameSnapshot, restoreGame } from '@/features/game/persistence';
import legacyEarlyLevels from '../../../assets/content/legacy-early-levels.json';

import world1 from '../../../assets/levels/world1.json';
import world2 from '../../../assets/levels/world2.json';
import world3 from '../../../assets/levels/world3.json';
import world4 from '../../../assets/levels/world4.json';
import world5 from '../../../assets/levels/world5.json';
import world6 from '../../../assets/levels/world6.json';
import world7 from '../../../assets/levels/world7.json';
import world8 from '../../../assets/levels/world8.json';
import world9 from '../../../assets/levels/world9.json';
import world10 from '../../../assets/levels/world10.json';
import world11 from '../../../assets/levels/world11.json';
import world12 from '../../../assets/levels/world12.json';
import world13 from '../../../assets/levels/world13.json';
import world14 from '../../../assets/levels/world14.json';


interface Pack {
  world: string;
  levels: Level[];
}

const PACKS: Record<string, Pack> = {
  world1: world1 as unknown as Pack,
  world2: world2 as unknown as Pack,
  world3: world3 as unknown as Pack,
  world4: world4 as unknown as Pack,
  world5: world5 as unknown as Pack,
  world6: world6 as unknown as Pack,
  world7: world7 as unknown as Pack,
  world8: world8 as unknown as Pack,
  world9: world9 as unknown as Pack,
  world10: world10 as unknown as Pack,
  world11: world11 as unknown as Pack,
  world12: world12 as unknown as Pack,
  world13: world13 as unknown as Pack,
  world14: world14 as unknown as Pack,
};

const WORLD_ORDER = WORLDS.map((world) => world.id);

function worldStart(world: string): number {
  let start = 1;
  for (const id of WORLD_ORDER) {
    if (id === world) return start;
    start += PACKS[id]?.levels.length ?? 0;
  }
  return 1;
}

function withGlobalId(level: Level, world: string): Level {
  const globalId = level.globalId ?? worldStart(world) + level.id - 1;
  // V1 packs remain loadable while V2 packs expose the exhaustive accepted layer.
  return {
    ...level,
    world,
    globalId,
    acceptedBonus: level.acceptedBonus ?? level.bonusPool ?? [],
    rewardedBonus: level.rewardedBonus ?? [],
    contentVersion: level.contentVersion ?? 'legacy',
    fingerprint: level.fingerprint ?? `${globalId}:${level.letters.join('')}:${level.answers.map((a) => a.word).join(',')}`,
    mechanic: level.mechanic ?? 'classic',
    milestone: level.milestone ?? null,
  };
}

/** Дев-гард: валидируем уровень один раз и явно логируем, какой именно сломан. */
const validated = new Set<string>();
function checkLevel(world: string, level: Level): void {
  const key = `${world}:${level.id}:${level.fingerprint ?? level.contentVersion ?? 'legacy'}`;
  if (validated.has(key)) return;
  validated.add(key);
  const res = validateLevel(level);
  if (!res.ok) {
    console.warn(`[levels] невалидный уровень ${key}: ${res.errors.join(', ')}`);
  }
}

export function loadLevel(world: string, id: number): Level | null {
  const pack = PACKS[world];
  if (!pack) return null;
  const level = pack.levels.find((l) => l.id === id) ?? null;
  const hydrated = level ? withGlobalId(level, world) : null;
  if (hydrated && __DEV__) checkLevel(world, hydrated);
  return hydrated;
}

/** Released pack lookup for audits and pinned daily content. */
export function loadReleasedGlobalLevel(id: number): Level | null {
  let offset = 0;
  for (const world of WORLD_ORDER) {
    const pack = PACKS[world];
    const count = pack?.levels.length ?? 0;
    if (id > offset && id <= offset + count) {
      const local = id - offset;
      const level = pack.levels.find((l) => l.id === local) ?? null;
      if (level && __DEV__) checkLevel(world, level);
      return level ? withGlobalId(level, world) : null;
    }
    offset += count;
  }
  return null;
}

/** Resolve a fingerprint-pinned daily template independently of campaign updates. */
export function loadVerifiedReleasedGlobalLevel(id: number, fingerprint: string): Level | null {
  const current = loadReleasedGlobalLevel(id);
  if (current?.fingerprint === fingerprint && validateLevel(current).ok) return current;
  const legacy = legacyEarlyLevels.campaign.find((level) => level.globalId === id
    && level.fingerprint === fingerprint) as unknown as Level | undefined;
  return legacy && validateLevel(legacy).ok ? legacy : null;
}

export function loadGlobalLevel(id: number): Level | null {
  // A content revision must not replace an unfinished or pending saved puzzle.
  // Only archived bundled content matching the snapshot's identity can resume.
  const saved = loadGameSnapshot('normal');
  if (saved?.globalLevel === id
    && ['playing', 'completion_pending', 'reward_claimed'].includes(saved.completion.status)
    && typeof saved.attemptId === 'string' && saved.attemptId.length > 0
    && saved.filled != null && typeof saved.filled === 'object' && !Array.isArray(saved.filled)) {
    const legacy = [...legacyEarlyLevels.campaign, ...legacyEarlyLevels.intro]
      .find((candidate) => candidate.globalId === id
        && candidate.id === saved.levelId
        && candidate.contentVersion === saved.contentVersion
        && candidate.fingerprint === saved.levelFingerprint) as unknown as Level | undefined;
    if (legacy && validateLevel(legacy).ok && restoreGame(legacy, 'normal', saved)) {
      return legacy;
    }
  }
  if (hasIntroPackAssignment()) {
    const intro = getIntroLevel(id);
    if (intro) {
      if (__DEV__) checkLevel(intro.world, intro);
      return intro;
    }
  }
  return loadReleasedGlobalLevel(id);
}

export function worldLevelCount(world: string): number {
  return PACKS[world]?.levels.length ?? 0;
}

export function totalLevelCount(): number {
  return WORLD_ORDER.reduce((sum, world) => sum + worldLevelCount(world), 0);
}

export function worldForGlobalLevel(id: number): string {
  let offset = 0;
  for (const world of WORLD_ORDER) {
    offset += worldLevelCount(world);
    if (id <= offset) return world;
  }
  return WORLD_ORDER[WORLD_ORDER.length - 1];
}

export const DEFAULT_WORLD = 'world1';
