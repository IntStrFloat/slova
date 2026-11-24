import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { trackPuzzleCheckpoint, trackPuzzlePaused } from '@/features/analytics/puzzleLifecycle';
import { flushSessionSummary } from '@/features/analytics/sessionTelemetry';

import { useGame } from './store';
import { flushGameSaveSummary } from './saveTelemetry';

/** Flush before the winning action so its frozen completion includes the last partial interval. */
export function useGameplayClock(active: boolean, attemptId?: string, pauseReason = 'not_visible') {
  const checkpoint = useRef<{ attemptId: string; since: number } | null>(null);
  const checkpointAt = useRef(0);
  const unsavedTime = useRef(new Map<string, number>());
  const sequence = useRef(0);
  const currentPauseReason = useRef(pauseReason);
  useLayoutEffect(() => { currentPauseReason.current = pauseReason; }, [pauseReason]);
  const flush = useCallback(() => {
    const current = checkpoint.current;
    if (!current) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - current.since) + (unsavedTime.current.get(current.attemptId) ?? 0);
    current.since = now;
    if (elapsed === 0) return;
    try {
      useGame.getState().recordVisibleTime(current.attemptId, elapsed);
      unsavedTime.current.delete(current.attemptId);
      const { level, snapshot } = useGame.getState();
      if (level && snapshot?.attemptId === current.attemptId
        && (snapshot.activeTimeMs ?? 0) - checkpointAt.current >= 60_000) {
        trackPuzzleCheckpoint(level, snapshot, 'interval');
        checkpointAt.current = snapshot.activeTimeMs ?? 0;
      }
    } catch {
      // Optional timing must never prevent a word or its critical save.
      // Retry only measured foreground time; the background gap is never added.
      unsavedTime.current.set(current.attemptId, elapsed);
    }
  }, []);
  const pause = useCallback((reason: string) => {
    const current = checkpoint.current;
    if (!current) return;
    flush();
    checkpoint.current = null;
    const { level, snapshot } = useGame.getState();
    if (level && snapshot?.attemptId === current.attemptId) {
      trackPuzzleCheckpoint(level, snapshot, reason);
      trackPuzzlePaused(level, snapshot, `pause_${Date.now().toString(36)}_${sequence.current++}`, reason);
    }
    flushSessionSummary(reason);
    flushGameSaveSummary(true);
  }, [flush]);
  useEffect(() => {
    if (!active || !attemptId) return;
    checkpointAt.current = useGame.getState().snapshot?.activeTimeMs ?? 0;
    const begin = () => { checkpoint.current = { attemptId, since: Date.now() }; };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') begin();
    const subscription = AppState.addEventListener('change', (state) => {
      pause('background');
      if (state === 'active') begin();
    });
    const timer = setInterval(flush, 5_000);
    return () => {
      pause(currentPauseReason.current);
      clearInterval(timer);
      subscription.remove();
    };
  }, [active, attemptId, flush, pause]);
  return flush;
}
