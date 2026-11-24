import { storage } from '@/core/storage';
import { ANALYTICS_EXPERIMENTS, type AnalyticsExperiment } from '@/core/config/analyticsExperiments';
import { initializeAnalyticsExperiments, getAnalyticsExperimentAssignment, exposeAnalyticsParameter } from '@/features/analytics/experiments';
import { trackOnce } from '@/features/analytics';
import { parseRemotePolicy, selectRemotePolicy } from '../policy';

jest.mock('@/core/config/analyticsExperiments', () => ({ ANALYTICS_EXPERIMENTS: [] }));
jest.mock('@/core/native/appmetrica', () => ({ getAppMetricaIdentifiers: jest.fn(async () => ({ installationId: 'sdk_install_test' })) }));
jest.mock('@/features/analytics', () => ({
  isAnalyticsCollectionEnabled: jest.fn(() => true), setAnalyticsContext: jest.fn(), trackOnce: jest.fn(() => 'accepted'),
  useAnalyticsPrefs: { getState: () => ({ optOut: false }) },
}));
const experiments = ANALYTICS_EXPERIMENTS as AnalyticsExperiment[];
const spec: AnalyticsExperiment = { id: 'ad_delay', allocationVersion: 1, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z',
  variants: [{ id: 'control', weight: 50 }, { id: 'candidate', weight: 50 }], exposureScreens: [] };
beforeEach(() => { storage.clearAll(); jest.clearAllMocks(); experiments.splice(0, experiments.length, spec);
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-02T12:00:00Z')); });
afterEach(() => jest.useRealTimers());

test('parameter delivery reuses existing durable SDK assignment; fetching/selection never expose', async () => {
  await initializeAnalyticsExperiments();
  const first = getAnalyticsExperimentAssignment('ad_delay', 1)!;
  expect(first).toMatchObject({ experiment_id: 'ad_delay', allocation_version: 1 });
  await initializeAnalyticsExperiments([{ ...spec, variants: [...spec.variants].reverse() }]);
  expect(getAnalyticsExperimentAssignment('ad_delay', 1)).toEqual(first);
  const parsed = parseRemotePolicy(JSON.stringify({ schema_version: 1, config_version: 'test_v1', fetch_enabled: true,
    experiment_id: 'ad_delay', allocation_version: 1,
    variants: { control: { ads_interstitial_interval_seconds: 300 }, candidate: { ads_interstitial_interval_seconds: 600 } } }));
  if (!parsed.ok) throw Error('fixture');
  const snapshot = selectRemotePolicy(parsed.document, first, 'profile_a')!;
  expect((trackOnce as jest.Mock).mock.calls.filter((call) => call[0] === 'experiment_exposed')).toHaveLength(0);
  exposeAnalyticsParameter(snapshot, 'ads_interstitial_interval_seconds', 'interstitial_policy');
  expect(trackOnce).toHaveBeenLastCalledWith('experiment_exposed', `${first.assignment_id}:parameter:ads_interstitial_interval_seconds`,
    expect.objectContaining({ assignment_id: first.assignment_id, variant: first.variant, config_version: 'test_v1' }));
  experiments.length = 0;
  expect(getAnalyticsExperimentAssignment('ad_delay', 1)).toBeNull();
  expect(exposeAnalyticsParameter(snapshot, 'ads_interstitial_interval_seconds', 'interstitial_policy')).toBe(false);
  expect(exposeAnalyticsParameter(snapshot, 'ads_interstitial_interval_seconds', 'interstitial_policy', true)).toBe(true);
  expect(trackOnce).toHaveBeenLastCalledWith('experiment_exposed', expect.any(String), expect.objectContaining({
    exposure_window: 'inactive', config_version: 'test_v1', variant: first.variant,
  }));
});
