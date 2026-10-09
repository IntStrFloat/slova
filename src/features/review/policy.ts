import { getJSON, KEYS, storage } from '@/core/storage';

export const REVIEW_POLICY = {
  minimumCompleted: 10,
  cooldownMs: 30 * 24 * 60 * 60 * 1000,
  additionalCompleted: 20,
  maximumAttempts: 3,
} as const;

export interface ReviewContext {
  levelId: number;
  completedCount: number;
  firstCompletion: boolean;
  postcardMilestone: boolean;
  daily: boolean;
}

interface ReviewState {
  version: 1;
  attempts: number;
  lastAttemptAt: number | null;
  lastCompletedCount: number;
  lastLevelId: number | null;
  handled: boolean;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function readReviewState(): ReviewState {
  const saved = getJSON<Partial<ReviewState> | null>(KEYS.reviewPrompt, null);
  return {
    version: 1,
    attempts: nonNegativeInteger(saved?.attempts),
    lastAttemptAt: typeof saved?.lastAttemptAt === 'number' && Number.isFinite(saved.lastAttemptAt)
      && saved.lastAttemptAt >= 0 ? saved.lastAttemptAt : null,
    lastCompletedCount: nonNegativeInteger(saved?.lastCompletedCount),
    lastLevelId: nonNegativeInteger(saved?.lastLevelId) || null,
    handled: saved?.handled === true,
  };
}

export function isReviewEligible(context: ReviewContext, now = Date.now()): boolean {
  const state = readReviewState();
  if (context.daily || !context.firstCompletion || !context.postcardMilestone
    || !Number.isInteger(context.levelId) || context.levelId < REVIEW_POLICY.minimumCompleted
    || !Number.isInteger(context.completedCount) || context.completedCount < REVIEW_POLICY.minimumCompleted
    || !Number.isFinite(now) || state.handled || state.attempts >= REVIEW_POLICY.maximumAttempts
    || state.lastLevelId === context.levelId) return false;
  return state.lastAttemptAt === null || now - state.lastAttemptAt >= REVIEW_POLICY.cooldownMs
    && context.completedCount - state.lastCompletedCount >= REVIEW_POLICY.additionalCompleted;
}

/** Durable reservation precedes SDK calls: retries, rapid taps and restarts cannot spam. */
export function reserveReviewAttempt(context: ReviewContext, now = Date.now()): boolean {
  if (!isReviewEligible(context, now)) return false;
  const state = readReviewState();
  storage.set(KEYS.reviewPrompt, JSON.stringify({
    ...state, attempts: state.attempts + 1,
    lastAttemptAt: now, lastCompletedCount: context.completedCount, lastLevelId: context.levelId,
  } satisfies ReviewState));
  return true;
}

/** SDK completion includes dismissal; it does not prove any review was published. */
export function markReviewHandled(): void {
  storage.set(KEYS.reviewPrompt, JSON.stringify({ ...readReviewState(), handled: true } satisfies ReviewState));
}
