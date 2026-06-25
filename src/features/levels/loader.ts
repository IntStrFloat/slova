import type { Level } from '@/core/engine';

import world1 from '../../../assets/levels/world1.json';

interface Pack {
  world: string;
  levels: Level[];
}

const PACKS: Record<string, Pack> = {
  world1: world1 as unknown as Pack,
};

export function loadLevel(world: string, id: number): Level | null {
  const pack = PACKS[world];
  if (!pack) return null;
  return pack.levels.find((l) => l.id === id) ?? null;
}

export function worldLevelCount(world: string): number {
  return PACKS[world]?.levels.length ?? 0;
}

export const DEFAULT_WORLD = 'world1';
