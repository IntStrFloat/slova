import { AppState } from 'react-native';

import { useLevels } from '@/features/levels/store';
import { useSettings } from '@/features/settings';
import { useProfile } from '@/features/profile';

import { getPush, isPushAvailable } from './provider';

/** Collects a RuStore topic audience only; this never schedules or sends a push. */
export function startLevelExpansionAudienceSync(): () => void {
  if (!isPushAvailable()) return () => {};
  const push = getPush();
  const sync = () => {
    void push.syncLevelExpansionAudience(
      useLevels.getState().currentLevel,
      useSettings.getState().notifications,
    ).catch(() => console.warn('[push] campaign audience sync unavailable'));
  };
  const unsubscribeLevels = useLevels.subscribe((state, previous) => {
    if (state.currentLevel !== previous.currentLevel) sync();
  });
  const unsubscribeSettings = useSettings.subscribe((state, previous) => {
    if (state.notifications !== previous.notifications) sync();
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') sync();
  });
  sync();
  const unsubscribeProfile = useProfile.subscribe((state, previous) => {
    // Profile persistence follows Zustand.set synchronously; read the committed binding on the next microtask.
    if (state.profile?.userId !== previous.profile?.userId) void Promise.resolve().then(sync);
  });
  return () => {
    unsubscribeLevels();
    unsubscribeSettings();
    unsubscribeProfile();
    appState.remove();
  };
}
