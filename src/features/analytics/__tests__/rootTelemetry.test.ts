import { storage } from '@/core/storage';
import { getAppMetricaIdentifiers } from '@/core/native/appmetrica';
import { track, trackOnce, useAnalyticsPrefs } from '../index';
import { addAdTime, addGameplayTime, flushSessionSummary, noteSessionAction } from '../sessionTelemetry';
import { trackScreenVisit, trackUiAction } from '../navigationTelemetry';
import { chooseExperimentVariant, exposeAnalyticsExperiments, initializeAnalyticsExperiments } from '../experiments';
import { beginNotificationRoute, confirmNotificationRoute, recordPushLifecycle } from '@/features/notifications/analytics';
import type { AnalyticsExperiment } from '@/core/config/analyticsExperiments';

jest.mock('../index', () => ({
  getAnalyticsSession: jest.fn(() => ({ sessionId: 'session_test' })), noteAnalyticsActivity: jest.fn(),
  track: jest.fn(), trackOnce: jest.fn(() => 'event_accepted'), setAnalyticsContext: jest.fn(),
  isAnalyticsCollectionEnabled: jest.fn(() => true),
  useAnalyticsPrefs: { getState: jest.fn(() => ({ optOut: false })) },
}));
jest.mock('@/core/native/appmetrica', () => ({ getAppMetricaIdentifiers: jest.fn(async () => ({ installationId: 'install_test' })) }));

beforeEach(() => {
  storage.clearAll(); jest.clearAllMocks(); jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-01T09:00:00+03:00'));
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: false });
  (trackOnce as jest.Mock).mockReturnValue('event_accepted');
});
afterEach(() => jest.useRealTimers());

test('summary revisions preserve cumulative active time, idle time separately, and never treat banners as ad time', () => {
  noteSessionAction('word_submitted'); jest.advanceTimersByTime(2500); addGameplayTime(2500);
  addAdTime(8000); flushSessionSummary('app_background');
  expect(trackOnce).toHaveBeenLastCalledWith('gameplay_session_summary', 'session_test:1', expect.objectContaining({
    gameplay_visible_ms: 2500, idle_adjusted_ms: 2500, ad_ms: 8000, revision: 1,
  }));
  jest.advanceTimersByTime(70_000); addGameplayTime(5000); flushSessionSummary('foreground_checkpoint');
  expect(trackOnce).toHaveBeenLastCalledWith('gameplay_session_summary', 'session_test:2', expect.objectContaining({
    gameplay_visible_ms: 7500, idle_adjusted_ms: 2500, ad_ms: 8000, revision: 2,
  }));
  const count = (trackOnce as jest.Mock).mock.calls.length; flushSessionSummary('again');
  expect(trackOnce).toHaveBeenCalledTimes(count);
});

test('a rejected checkpoint retries the same revision, and opt-out clears pending time', () => {
  noteSessionAction('word_submitted'); addGameplayTime(1000);
  (trackOnce as jest.Mock).mockReturnValue(null); flushSessionSummary('pause');
  flushSessionSummary('retry');
  expect((trackOnce as jest.Mock).mock.calls.map((c) => c[1])).toEqual(['session_test:1', 'session_test:1']);
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: true });
  flushSessionSummary('refused');
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: false });
  (trackOnce as jest.Mock).mockClear(); flushSessionSummary('enabled');
  expect(trackOnce).not.toHaveBeenCalled();
});

test('UI telemetry uses stable control IDs and rejects user text', () => {
  trackScreenVisit('/profile'); trackUiAction('profile_rename'); trackUiAction('email@example.com');
  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenCalledWith('ui_action', expect.objectContaining({ screen: 'profile', element_id: 'profile_rename', interaction_id: expect.any(String) }));
});

test('notification route success needs a visible destination and correlates provider IDs without raw payload', () => {
  const id = recordPushLifecycle('opened', 'private-provider-id');
  beginNotificationRoute('/daily', id, 'rustore', 'open_test'); confirmNotificationRoute('/settings');
  expect((trackOnce as jest.Mock).mock.calls.filter((c) => c[0] === 'notification_route_result')).toHaveLength(0);
  confirmNotificationRoute('/daily'); confirmNotificationRoute('/daily');
  const calls = (trackOnce as jest.Mock).mock.calls.filter((c) => c[0] === 'notification_route_result');
  expect(calls).toHaveLength(1);
  expect(calls[0][2]).toMatchObject({ open_id: 'open_test', destination: 'daily', result: 'success' });
  expect(JSON.stringify((trackOnce as jest.Mock).mock.calls)).not.toContain('private-provider-id');
});

const experiment: AnalyticsExperiment = { id: 'intro_test', allocationVersion: 1,
  startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z',
  variants: [{ id: 'control', weight: 50 }, { id: 'candidate', weight: 50 }], exposureScreens: ['game'] };

test('experiment assignment is sticky by SDK installation, exposure is actual screen and no missing-ID assignment is invented', async () => {
  const chosen = chooseExperimentVariant(experiment, 'install_test');
  expect(['control', 'candidate']).toContain(chosen);
  await initializeAnalyticsExperiments([experiment]); exposeAnalyticsExperiments('settings');
  expect((trackOnce as jest.Mock).mock.calls.filter((c) => c[0] === 'experiment_exposed')).toHaveLength(0);
  await initializeAnalyticsExperiments([{ ...experiment, variants: [...experiment.variants].reverse() }]);
  exposeAnalyticsExperiments('game');
  expect(trackOnce).toHaveBeenLastCalledWith('experiment_exposed', expect.any(String), expect.objectContaining({ variant: chosen, exposure_point: 'game' }));
  storage.clearAll(); (trackOnce as jest.Mock).mockClear();
  (getAppMetricaIdentifiers as jest.Mock).mockResolvedValueOnce({});
  await initializeAnalyticsExperiments([experiment]);
  expect(trackOnce).not.toHaveBeenCalled();
});
