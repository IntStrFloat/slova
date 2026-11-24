import { KEYS, storage } from '@/core/storage';

import { reviewEligibility, reserveReviewAttempt, REVIEW_POLICY, type ReviewContext } from '../policy';

const now = Date.UTC(2026, 10, 4);
const context: ReviewContext = { levelId: 10, completedCount: 10, firstCompletion: true,
  postcardMilestone: true, daily: false };

beforeEach(() => storage.clearAll());

test.each([
  [{ daily: true }, 'daily'],
  [{ firstCompletion: false }, 'repeated'],
  [{ postcardMilestone: false }, 'not_milestone'],
  [{ levelId: 9 }, 'threshold'],
  [{ completedCount: 9 }, 'threshold'],
  [{ levelId: NaN }, 'threshold'],
] as const)('suppression reason is explicit without consuming an attempt: %o', (change, reason) => {
  expect(reviewEligibility({ ...context, ...change }, now)).toEqual({ eligible: false, reason });
  expect(storage.getString(KEYS.reviewPrompt)).toBeUndefined();
});

test('exact boundaries preserve the old policy and distinguish cooldown from additional progress', () => {
  expect(reviewEligibility(context, now)).toEqual({ eligible: true, reason: 'eligible' });
  expect(reserveReviewAttempt(context, now)).toBe(true);
  const next = { ...context, levelId: 30, completedCount: 30 };
  expect(reviewEligibility(next, now + REVIEW_POLICY.cooldownMs - 1).reason).toBe('cooldown');
  expect(reviewEligibility({ ...next, completedCount: 29 }, now + REVIEW_POLICY.cooldownMs).reason).toBe('additional_progress');
  expect(reviewEligibility(next, now + REVIEW_POLICY.cooldownMs)).toEqual({ eligible: true, reason: 'eligible' });
  expect(reviewEligibility({ ...context, completedCount: 40 }, now + REVIEW_POLICY.cooldownMs).reason).toBe('same_level');
});

test.each([
  [{ handled: true, attempts: 1 }, 'handled'],
  [{ attempts: 3 }, 'max_attempts'],
] as const)('old stored control remains authoritative: %o', (saved, reason) => {
  storage.set(KEYS.reviewPrompt, JSON.stringify({ version: 1, ...saved }));
  expect(reviewEligibility(context, now)).toEqual({ eligible: false, reason });
  expect(JSON.parse(storage.getString(KEYS.reviewPrompt)!)).toEqual({ version: 1, ...saved });
});
