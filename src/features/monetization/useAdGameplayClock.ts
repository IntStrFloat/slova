import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { recordVisibleGameplay } from './frequency';
import { loadAdsMeta, saveAdsMeta } from './index';

function readClock(): number {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now() : Date.now();
}

/** Flush before the winning action to include its final partial gameplay interval. */
export function useAdGameplayClock(active: boolean, attemptId?: string, onCheckpoint?: () => void): () => void {
  const checkpoint = useRef<number | null>(null);
  const onCheckpointRef = useRef(onCheckpoint);
  useLayoutEffect(() => { onCheckpointRef.current = onCheckpoint; }, [onCheckpoint]);
  const flush = useCallback(() => {
    const since = checkpoint.current;
    if (since === null) return;
    const now = readClock();
    if (!Number.isFinite(now)) return;
    // Never recount an interval, even if the fallback wall clock moves backwards.
    const elapsed = Math.max(0, now - since);
    checkpoint.current = Math.max(since, now);
    if (elapsed === 0) return;
    try {
      saveAdsMeta(recordVisibleGameplay(loadAdsMeta(), elapsed / 1_000));
    } catch {
      // Optional ad timing must never block a word, level reward or navigation.
    }
  }, []);
  const flushAndPrepare = useCallback(() => {
    flush();
    try { onCheckpointRef.current?.(); } catch { /* Preparation cannot block the winning action. */ }
  }, [flush]);

  useEffect(() => {
    if (!active || !attemptId) return;
    const begin = () => { checkpoint.current = readClock(); };
    if (AppState.currentState === 'active') begin();
    const subscription = AppState.addEventListener('change', (state) => {
      flush();
      checkpoint.current = null;
      if (state === 'active') begin();
    });
    const timer = setInterval(() => {
      if (checkpoint.current !== null) flushAndPrepare();
    }, 5_000);
    return () => {
      flush();
      checkpoint.current = null;
      clearInterval(timer);
      subscription.remove();
    };
  }, [active, attemptId, flush, flushAndPrepare]);

  // Exit handlers also flush time; they must not create a new ad request while leaving.
  return flush;
}
