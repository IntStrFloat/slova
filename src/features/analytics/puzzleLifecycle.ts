import type { Level } from '@/core/engine/types';
import { dayKey, isDayKey } from '@/core/time';
import { hasCurrentMeasurementEpoch, type GameSnapshot } from '@/features/game/persistence';

import { getAnalyticsSession, trackOnce } from './index';

type TimedSnapshot = GameSnapshot & { createdAt?: string; activeTimeMs?: number };
const DIFFICULTY_ROLES = new Set(['easy', 'baseline', 'hard', 'breather', 'climax']);
const MECHANICS = new Set(['classic', 'bonus_chest', 'ordered', 'mastery']);

/** Fingerprints from legacy saves may include answer text. Send a bounded digest, never that text. */
function analyticsFingerprint(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ value.charCodeAt(i), 0x85ebca6b);
  }
  return `fp_${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

export function puzzleIdentity(level: Level, snapshot: GameSnapshot) {
  const mode = snapshot.mode === 'daily' ? 'daily' : 'campaign';
  const puzzleKey = mode === 'daily' ? snapshot.dailyId : String(level.globalId ?? level.id);
  return {
    attemptId: snapshot.attemptId,
    levelId: level.globalId ?? level.id,
    levelKey: `${mode}:${puzzleKey ?? 'unknown'}`,
    mode,
    contentVersion: snapshot.contentVersion,
    content_fingerprint: analyticsFingerprint(snapshot.levelFingerprint),
    world: level.world,
    time_coverage: !hasCurrentMeasurementEpoch(snapshot) ? 'mixed_consent'
      : Number.isFinite(Date.parse(snapshot.createdAt ?? '')) ? 'full_attempt' : 'since_restore',
  };
}

export function puzzleProgress(level: Level, snapshot: GameSnapshot) {
  const lastSuccess = Date.parse(snapshot.lastSuccessAt ?? snapshot.createdAt ?? '');
  return {
    ...puzzleIdentity(level, snapshot),
    revision: snapshot.revision,
    found: snapshot.solvedWords.length,
    target: level.answers.length,
    errors: snapshot.mistakes ?? 0,
    hints_count: snapshot.hintsUsed.length + Number(snapshot.semanticHelpUsed === true),
    ...(hasCurrentMeasurementEpoch(snapshot) ? { activeTimeMs: snapshot.activeTimeMs ?? 0 } : {}),
    ...(hasCurrentMeasurementEpoch(snapshot) && Number.isFinite(lastSuccess)
      ? { last_success_elapsed_ms: Math.max(0, Date.now() - lastSuccess) } : {}),
  };
}

/** Snapshot must already be durable. A process death without a callback stays censored, not an exit. */
export function trackPuzzleCheckpoint(level: Level, snapshot: GameSnapshot, reason: string): void {
  if (snapshot.completion.status !== 'playing') return;
  trackOnce('puzzle_checkpoint', `${snapshot.attemptId}:${snapshot.revision}`, {
    ...puzzleProgress(level, snapshot), reason,
  });
}

export function trackPuzzlePaused(level: Level, snapshot: GameSnapshot, pauseId: string, reason: string): void {
  if (snapshot.completion.status !== 'playing') return;
  trackOnce('puzzle_paused', `${snapshot.attemptId}:${pauseId}`, {
    ...puzzleProgress(level, snapshot), pause_id: pauseId, reason,
  });
}

export function trackPuzzleExited(
  level: Level, snapshot: GameSnapshot, exitId: string, reason: string, lastOutcome?: string,
): void {
  if (snapshot.completion.status !== 'playing') return;
  trackOnce('puzzle_exited', `${snapshot.attemptId}:${exitId}`, {
    ...puzzleProgress(level, snapshot), exit_id: exitId, exit_reason: reason, last_outcome: lastOutcome,
  });
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
    ...(Number.isInteger(level.difficultyTier) && level.difficultyTier! >= 1 && level.difficultyTier! <= 5
      ? { difficulty_tier: level.difficultyTier } : {}),
    ...(level.difficultyRole && DIFFICULTY_ROLES.has(level.difficultyRole) ? { difficulty_role: level.difficultyRole } : {}),
    ...(MECHANICS.has(level.mechanic ?? 'classic') ? { mechanic: level.mechanic ?? 'classic' } : {}),
    letter_count: level.letters.length,
    target_count: level.answers.length,
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
    ...(identity.mode === 'daily' ? { dateKey: snapshot.dailyId } : {}),
    ...(Number.isFinite(completedAt) ? { occurredAtMs: completedAt } : {}),
    ...(hasCurrentMeasurementEpoch(snapshot) && Number.isFinite(createdAt) && completedAt >= createdAt
      ? { createdAtMs: createdAt, durationSec: (completedAt - createdAt) / 1000 } : {}),
    ...(hasCurrentMeasurementEpoch(snapshot) && Number.isFinite(createdAt) && typeof snapshot.activeTimeMs === 'number' && Number.isFinite(snapshot.activeTimeMs)
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
