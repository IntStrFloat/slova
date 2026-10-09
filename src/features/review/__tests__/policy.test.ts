import { KEYS, storage } from '@/core/storage';

import { isReviewEligible, markReviewHandled, readReviewState, reserveReviewAttempt, REVIEW_POLICY, type ReviewContext } from '../policy';

const now = Date.UTC(2026, 9, 1);
const milestone: ReviewContext = { levelId: 10, completedCount: 10, firstCompletion: true, postcardMilestone: true, daily: false };

beforeEach(() => storage.clearAll());

test('a committed first postcard milestone from level ten qualifies', () => {
  expect(isReviewEligible(milestone, now)).toBe(true);
  for (const override of [{ levelId: 5, completedCount: 5 }, { daily: true }, { postcardMilestone: false },
    { firstCompletion: false }, { completedCount: 9 }, { levelId: NaN }]) {
    expect(isReviewEligible({ ...milestone, ...override }, now)).toBe(false);
  }
});

test('reservation survives restarts, repeated taps, backwards clocks and progress resets', () => {
  expect(reserveReviewAttempt(milestone, now)).toBe(true);
  expect(reserveReviewAttempt(milestone, now)).toBe(false);
  const next = { ...milestone, levelId: 30, completedCount: 30 };
  expect(isReviewEligible(next, now - 1)).toBe(false);
  expect(isReviewEligible(next, now + REVIEW_POLICY.cooldownMs - 1)).toBe(false);
  expect(isReviewEligible({ ...next, completedCount: 29 }, now + REVIEW_POLICY.cooldownMs)).toBe(false);
  expect(isReviewEligible(next, now + REVIEW_POLICY.cooldownMs)).toBe(true);
  expect(isReviewEligible(milestone, now + REVIEW_POLICY.cooldownMs)).toBe(false);
  expect(readReviewState().attempts).toBe(1);
});

test('SDK completion including dismissal stops future automatic requests', () => {
  reserveReviewAttempt(milestone, now);
  markReviewHandled();
  expect(isReviewEligible({ ...milestone, levelId: 100, completedCount: 100 }, now + 10 * REVIEW_POLICY.cooldownMs)).toBe(false);
});

test('at most three technical attempts', () => {
  for (let index = 0; index < 3; index++) {
    expect(reserveReviewAttempt({ ...milestone, levelId: 10 + index * 20, completedCount: 10 + index * 20 },
      now + index * REVIEW_POLICY.cooldownMs)).toBe(true);
  }
  expect(isReviewEligible({ ...milestone, levelId: 100, completedCount: 100 }, now + 10 * REVIEW_POLICY.cooldownMs)).toBe(false);
});

test('damaged primitive/null state is safe and handled state is retained', () => {
  storage.set(KEYS.reviewPrompt, 'null');
  expect(isReviewEligible(milestone, now)).toBe(true);
  storage.set(KEYS.reviewPrompt, JSON.stringify({ attempts: -1, lastCompletedCount: 'bad', lastAttemptAt: 'bad', handled: true }));
  expect(readReviewState()).toMatchObject({ attempts: 0, lastCompletedCount: 0, lastAttemptAt: null, handled: true });
});

test('failed durable reservation does not silently grant permission to open SDK', () => {
  const write = jest.spyOn(storage, 'set').mockImplementationOnce(() => { throw new Error('disk full'); });
  expect(() => reserveReviewAttempt(milestone, now)).toThrow('disk full');
  expect(readReviewState().attempts).toBe(0);
  write.mockRestore();
});
