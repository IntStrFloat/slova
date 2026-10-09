import { totalCampaignLevels, WORLDS } from '@/core/config/worlds';

export interface RouteCardProgress {
  title: string;
  image: number;
  completedLevel: number;
  nextCardId: string;
  nextCardTitle: string;
  nextCardImage: number;
  nextWorldId: string;
  targetLevel: number;
  previousLevel: number;
  completedInStep: number;
  stepLevels: number;
  remaining: number;
  fraction: number;
}

/** The next postcard is determined only by the completed absolute campaign level. */
export function routeCardProgress(completedLevel: number): RouteCardProgress | null {
  const level = Number.isFinite(completedLevel)
    ? Math.max(0, Math.min(totalCampaignLevels(), Math.trunc(completedLevel)))
    : 0;
  let previousLevel = 0;
  for (const world of WORLDS) {
    for (const card of world.landmarks) {
      if (card.untilLevel > level) {
        const stepLevels = card.untilLevel - previousLevel;
        const completedInStep = level - previousLevel;
        return {
          title: card.title,
          image: card.image,
          completedLevel: level,
          nextCardId: card.id,
          nextCardTitle: card.title,
          nextCardImage: card.image,
          nextWorldId: world.id,
          targetLevel: card.untilLevel,
          previousLevel,
          completedInStep,
          stepLevels,
          remaining: card.untilLevel - level,
          fraction: completedInStep / stepLevels,
        };
      }
      previousLevel = card.untilLevel;
    }
  }
  return null;
}
