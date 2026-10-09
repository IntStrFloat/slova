import { AppState } from 'react-native';

/** Start only while the screen is focused; refresh immediately on a foreground return. */
export function startFocusedRefresh(refresh: () => void): () => void {
  let interval: ReturnType<typeof setInterval> | null = null;
  const stop = () => { if (interval !== null) { clearInterval(interval); interval = null; } };
  const start = () => {
    stop();
    refresh();
    interval = setInterval(refresh, 60_000);
  };
  if (AppState.currentState === 'active' || AppState.currentState === null) start();
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') start();
    else stop();
  });
  return () => { stop(); subscription.remove(); };
}
