import type { Level } from '@/core/engine';

const PERCENT_BY_TIER = [95, 85, 70, 50, 35] as const;

/** User-requested mock social proof, derived from authored difficulty; NOT analytics. */
export function mockLevelCompletionPercent(level: Level): number {
  const tier = level.difficultyTier ?? Math.max(1, Math.min(5, level.letters.length - 2));
  const roleAdjustment = level.difficultyRole === 'easy' || level.difficultyRole === 'breather' ? 5
    : level.difficultyRole === 'hard' || level.difficultyRole === 'climax' ? -5 : 0;
  return Math.max(30, Math.min(95, PERCENT_BY_TIER[tier - 1] + roleAdjustment));
}
