import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { confirmNotificationRoute } from '@/features/notifications/analytics';
import { clearSessionTelemetry, addScreenTime, flushSessionSummary, noteSessionAction } from './sessionTelemetry';
import { screenFromPath, telemetryId, trackAppReady, trackScreenVisit } from './navigationTelemetry';
import { useAnalyticsPrefs } from './index';
import { clearAnalyticsExperiments, exposeAnalyticsExperiments, initializeAnalyticsExperiments } from './experiments';

const processStartedAt = Date.now();
const coldLaunchId = telemetryId('launch');

/** Router pathname confirms navigation; rendering a component by itself is not a screen view. */
export function AnalyticsNavigationRoot({ ready }: { ready: boolean }) {
  const pathname = usePathname();
  const firstReady = useRef(false);
  const currentPath = useRef(pathname);

  useEffect(() => {
    currentPath.current = pathname;
    if (!ready) return;
    trackScreenVisit(pathname);
    confirmNotificationRoute(pathname);
    exposeAnalyticsExperiments(screenFromPath(pathname));
    if (!firstReady.current) {
      firstReady.current = true;
      trackAppReady(processStartedAt, coldLaunchId, 'cold');
    }
  }, [pathname, ready]);

  useEffect(() => {
    if (!ready) return;
    void initializeAnalyticsExperiments().then(() => exposeAnalyticsExperiments(screenFromPath(currentPath.current))).catch(() => {});
    let since: number | null = AppState.currentState === 'background' || AppState.currentState === 'inactive' ? null : Date.now();
    let resumeSequence = 0;
    const checkpoint = (reason: string) => {
      if (since !== null) { const now = Date.now(); addScreenTime(Math.max(0, now - since)); since = now; }
      confirmNotificationRoute(currentPath.current);
      flushSessionSummary(reason);
    };
    const timer = setInterval(() => checkpoint('foreground_checkpoint'), 30_000);
    const listener = AppState.addEventListener('change', (state) => {
      checkpoint(state === 'active' ? 'app_resume' : 'app_background');
      since = state === 'active' ? Date.now() : null;
      if (state === 'active') {
        noteSessionAction('app_resume');
        trackScreenVisit(currentPath.current, 'app_resume');
        trackAppReady(Date.now(), `${coldLaunchId}:resume:${++resumeSequence}`, 'warm');
      }
    });
    const stopPrefs = useAnalyticsPrefs.subscribe((prefs, previous) => {
      if (prefs.optOut) { clearSessionTelemetry(); clearAnalyticsExperiments(); }
      if (previous.optOut && !prefs.optOut) {
        since = AppState.currentState === 'background' ? null : Date.now();
        trackScreenVisit(currentPath.current, 'analytics_enabled');
      }
    });
    return () => { checkpoint('navigation_unmount'); clearInterval(timer); listener.remove(); stopPrefs(); };
  }, [ready]);
  return null;
}
