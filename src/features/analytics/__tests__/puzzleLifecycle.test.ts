/* eslint-disable import/first */
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: jest.fn(() => true),
  isAppMetricaAvailable: jest.fn(() => true),
}));

import { reportEvent } from '@/core/native/appmetrica';
import { storage } from '@/core/storage';
import { initPlayState } from '@/core/engine/types';
import { serializeGame } from '@/features/game/persistence';
import { getIntroLevel } from '@/features/onboarding/introPack';

import { useAnalyticsPrefs } from '../index';
import { trackPuzzleCompletion, trackPuzzleEntry } from '../puzzleLifecycle';

const report = reportEvent as jest.Mock;
const level = getIntroLevel(1)!;

function freshSnapshot() {
  return {
    ...serializeGame(level, initPlayState(level), level.letters, 'normal'),
    createdAt: '2026-10-01T09:00:00.000Z', activeTimeMs: 18000,
  };
}

beforeEach(() => {
  useAnalyticsPrefs.getState().setOptOut(true);
  storage.clearAll();
  useAnalyticsPrefs.getState().setOptOut(false);
  report.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('a fresh attempt starts once; restoring it never invents another start', () => {
  const snapshot = freshSnapshot();
  trackPuzzleEntry(level, snapshot);
  trackPuzzleEntry(level, snapshot);
  trackPuzzleEntry(level, snapshot, { restoredAttemptId: snapshot.attemptId });
  trackPuzzleEntry(level, snapshot, { restoredAttemptId: snapshot.attemptId });
  expect(report.mock.calls.map(([name]) => name)).toEqual(['puzzle_started', 'puzzle_resumed']);
  expect(report.mock.calls[0][1]).toMatchObject({
    content_version: level.contentVersion,
    properties: { attemptId: snapshot.attemptId, levelKey: 'campaign:1', isResume: false },
  });
  const another = { ...snapshot, attemptId: `${snapshot.attemptId}:next` };
  trackPuzzleEntry(level, another);
  expect(report.mock.calls.filter(([name]) => name === 'puzzle_started')).toHaveLength(2);
});

test('a historical restore is resume-only and a restored result is not play', () => {
  const snapshot = freshSnapshot();
  trackPuzzleEntry(level, snapshot, { restoredAttemptId: snapshot.attemptId });
  expect(report.mock.calls.map(([name]) => name)).toEqual(['puzzle_resumed']);
  expect(trackPuzzleEntry(level, { ...snapshot, completion: { status: 'completion_pending' } })).toBeNull();
  expect(trackPuzzleEntry(level, { ...snapshot, completion: { status: 'reward_claimed' } })).toBeNull();
  expect(report).toHaveBeenCalledTimes(1);
});

test('a win preserves attempt, assistance and actual content and occurrence time on replay', () => {
  const snapshot = {
    ...freshSnapshot(),
    completion: { status: 'completion_pending' as const, source: 'submit' as const,
      completedAt: '2026-10-01T09:00:30.000Z' },
  };
  const options = { introPlayer: true, assisted: true, assistanceType: 'semantic' };
  trackPuzzleCompletion(level, snapshot, options);
  trackPuzzleCompletion(level, snapshot, options);
  expect(report.mock.calls.map(([name]) => name)).toEqual(['puzzle_completed', 'first_level_completed']);
  expect(report.mock.calls[0][1]).toMatchObject({
    occurred_at: snapshot.completion.completedAt,
    content_version: level.contentVersion,
    properties: { attemptId: snapshot.attemptId, assisted: true, assistanceType: 'semantic',
      activeTimeMs: 18000, durationSec: 30, completionSource: 'submit' },
  });
});

test('daily repeat requires another action day, not two archive puzzles on one day', () => {
  const snapshot = { ...freshSnapshot(), mode: 'daily' as const, dailyId: '2026-09-25',
    completion: { status: 'completion_pending' as const, source: 'submit' as const,
      completedAt: '2026-10-01T09:00:30.000Z' } };
  trackPuzzleCompletion(level, snapshot, { introPlayer: true, assisted: false,
    dailyActionDays: ['2026-10-01', '2026-10-01'] });
  expect(report.mock.calls.map(([name]) => name)).toEqual(['puzzle_completed']);
  trackPuzzleCompletion(level, snapshot, { introPlayer: true, assisted: false,
    dailyActionDays: ['2026-09-30', '2026-10-01'] });
  trackPuzzleCompletion(level, snapshot, { introPlayer: true, assisted: false,
    dailyActionDays: ['2026-09-30', '2026-10-01'] });
  expect(report.mock.calls.map(([name]) => name)).toEqual(['puzzle_completed', 'daily_repeat_completed']);
});

test('a legacy result without original timing does not invent elapsed or active totals', () => {
  const snapshot = { ...freshSnapshot(), createdAt: undefined, activeTimeMs: 0,
    completion: { status: 'completion_pending' as const, source: 'submit' as const } };
  trackPuzzleCompletion(level, snapshot, { introPlayer: false, assisted: false });
  const properties = report.mock.calls[0][1].properties;
  expect(properties).not.toHaveProperty('occurredAtMs');
  expect(properties).not.toHaveProperty('durationSec');
  expect(properties).not.toHaveProperty('activeTimeMs');
});
