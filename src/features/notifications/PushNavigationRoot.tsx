import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useSettings } from '@/features/settings';
import { useProfile } from '@/features/profile';
import { useGame } from '@/features/game/store';
import { useSubscription } from '@/features/monetization/subscription';
import { getAds } from '@/features/monetization/providers';
import { getFullscreenSnapshot, subscribeFullscreen } from '@/core/fullscreen';
import { beginNotificationRoute, clearRemoteReturn, confirmNotificationRoute } from './analytics';
import { notificationOwner, pushContentContext } from './context';
import { confirmNotificationTap, dispatchNotificationTap, hasPendingNotificationTap, startNotificationNavigationRuntime, subscribeNotificationTaps } from './delivery';
import { getPush } from './provider';

/** Mount beside Stack only after fonts/platform readiness. A queued tap never interrupts a game. */
export function PushNavigationRoot() {
  const router = useRouter(), path = usePathname(), navigation = useRootNavigationState();
  const enabled = useSettings((s) => s.notifications);
  const fullscreen = useSyncExternalStore(subscribeFullscreen, getFullscreenSnapshot, getFullscreenSnapshot);
  const profile = useProfile((s) => s.profile?.userId);
  const [tick, wake] = useState(0);
  const [focused, setFocused] = useState(AppState.currentState === 'active');
  useEffect(() => subscribeNotificationTaps(() => wake((value) => value + 1)), []);
  useEffect(() => {
    startNotificationNavigationRuntime();
    const changed = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    const blur = AppState.addEventListener('blur', () => setFocused(false));
    const focus = AppState.addEventListener('focus', () => setFocused(AppState.currentState === 'active'));
    return () => { changed.remove(); blur.remove(); focus.remove(); };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const push = getPush(); void push.init();
    return push.onNotificationTap(() => wake((value) => value + 1));
  }, [enabled, profile]);
  useEffect(() => {
    if (!enabled || !navigation?.key || !hasPendingNotificationTap()) return;
    const pump = () => {
      const status = useGame.getState().completion.status;
      const safe = path !== '/game' && path !== '/shop' && !useSubscription.getState().busy
        && fullscreen.owner === null
        && status !== 'completion_pending' && status !== 'reward_claimed'
        && getAds().getRewardedState?.() !== 'fullscreen_busy';
      if (!focused || AppState.currentState !== 'active' || !safe) return;
      const owner = notificationOwner();
      dispatchNotificationTap({ owner, ready: true, active: true, safe, content: pushContentContext(), onDispatch: (message) => {
        const promptId = message.channel === 'local' ? message.promptId ?? message.id : message.id;
        if (message.channel !== 'local' && message.reason !== 'accepted') clearRemoteReturn();
        beginNotificationRoute(message.route, promptId, message.channel === 'local' ? 'local_reminder' : 'rustore', `${promptId}:opened`, message.reason);
      } }, (route) => router.navigate(route as never));
      if (confirmNotificationTap(path, owner)) wake((value) => value + 1);
      try { confirmNotificationRoute(path); } catch { /* Functional visible ack is independent of analytics. */ }
    };
    pump();
    const timer = setInterval(pump, 500);
    return () => clearInterval(timer);
  }, [enabled, focused, fullscreen, navigation?.key, path, profile, router, tick]);
  return null;
}
