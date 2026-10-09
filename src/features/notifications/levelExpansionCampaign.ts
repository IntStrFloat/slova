/** Frozen identity: reuse this topic for the single 500 → 1000 announcement. */
export const LEVEL_EXPANSION_CAMPAIGN = {
  id: 'levels-expanded-1000-v1',
  topic: 'slova_levels_expanded_1000_v1',
  minCurrentLevel: 500,
  maxCurrentLevel: 1000,
} as const;

export function isLevelExpansionAudience(currentLevel: number, notifications: boolean): boolean {
  return notifications === true
    && Number.isInteger(currentLevel)
    && currentLevel >= LEVEL_EXPANSION_CAMPAIGN.minCurrentLevel
    && currentLevel <= LEVEL_EXPANSION_CAMPAIGN.maxCurrentLevel;
}
