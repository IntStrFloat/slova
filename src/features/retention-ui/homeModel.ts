import type { Level } from '@/core/engine/types';
import { isLevelComplete } from '@/core/engine/play';
import { restoreGame, type GameSnapshot } from '@/features/game/persistence';
import type { RouteCardProgress } from '@/features/collection/routeProgress';
import type { CollectibleView } from '@/features/retention';

export function nextHomePostcard(route: RouteCardProgress | null, journey: {
  nextCollectibleId: string | null; remaining: number | null; completedAfterAnchor: number; nextPostcardAt: number | null;
}, cards: CollectibleView[]): { title: string; image?: number; remaining: number; fraction: number } | null {
  const next = cards.find((card) => card.id === journey.nextCollectibleId && !card.owned);
  if (next && journey.remaining !== null && journey.nextPostcardAt !== null &&
    (!route || journey.remaining < route.remaining)) {
    const target = journey.nextPostcardAt;
    const previous = Math.max(0, ...cards.filter((card) => card.kind === 'journey' && card.threshold !== null && card.threshold < target)
      .map((card) => card.threshold ?? 0));
    const fraction = Math.min(1, Math.max(0, (journey.completedAfterAnchor - previous) / Math.max(1, target - previous)));
    return { title: next.title, image: next.image, remaining: journey.remaining, fraction };
  }
  return route ? { title: route.nextCardTitle, image: route.nextCardImage, remaining: route.remaining, fraction: route.fraction } : null;
}

/** An early visit to the menu is intentional; later cold launches stay there. */
export function shouldAutoOpenIntro(assigned: boolean, completed: number, surface: string | null): boolean {
  return assigned && completed < 5 && surface !== 'menu';
}

export function pendingNormalResultLevel(snapshot: GameSnapshot | null, loadLevel: (id: number) => Level | null): number | null {
  if (!snapshot || snapshot.mode !== 'normal' || !Number.isInteger(snapshot.globalLevel) || snapshot.globalLevel < 1
    || typeof snapshot.attemptId !== 'string' || !snapshot.attemptId
    || !Array.isArray(snapshot.solvedWords) || !Array.isArray(snapshot.foundBonus)
    || !snapshot.filled || typeof snapshot.filled !== 'object' || Array.isArray(snapshot.filled)
    || !['completion_pending', 'reward_claimed'].includes(snapshot.completion?.status)) return null;
  const level = loadLevel(snapshot.globalLevel);
  const restored = level && restoreGame(level, 'normal', snapshot);
  return restored && isLevelComplete(restored.play) ? snapshot.globalLevel : null;
}

export function homePlayLabel(level: number, hasPartialProgress: boolean, campaignComplete: boolean, hasPendingResult = false): string {
  if (hasPendingResult) return `Результат уровня ${level}`;
  if (campaignComplete) return 'Кроссворд дня';
  return `${hasPartialProgress ? 'Продолжить' : 'Играть'} — уровень ${level}`;
}

export function normalLevelProgress(
  snapshot: GameSnapshot | null,
  level: number,
  answerCount: number | null,
): { hasPartialProgress: boolean; label: string | null } {
  if (!snapshot || snapshot.mode !== 'normal' || snapshot.globalLevel !== level || snapshot.completion.status !== 'playing') {
    return { hasPartialProgress: false, label: null };
  }
  const found = snapshot.solvedWords.length;
  const opened = Object.keys(snapshot.filled).length;
  if (found === 0 && opened === 0) return { hasPartialProgress: false, label: null };
  const count = answerCount !== null && answerCount > 0 ? ` из ${answerCount}` : '';
  return {
    hasPartialProgress: true,
    label: `Найдено слов: ${found}${count}. Прогресс сохранён.`,
  };
}
