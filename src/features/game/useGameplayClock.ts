import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useGame } from './store';

/** Flush before the winning action so its frozen completion includes the last partial interval. */
export function useGameplayClock(active: boolean, attemptId?: string) {
  const checkpoint = useRef<{ attemptId: string; since: number } | null>(null);
  const flush = useCallback(() => {
    const current = checkpoint.current;
    if (!current) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - current.since);
    current.since = now;
    if (elapsed === 0) return;
    try {
      useGame.getState().recordVisibleTime(current.attemptId, elapsed);
    } catch {
      // Optional timing must never prevent a word or its critical save.
    }
  }, []);
  useEffect(() => {
    if (!active || !attemptId) return;
    const begin = () => { checkpoint.current = { attemptId, since: Date.now() }; };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') begin();
    const subscription = AppState.addEventListener('change', (state) => {
      flush();
      checkpoint.current = null;
      if (state === 'active') begin();
    });
    const timer = setInterval(flush, 5_000);
    return () => {
      flush();
      checkpoint.current = null;
      clearInterval(timer);
      subscription.remove();
    };
  }, [active, attemptId, flush]);
  return flush;
}
