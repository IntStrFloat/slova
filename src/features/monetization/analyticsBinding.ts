import { getBackend } from '@/core/net';
import * as AppMetrica from '@/core/native/appmetrica';
import { isAnalyticsCollectionEnabled, useAnalyticsPrefs } from '@/features/analytics';
import { useProfile } from '@/features/profile';

let work: Promise<void> | null = null;
let requested = false;
let acceptedBinding: string | null = null;

async function identifiersWithDeadline(): Promise<{ deviceId?: string; installationId?: string }> {
  if (typeof AppMetrica.getAppMetricaIdentifiers !== 'function') return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      AppMetrica.getAppMetricaIdentifiers(),
      new Promise<{ deviceId?: string; installationId?: string }>((resolve) => {
        timer = setTimeout(() => resolve({}), 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function synchronizeBinding(): Promise<void> {
    try {
      const profile = useProfile.getState().profile;
      const backend = getBackend();
      if (!profile || !backend.bindSubscriptionAnalytics) return;
      let consent = isAnalyticsCollectionEnabled();
      const ids = consent ? await identifiersWithDeadline() : {};
      // A pending ID lookup must never overwrite a newer opt-out with an old opt-in.
      consent = consent && isAnalyticsCollectionEnabled();
      if (useProfile.getState().profile?.userId !== profile.userId) return;
      if (consent && !ids.deviceId && !ids.installationId) return;
      const body = consent ? { consent, ...ids } : { consent: false };
      const key = JSON.stringify([profile.userId, body]);
      if (acceptedBinding === key) return;
      const result = await backend.bindSubscriptionAnalytics(profile.authToken, body);
      if (result.consent === consent) acceptedBinding = key;
    } catch {
      // Retry during the next status/checkout or preference change; billing stays usable.
    }
}

/** Coalesced background work never queues one network request for every billing poll. */
export function syncSubscriptionAnalyticsBinding(): Promise<void> {
  requested = true;
  if (work) return work;
  work = (async () => {
    while (requested) {
      requested = false;
      await synchronizeBinding();
    }
  })().finally(() => { work = null; });
  return work;
}

useAnalyticsPrefs?.subscribe?.((state, previous) => {
  if (state.optOut === previous.optOut) return;
  acceptedBinding = null;
  void syncSubscriptionAnalyticsBinding();
});
