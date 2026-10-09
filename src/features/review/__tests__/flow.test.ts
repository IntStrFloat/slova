import { AppState } from 'react-native';

import { discard, isAvailable, launch, prepare } from '../../../../modules/rustore-review';
import { storage } from '@/core/storage';
import { requestCampaignReview } from '../index';
import { readReviewState } from '../policy';

jest.mock('../../../../modules/rustore-review', () => ({ discard: jest.fn(), isAvailable: jest.fn(), prepare: jest.fn(), launch: jest.fn() }));
const context = { levelId: 10, completedCount: 10, firstCompletion: true, postcardMilestone: true, daily: false };

beforeEach(() => {
  storage.clearAll();
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.mocked(isAvailable).mockReturnValue(true);
  jest.mocked(prepare).mockResolvedValue(true);
  jest.mocked(launch).mockResolvedValue('completed');
});
afterEach(() => jest.useRealTimers());

test('uses native form and records completion without claiming a published rating', async () => {
  expect(await requestCampaignReview(context)).toBe('completed');
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(readReviewState()).toMatchObject({ attempts: 1, handled: true });
  expect(await requestCampaignReview(context)).toBe('skipped');
});

test('missing module, background, daily and replay do not prompt', async () => {
  jest.mocked(isAvailable).mockReturnValue(false);
  expect(await requestCampaignReview(context)).toBe('skipped');
  jest.mocked(isAvailable).mockReturnValue(true);
  AppState.currentState = 'background';
  expect(await requestCampaignReview(context)).toBe('skipped');
  AppState.currentState = 'active';
  expect(await requestCampaignReview({ ...context, daily: true })).toBe('skipped');
  expect(await requestCampaignReview({ ...context, firstCompletion: false })).toBe('skipped');
  expect(prepare).not.toHaveBeenCalled();
});

test('unavailable SDK and failures do not block gameplay or mark a review published', async () => {
  jest.mocked(prepare).mockResolvedValue(false);
  expect(await requestCampaignReview(context)).toBe('unavailable');
  expect(launch).not.toHaveBeenCalled();
  expect(readReviewState().handled).toBe(false);
  storage.clearAll();
  jest.mocked(prepare).mockRejectedValue(new Error('offline'));
  expect(await requestCampaignReview(context)).toBe('error');
  storage.clearAll();
  jest.mocked(prepare).mockResolvedValue(true);
  jest.mocked(launch).mockResolvedValue('error');
  expect(await requestCampaignReview(context)).toBe('error');
});

test('concurrent taps cannot start two forms and open form has no timeout', async () => {
  jest.useFakeTimers();
  let complete!: (value: 'completed') => void;
  jest.mocked(launch).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const pending = requestCampaignReview(context);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(await requestCampaignReview(context)).toBe('skipped');
  await jest.advanceTimersByTimeAsync(600_000);
  expect(readReviewState().handled).toBe(false);
  complete('completed');
  expect(await pending).toBe('completed');
  expect(launch).toHaveBeenCalledTimes(1);
});

test('slow preparation cannot launch a surprise form after advancing', async () => {
  jest.useFakeTimers();
  let finishPreparation!: (value: boolean) => void;
  jest.mocked(prepare).mockImplementationOnce(() => new Promise((resolve) => { finishPreparation = resolve; }));
  const pending = requestCampaignReview(context);
  await jest.advanceTimersByTimeAsync(1500);
  expect(await pending).toBe('unavailable');
  expect(discard).toHaveBeenCalledTimes(1);
  finishPreparation(true);
  await Promise.resolve();
  expect(launch).not.toHaveBeenCalled();
});

test('backgrounding while preparing prevents launch', async () => {
  jest.mocked(prepare).mockImplementationOnce(async () => { AppState.currentState = 'background'; return true; });
  expect(await requestCampaignReview(context)).toBe('unavailable');
  expect(launch).not.toHaveBeenCalled();
});
