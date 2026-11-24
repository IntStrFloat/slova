import { useSyncExternalStore } from 'react';
import { AppButton, AppText } from '@/ui';
import { getUpdatesSnapshot, openManualUpdate, requestUpdate, subscribeUpdates } from './runtime';

/** Only mounted inside the saved result. The native install form needs a fresh, explicit tap. */
export function UpdateAction({ isSafePoint, onAttempted, attemptId }: { isSafePoint(): boolean; onAttempted?(): void; attemptId: string }) {
  const state = useSyncExternalStore(subscribeUpdates, getUpdatesSnapshot, getUpdatesSnapshot);
  if (state.status === 'downloading' || state.status === 'pending') return <AppText preset="body">Обновление загружается. Можно продолжать играть.</AppText>;
  if (!state.canAct) return state.manualAvailable && !state.busy ? <AppButton label="Открыть RuStore" variant="glass" onPress={() => {
    void openManualUpdate(isSafePoint, attemptId).then((opened) => { if (opened) onAttempted?.(); });
  }} /> : null;
  return <AppButton label={state.status === 'downloaded' ? 'Установить обновление' : 'Обновить игру'} variant="glass"
    disabled={state.busy} onPress={() => {
      if (!state.versionCode) return;
      void requestUpdate(isSafePoint, { versionCode: state.versionCode, action: state.status === 'downloaded' ? 'install' : 'offer' }, attemptId)
        .then((result) => { if (result.attempted) onAttempted?.(); }).catch(() => { /* A failed optional action leaves the saved result usable. */ });
    }} />;
}
