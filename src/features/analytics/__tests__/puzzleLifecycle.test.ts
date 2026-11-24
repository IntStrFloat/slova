/* eslint-disable import/first */
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: jest.fn(() => true),
  isAppMetricaAvailable: jest.fn(() => true),
  setDataSendingEnabled: jest.fn(() => true),
  isAppMetricaTestDevice: jest.fn(() => false),
  getDataSendingPreference: jest.fn(() => null),
}));

import { reportEvent } from '@/core/native/appmetrica';
import { storage } from '@/core/storage';
import { initPlayState } from '@/core/engine/types';
import { serializeGame } from '@/features/game/persistence';
import { getIntroLevel } from '@/features/onboarding/introPack';

import { getAnalyticsHealth, useAnalyticsPrefs } from '../index';
import { puzzleIdentity, trackPuzzleCheckpoint, trackPuzzleCompletion, trackPuzzleEntry, trackPuzzleExited, trackPuzzlePaused } from '../puzzleLifecycle';

const report = reportEvent as jest.Mock;
const level = getIntroLevel(1)!;
const originalDev = __DEV__;

function freshSnapshot() {
  return {
    ...serializeGame(level, initPlayState(level), level.letters, 'normal'),
    createdAt: '2026-10-01T09:00:00.000Z', activeTimeMs: 18000,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-01T09:00:00.000Z'));
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
  useAnalyticsPrefs.getState().setOptOut(true);
  storage.clearAll();
  useAnalyticsPrefs.getState().setOptOut(false);
  jest.setSystemTime(new Date('2026-10-01T09:01:00.000Z'));
  report.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: originalDev });
});

test('a fresh attempt starts once; restoring it never invents another start', () => {
  const snapshot = freshSnapshot();
  trackPuzzleEntry(level, snapshot);
  trackPuzzleEntry(level, snapshot);
  trackPuzzleEntry(level, snapshot, { restoredAttemptId: snapshot.attemptId });
  trackPuzzleEntry(level, snapshot, { restoredAttemptId: snapshot.attemptId });
  expect(report.mock.calls.map(([name]) => name)).toEqual(['puzzle_started', 'puzzle_resumed']);
  expect(report.mock.calls[0][1]).toMatchObject({
    content_version: level.contentVersion,
    attemptId: snapshot.attemptId, levelKey: 'campaign:1', isResume: false,
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
    attemptId: snapshot.attemptId, assisted: true, assistanceType: 'semantic',
    activeTimeMs: 18000, durationSec: 30, completionSource: 'submit',
    actionDay: '2026-10-01', mode: 'campaign', levelKey: 'campaign:1',
  });
  expect(report.mock.calls[0][1]).not.toHaveProperty('dateKey');
});

test('daily repeat requires another action day, not two archive puzzles on one day', () => {
  const snapshot = { ...freshSnapshot(), mode: 'daily' as const, dailyId: '2026-09-25',
    completion: { status: 'completion_pending' as const, source: 'submit' as const,
      completedAt: '2026-10-01T09:00:30.000Z' } };
  trackPuzzleCompletion(level, snapshot, { introPlayer: true, assisted: false,
    dailyActionDays: ['2026-10-01', '2026-10-01'] });
  expect(report.mock.calls.map(([name]) => name)).toEqual(['puzzle_completed']);
  expect(report.mock.calls[0][1]).toMatchObject({ mode: 'daily', dateKey: '2026-09-25', actionDay: '2026-10-01', levelKey: 'daily:2026-09-25' });
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
  const properties = report.mock.calls[0][1];
  expect(properties).not.toHaveProperty('occurredAtMs');
  expect(properties).not.toHaveProperty('durationSec');
  expect(properties).not.toHaveProperty('activeTimeMs');
});

test('durable progress payloads preserve their declared aggregate fields after the native boundary', () => {
  const snapshot = { ...freshSnapshot(), mistakes: 2, semanticHelpUsed: true, revision: 4 };
  trackPuzzleCheckpoint(level, snapshot, 'interval');
  trackPuzzlePaused(level, snapshot, 'pause-a', 'ad');
  trackPuzzleExited(level, snapshot, 'exit-a', 'menu_home', 'invalid');
  expect(report.mock.calls.map(([name]) => name)).toEqual(['puzzle_checkpoint', 'puzzle_paused', 'puzzle_exited']);
  for (const [, props] of report.mock.calls) {
    expect(props).toMatchObject({ attemptId: snapshot.attemptId, revision: 4,
      errors: 2, hints_count: 1, target: level.answers.length, time_coverage: 'full_attempt' });
    expect(props.content_fingerprint).toMatch(/^fp_[a-f0-9]{16}$/);
  }
  expect(report.mock.calls[0][1].reason).toBe('interval');
  expect(getAnalyticsHealth().schema_rejected).toBe(0);
});

test('compact content characteristics cross the real analytics boundary only on attempt start/resume', () => {
  const configured = { ...level, difficultyTier: 4 as const, difficultyRole: 'hard' as const, mechanic: 'ordered' as const };
  const snapshot = freshSnapshot();
  trackPuzzleEntry(configured, snapshot);
  trackPuzzleEntry(configured, snapshot, { restoredAttemptId: snapshot.attemptId });
  expect(report.mock.calls.map(([name]) => name)).toEqual(['puzzle_started', 'puzzle_resumed']);
  for (const [, properties] of report.mock.calls) {
    expect(properties).toMatchObject({ difficulty_tier: 4, difficulty_role: 'hard', mechanic: 'ordered',
      letter_count: configured.letters.length, target_count: configured.answers.length });
    expect(properties).not.toHaveProperty('letters');
    expect(properties).not.toHaveProperty('answers');
  }
  expect(puzzleIdentity(configured, snapshot)).not.toHaveProperty('difficulty_tier');
  expect(puzzleIdentity(configured, snapshot)).not.toHaveProperty('letter_count');
  expect(getAnalyticsHealth().schema_rejected).toBe(0);
});

test('legacy content without a reliable tier does not invent a difficulty assignment', () => {
  const legacy = { ...level, difficultyTier: undefined, difficultyRole: undefined, mechanic: undefined };
  trackPuzzleEntry(legacy, freshSnapshot());
  expect(report.mock.calls[0][1]).toMatchObject({ mechanic: 'classic', letter_count: level.letters.length });
  expect(report.mock.calls[0][1]).not.toHaveProperty('difficulty_tier');
  expect(report.mock.calls[0][1]).not.toHaveProperty('difficulty_role');
});
