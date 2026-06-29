import type { Level } from '@/core/engine';
import { validateLevel } from '@/core/engine';

import world1 from '../../../assets/levels/world1.json';
import world2 from '../../../assets/levels/world2.json';
import world3 from '../../../assets/levels/world3.json';

interface Pack {
  world: string;
  levels: Level[];
}

const PACKS: Record<string, Pack> = {
  world1: world1 as unknown as Pack,
  world2: world2 as unknown as Pack,
  world3: world3 as unknown as Pack,
};

const WORLD_ORDER = ['world1', 'world2', 'world3'] as const;

function worldStart(world: string): number {
  let start = 1;
  for (const id of WORLD_ORDER) {
    if (id === world) return start;
    start += PACKS[id]?.levels.length ?? 0;
  }
  return 1;
}

function withGlobalId(level: Level, world: string): Level {
  return { ...level, world, id: worldStart(world) + level.id - 1 };
}

/** Дев-гард: валидируем уровень один раз и явно логируем, какой именно сломан. */
const validated = new Set<string>();
function checkLevel(world: string, level: Level): void {
  const key = `${world}:${level.id}`;
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
  if (level && __DEV__) checkLevel(world, level);
  return level;
}

export function loadGlobalLevel(id: number): Level | null {
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
