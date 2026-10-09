import { COLLECTIBLE_CATALOG } from '@/core/config/retention';
import { allLandmarks } from '@/core/config/worlds';

const artById = new Map(allLandmarks().map((landmark) => [landmark.id, landmark.image]));
const covers = new Map(COLLECTIBLE_CATALOG.filter((item) => item.kind === 'cover').map((item) => [item.id, item.artId]));

/** Resolve only published local cover art; ownership is checked by callers. */
export function publishedCoverImage(id: string | null): number | null {
  if (!id) return null;
  const artId = covers.get(id);
  return artId ? artById.get(artId) ?? null : null;
}

/** Only an owned, published cover with local art may replace the default world photo. */
export function coverImageForId(id: string | null, ownedCollectibles: Record<string, unknown>): number | null {
  return id && ownedCollectibles[id] ? publishedCoverImage(id) : null;
}
