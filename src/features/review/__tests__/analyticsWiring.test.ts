/* eslint-disable @typescript-eslint/no-require-imports */
let mockDiagnostics = true;
let mockEnabled = true;
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.create(actual, { Platform: { value: { ...actual.Platform, OS: 'android' } },
    AppState: { value: { currentState: 'active' } } });
});
jest.mock('../config', () => ({ REVIEW_ENABLED: mockEnabled, REVIEW_DIAGNOSTICS_ENABLED: mockDiagnostics }));
jest.mock('../../../../modules/rustore-review', () => ({
  discard: jest.fn(), isAvailable: jest.fn(() => true), hasActiveForm: jest.fn(() => false),
  prepareResult: jest.fn(async () => 'ready'), launch: jest.fn(async () => 'completed'),
}));
jest.mock('@/core/native/appmetrica', () => ({ reportEvent: jest.fn(() => false),
  isAppMetricaAvailable: jest.fn(() => true), isAppMetricaTestDevice: jest.fn(() => false),
  setDataSendingEnabled: jest.fn(() => true) }));

const context = { levelId: 10, completedCount: 10, firstCompletion: true, postcardMilestone: true, daily: false };
const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
const previousQA = process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE;
const previousAds = process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
const previousChannel = process.env.EXPO_PUBLIC_RELEASE_CHANNEL;

function fixture() {
  jest.resetModules();
  const { storage } = require('@/core/storage');
  storage.clearAll();
  require('react-native').AppState.currentState = 'active';
  const analytics = require('@/features/analytics');
  return { storage, analytics, request: require('../index').requestCampaignReview,
    native: require('../../../../modules/rustore-review'),
    events: () => JSON.parse(storage.getString('analytics.outbox.v2') ?? '{"outbox":[]}').outbox
      .filter((entry: { name: string }) => entry.name.startsWith('review_')) };
}
beforeEach(() => {
  mockDiagnostics = true; mockEnabled = true;
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE;
  delete process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
  process.env.EXPO_PUBLIC_RELEASE_CHANNEL = 'local-sdk-qa';
});
afterEach(() => {
  if (descriptor) Object.defineProperty(globalThis, '__DEV__', descriptor);
  for (const [key, value] of [['EXPO_PUBLIC_ANALYTICS_TEST_DEVICE', previousQA],
    ['EXPO_PUBLIC_YANDEX_TEST_ADS', previousAds], ['EXPO_PUBLIC_RELEASE_CHANNEL', previousChannel]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

test('actual Review coordinator/schema/outbox wiring reconciles one completed flow without a second completion emitter', async () => {
  const f = fixture();
  expect(await f.request(context, () => true)).toBe('completed');
  const events = f.events();
  expect(events.map((event: { name: string }) => event.name)).toEqual([
    'review_eligibility', 'review_prepare_result', 'review_launch_attempt', 'review_flow_finished',
  ]);
  expect(new Set(events.map((event: { envelope: { operation_id: string } }) => event.envelope.operation_id)).size).toBe(1);
  expect(events.at(-1).envelope).toMatchObject({ result: 'completed', reason: 'flow_completed', attempt_no: 1,
    levelId: 10, completed_count: 10, source: 'campaign_milestone', platform: 'android', release_channel: 'local-sdk-qa' });
  expect(new Set(events.map((event: { envelope: { event_id: string } }) => event.envelope.event_id)).size).toBe(4);
  expect(JSON.stringify(events)).not.toMatch(/submitted|posted|stars|raw_error|receipt|push_token/);
  expect(f.analytics.getAnalyticsHealth().schema_rejected).toBe(0);
  if (process.env.SLOVA_REVIEW_CAPTURE === '1') console.info('SL_RV_FIXTURE_EVENT ' + JSON.stringify({
    provenance: 'local_jest_fake_gateway_actual_coordinator_schema_outbox', sdkDelivery: false, event: events.at(-1),
  }));
});

test.each(['error', 'unavailable'])('prepare %s preserves one attempt, no launch, and honest terminal reason', async (outcome) => {
  const f = fixture();
  f.native.prepareResult.mockResolvedValueOnce(outcome);
  expect(await f.request(context, () => true)).toBe(outcome);
  expect(f.native.launch).not.toHaveBeenCalled();
  expect(f.events().map((event: { name: string }) => event.name)).toEqual([
    'review_eligibility', 'review_prepare_result', 'review_flow_finished',
  ]);
  expect(f.events().at(-1).envelope).toMatchObject({ result: outcome, reason: outcome, stage: 'prepare', attempt_no: 1 });
  expect(require('../policy').readReviewState()).toMatchObject({ attempts: 1, handled: false });
});

test('suppression consumes no attempt and opt-out blocks every stage without altering business history', async () => {
  const f = fixture();
  expect(await f.request({ ...context, daily: true }, () => true)).toBe('skipped');
  expect(f.events()).toHaveLength(1);
  expect(f.events()[0].envelope).toMatchObject({ result: 'suppressed', reason: 'daily' });
  f.analytics.useAnalyticsPrefs.getState().setOptOut(true);
  expect(await f.request(context, () => true)).toBe('completed');
  expect(f.events()).toHaveLength(0);
  expect(require('../policy').readReviewState()).toMatchObject({ attempts: 1, handled: true });
});

test('diagnostics rollback preserves the existing completion event and handled history', async () => {
  mockDiagnostics = false;
  const f = fixture();
  expect(await f.request(context, () => true)).toBe('completed');
  expect(f.events().map((event: { name: string }) => event.name)).toEqual(['review_flow_finished']);
  expect(require('../policy').readReviewState().handled).toBe(true);
});

test('feature disable preserves old handled/cooldown and starts no native work', async () => {
  mockEnabled = false;
  const f = fixture();
  const { KEYS } = require('@/core/storage');
  const history = { version: 1, attempts: 2, lastAttemptAt: 12345, lastCompletedCount: 30, lastLevelId: 30, handled: true };
  f.storage.set(KEYS.reviewPrompt, JSON.stringify(history));
  expect(await f.request(context, () => true)).toBe('skipped');
  expect(f.storage.getString(KEYS.reviewPrompt)).toBe(JSON.stringify(history));
  expect(f.native.prepareResult).not.toHaveBeenCalled();
});

test('an old queued review_flow_finished remains valid after new diagnostic fields are introduced', () => {
  const { validateEventProperties } = require('@/features/analytics/schema');
  expect(validateEventProperties('review_flow_finished', { levelId: 10, result: 'completed' }))
    .toMatchObject({ valid: true, rejected: 0, missing: [] });
});
