import { getJSON, KEYS, storage } from '@/core/storage';

import { loadAdsMeta } from './index';

const SESSION_KEY = 'ads.gameplay-session.v1';

interface SavedSession {
  version: 1;
  firstRuntimeId: string;
  lastRuntimeId: string;
}

export interface GameplayAdSession {
  sessionId: string;
  isFirstGameplaySession: boolean;
}

/** Capture before opening a new board creates its first snapshot. */
function hadGameplayBeforeStartup(): boolean {
  const meta = loadAdsMeta();
  if (meta.campaignCompletedIds.length > 0 || meta.lifetimeVisibleGameplaySec > 0
    || meta.lastInterstitialAt !== null) return true;
  return [KEYS.gameCurrent, KEYS.gameCurrentNormal, KEYS.gameCurrentDaily]
    .some((key) => getJSON<{ attemptId?: unknown } | null>(key, null)?.attemptId != null);
}

/** A JS runtime is one visit. Background/resume and analytics never rotate it. */
export function createGameplayAdSession(runtimeId: string, returningPlayer = hadGameplayBeforeStartup()) {
  let cached: GameplayAdSession | null = null;
  return (): GameplayAdSession => {
    if (cached) return cached;
    const saved = getJSON<Partial<SavedSession> | null>(SESSION_KEY, null);
    const valid = saved?.version === 1 && typeof saved.firstRuntimeId === 'string'
      && saved.firstRuntimeId.length > 0 && typeof saved.lastRuntimeId === 'string'
      && saved.lastRuntimeId.length > 0;
    const firstRuntimeId = valid ? saved.firstRuntimeId! : returningPlayer ? 'legacy-player' : runtimeId;
    const session = { sessionId: runtimeId, isFirstGameplaySession: firstRuntimeId === runtimeId };
    try {
      if (!valid || saved.lastRuntimeId !== runtimeId) {
        // A cold launch starts the visit's interval; background never calls this again.
        // Preserve hourly history and any unfinished rewarded cooldown.
        storage.set(KEYS.adsMeta, JSON.stringify({
          ...loadAdsMeta(),
          visibleGameplaySinceInterstitialSec: 0,
          newCampaignCompletionsSinceFullscreen: 0,
        }));
        storage.set(SESSION_KEY, JSON.stringify({ version: 1, firstRuntimeId, lastRuntimeId: runtimeId }));
      }
      cached = session;
      return session;
    } catch {
      // A failed optional save must not block gameplay or expose a new player to ads.
      return { sessionId: runtimeId, isFirstGameplaySession: true };
    }
  };
}

const runtimeId = `game:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
export const beginGameplayAdSession = createGameplayAdSession(runtimeId);
