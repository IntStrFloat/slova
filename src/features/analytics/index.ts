import { create } from 'zustand';

import { getJSON, KEYS, setJSON } from '@/core/storage';

/**
 * Аналитика (спека 16). v1: Noop + локальный лог, уважает opt-out.
 * Реальный AppMetrica-адаптер подключается флагом + plugins/withAppMetrica.js
 * (нужен APPMETRICA_API_KEY) — задача M6.
 */
interface Prefs {
  optOut: boolean;
}

const init = getJSON<Prefs>(KEYS.analytics, { optOut: false });

export const useAnalyticsPrefs = create<{ optOut: boolean; setOptOut: (v: boolean) => void }>((set) => ({
  optOut: init.optOut,
  setOptOut: (v) => {
    set({ optOut: v });
    setJSON(KEYS.analytics, { optOut: v });
  },
}));

export function track(event: string, props?: Record<string, unknown>): void {
  if (useAnalyticsPrefs.getState().optOut) return;
  if (__DEV__) console.log('[analytics]', event, props ?? {});
  // TODO(M6): форвард в AppMetrica-адаптер при включённом флаге.
}
