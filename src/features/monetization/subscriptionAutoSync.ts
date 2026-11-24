import * as Linking from 'expo-linking';
import { AppState } from 'react-native';

import { isYandexGamesBuild } from '@/core/platform/yandexGames';
import { useProfile } from '@/features/profile';

import { useSubscription } from './subscription';

const POLL_WINDOW_MS = 10 * 60_000;

function isPaymentReturn(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'slova:' && !parsed.username && !parsed.password
      && ((parsed.hostname === 'shop' && ['', '/'].includes(parsed.pathname))
        || (!parsed.hostname && parsed.pathname === '/shop'));
  } catch { return false; }
}

/** Read-only foreground reconciliation. A deep link is never proof of payment. */
export function startSubscriptionAutoSync(): () => void {
  if (isYandexGamesBuild()) return () => {};
  let foreground = AppState.currentState === 'active' || AppState.currentState === null;
  let disposed = false;
  let running = false;
  let requested = false;
  let pollingSince: number | null = null;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pending = () => {
    const state = useSubscription.getState();
    return !state.needsMigration && Boolean(state.hasPendingCheckout || state.status?.pendingPaymentId);
  };
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = (delay: number) => {
    clearTimer();
    if (disposed || !foreground) return;
    timer = setTimeout(() => { timer = null; requested = true; void run(); }, delay);
  };
  const schedulePending = () => {
    if (!pending() || pollingSince === null) return;
    const elapsed = Date.now() - pollingSince;
    if (elapsed >= POLL_WINDOW_MS) return;
    const delay = failures > 0 ? Math.min(30_000, 5_000 * 2 ** Math.min(failures - 1, 3))
      : elapsed < 30_000 ? 3_000 : elapsed < 120_000 ? 10_000 : 30_000;
    schedule(Math.min(delay, POLL_WINDOW_MS - elapsed));
  };
  async function run() {
    if (disposed || !foreground || running || !requested) return;
    if (useSubscription.getState().busy || useProfile.getState().busy) return;
    requested = false;
    running = true;
    clearTimer();
    try {
      await useSubscription.getState().sync();
      failures = useSubscription.getState().error ? failures + 1 : 0;
    } catch {
      // The store normally owns errors; a rejected task must not leak a timer promise.
      failures += 1;
    } finally {
      running = false;
      if (!disposed && foreground) {
        if (requested) schedule(0);
        else schedulePending();
      }
    }
  }
  const refresh = () => {
    requested = true;
    failures = 0;
    pollingSince = pending() ? Date.now() : null;
    clearTimer();
    void run();
  };

  const unsubscribe = useSubscription.subscribe((state, previous) => {
    if (disposed) return;
    if (!pending()) {
      pollingSince = null;
      clearTimer();
    } else if ((!previous.hasPendingCheckout && !previous.status?.pendingPaymentId)
      || (previous.needsMigration && !state.needsMigration)) {
      pollingSince = Date.now();
      requested = true;
    }
    // A resume during checkout/cancel must be serviced after that action finishes.
    if (!state.busy && requested) void run();
  });
  const unsubscribeProfile = useProfile.subscribe((state, previous) => {
    if (state.profile?.userId !== previous.profile?.userId) {
      clearTimer();
      pollingSince = null;
      requested = true;
    }
    if (!state.busy && requested) void run();
  });
  const appState = AppState.addEventListener('change', (state) => {
    const wasForeground = foreground;
    foreground = state === 'active';
    if (!foreground) clearTimer();
    else if (!wasForeground) refresh();
  });
  const links = Linking.addEventListener('url', ({ url }) => {
    if (isPaymentReturn(url)) refresh();
  });
  refresh();
  return () => {
    disposed = true;
    requested = false;
    clearTimer();
    unsubscribe();
    unsubscribeProfile();
    appState.remove();
    links.remove();
  };
}
