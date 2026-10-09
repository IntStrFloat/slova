import type { Level } from '@/core/engine/types';
import { dayKey, isDayKey } from '@/core/time';
import type { GameSnapshot } from '@/features/game/persistence';

import { getAnalyticsSession, trackOnce } from './index';

type TimedSnapshot = GameSnapshot & { createdAt?: string; activeTimeMs?: number };

export function puzzleIdentity(level: Level, snapshot: GameSnapshot) {
  const mode = snapshot.mode === 'daily' ? 'daily' : 'campaign';
  const puzzleKey = mode === 'daily' ? snapshot.dailyId : String(level.globalId ?? level.id);
  return {
    attemptId: snapshot.attemptId,
    levelId: level.globalId ?? level.id,
    levelKey: `${mode}:${puzzleKey ?? 'unknown'}`,
    mode,
    contentVersion: snapshot.contentVersion,
  };
}

/** A restored attempt is left-censored on upgrade, never a fresh start. */
export function trackPuzzleEntry(
  level: Level,
  snapshot: TimedSnapshot,
  options: { restoredAttemptId?: string; entrySource?: string } = {},
): 'started' | 'resumed' | null {
  if (snapshot.completion.status !== 'playing') return null;
  const restored = options.restoredAttemptId === snapshot.attemptId;
  const properties = {
    ...puzzleIdentity(level, snapshot),
    entrySource: options.entrySource ?? 'direct',
    isResume: restored,
    firstTime: !restored,
  };
  if (restored) {
    const { sessionId } = getAnalyticsSession();
    trackOnce('puzzle_resumed', `${snapshot.attemptId}:${sessionId}`, properties);
    return 'resumed';
  }
  const createdAt = Date.parse(snapshot.createdAt ?? '');
  trackOnce('puzzle_started', snapshot.attemptId, {
    ...properties,
    ...(Number.isFinite(createdAt) ? { createdAtMs: createdAt, occurredAtMs: createdAt } : {}),
  });
  return 'started';
}

export function trackPuzzleCompletion(
  level: Level,
  snapshot: TimedSnapshot,
  options: {
    introPlayer: boolean;
    assisted: boolean;
    assistanceType?: string;
    dailyActionDays?: readonly string[];
  },
): void {
  if (snapshot.completion.status === 'playing') return;
  const identity = puzzleIdentity(level, snapshot);
  const completedAt = Date.parse(snapshot.completion.completedAt ?? '');
  const createdAt = Date.parse(snapshot.createdAt ?? '');
  const calendarAt = Number.isFinite(completedAt) ? completedAt : Date.parse(snapshot.updatedAt);
  const actionDay = Number.isFinite(calendarAt) ? dayKey(new Date(calendarAt)) : dayKey();
  const properties = {
    ...identity,
    completionId: snapshot.completion.completionId,
    completionSource: snapshot.completion.source ?? 'unknown',
    assisted: options.assisted,
    assistanceType: options.assistanceType ?? (options.assisted ? 'unknown' : 'none'),
    actionDay,
    dateKey: identity.mode === 'daily' ? snapshot.dailyId : actionDay,
    ...(Number.isFinite(completedAt) ? { occurredAtMs: completedAt } : {}),
    ...(Number.isFinite(createdAt) && completedAt >= createdAt
      ? { createdAtMs: createdAt, durationSec: (completedAt - createdAt) / 1000 } : {}),
    ...(Number.isFinite(createdAt) && typeof snapshot.activeTimeMs === 'number' && Number.isFinite(snapshot.activeTimeMs)
      && snapshot.activeTimeMs >= 0 ? { activeTimeMs: snapshot.activeTimeMs } : {}),
  };
  // Preserve the released once-per-puzzle key through the schema enrichment.
  const puzzleKey = snapshot.mode === 'daily' ? snapshot.dailyId : String(identity.levelId);
  trackOnce('puzzle_completed', `${snapshot.mode}:${puzzleKey}`, properties);
  if (options.introPlayer && identity.mode === 'campaign' && identity.contentVersion.startsWith('intro-')) {
    if (identity.levelId === 1) trackOnce('first_level_completed', 'intro:first-win:v1', properties);
    if (identity.levelId === 5) trackOnce('fifth_level_completed', 'intro:fifth-win:v1', properties);
  }
  const days = [...new Set((options.dailyActionDays ?? []).filter(isDayKey))].sort();
  if (identity.mode === 'daily' && days.length >= 2 && actionDay > days[0]) {
    trackOnce('daily_repeat_completed', 'daily:first-return-win:v1', properties);
  }
}
