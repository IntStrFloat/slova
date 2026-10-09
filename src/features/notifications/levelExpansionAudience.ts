import { AppState } from 'react-native';

import { useLevels } from '@/features/levels/store';
import { useSettings } from '@/features/settings';

import { getPush, isPushAvailable } from './provider';

/** Collects a RuStore topic audience only; this never schedules or sends a push. */
export function startLevelExpansionAudienceSync(): () => void {
  if (!isPushAvailable()) return () => {};
  const push = getPush();
  const sync = () => {
    void push.syncLevelExpansionAudience(
      useLevels.getState().currentLevel,
      useSettings.getState().notifications,
    ).catch((error: unknown) => console.warn('[push] campaign audience sync failed', error));
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
  return () => {
    unsubscribeLevels();
    unsubscribeSettings();
    appState.remove();
  };
}
