/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: jest.fn(() => true),
  isAppMetricaAvailable: jest.fn(() => true),
  isAppMetricaTestDevice: jest.fn(() => false),
  setDataSendingEnabled: jest.fn(() => true),
  getDataSendingPreference: jest.fn(() => null),
  getSoftwareBuildInfo: jest.fn(() => ({ versionName: '0.1.29', versionCode: '33' })),
  getAppMetricaIdentifiers: jest.fn(async () => ({ deviceId: '18446744073709551615', installationId: 'install_test' })),
}));
const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
const qa = process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE;
const adsQA = process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
const stateKey = 'analytics.outbox.v2';
function setup(seed?: (storage: typeof import('@/core/storage'), native: Record<string, jest.Mock>) => void) {
  jest.resetModules();
  jest.dontMock('../../../../app.json');
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE; delete process.env.EXPO_PUBLIC_YANDEX_TEST_ADS;
  const store = require('@/core/storage') as typeof import('@/core/storage');
  store.storage.clearAll();
  const bridge = require('@/core/native/appmetrica');
  require('react-native').Platform.OS = 'android';
  seed?.(store, bridge);
  const api = require('@/features/analytics') as typeof import('@/features/analytics');
  return { ...store, ...api, bridge };
}
afterEach(() => {
  jest.restoreAllMocks(); jest.useRealTimers();
  if (descriptor) Object.defineProperty(globalThis, '__DEV__', descriptor);
  if (qa === undefined) delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE; else process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE = qa;
  if (adsQA === undefined) delete process.env.EXPO_PUBLIC_YANDEX_TEST_ADS; else process.env.EXPO_PUBLIC_YANDEX_TEST_ADS = adsQA;
});
function payload(bridge: Record<string, jest.Mock>, index = 0) { return bridge.reportEvent.mock.calls[index][1] as Record<string, unknown>; }

test('uses flat v3 business dimensions, real build/config, and SDK handoff rather than a fake server receipt', () => {
  const { track, bridge, getJSON } = setup();
  track('level_complete', { levelId: 'w1l3', durationSec: 42, word: 'кот' });
  const sent = payload(bridge);
  expect(sent).toMatchObject({ schema_version: 3, levelId: 'w1l3', durationSec: 42, time_trust: 'client_unverified',
    app_version: expect.any(String), app_build: expect.stringMatching(/^\d+$/),
    config_version: expect.stringMatching(/^config-/), content_version: 'unknown',
    environment: 'production', consent_state: 'enabled' });
  expect(sent.properties).toBeUndefined(); expect(sent.received_at).toBeUndefined();
  expect(sent.word).toBeUndefined(); expect(sent.event_id).toMatch(/^e_/);
  expect(Number.isFinite(Date.parse(sent.sdk_handoff_at as string))).toBe(true);
  expect(getJSON<{ outbox: unknown[] }>(stateKey, { outbox: [] }).outbox).toHaveLength(0);
});

test('new Android envelopes use the explicit installed-binary fixture independently of JS bundle metadata', () => {
  const api = setup((_store, bridge) => {
    const bundled = jest.requireActual<typeof import('../../../../app.json')>('../../../../app.json');
    jest.doMock('../../../../app.json', () => ({ ...bundled,
      expo: { ...bundled.expo, version: '0.1.29', android: { ...bundled.expo.android, versionCode: 33 } } }));
    bridge.getSoftwareBuildInfo.mockReturnValue({ versionName: '0.1.34', versionCode: '34' });
    bridge.isAppMetricaAvailable.mockReturnValue(false);
  });
  expect(require('../../../../app.json').expo).toMatchObject({ version: '0.1.29', android: { versionCode: 33 } });
  api.track('app_open', { source: 'direct' });
  const queue = api.getJSON<{ outbox: { envelope: Record<string, unknown> }[] }>(stateKey, { outbox: [] });
  expect(queue.outbox[0].envelope).toMatchObject({ schema_version: 3, app_version: '0.1.34', app_build: '34' });
  api.bridge.isAppMetricaAvailable.mockReturnValue(true);
  api.flushAnalytics();
  expect(payload(api.bridge)).toMatchObject({ app_version: '0.1.34', app_build: '34' });
});

test.each([2, 3])('schema %s queue keeps captured build33 while new events use installed34', (schemaVersion) => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-04T18:00:00Z'));
  const api = setup((store, bridge) => {
    bridge.getSoftwareBuildInfo.mockReturnValue({ versionName: '0.1.34', versionCode: '34' });
    bridge.isAppMetricaAvailable.mockReturnValue(false);
    store.setJSON(stateKey, { version: 2, playerId: 'p_build', sessionId: 's_build', lastActivityAt: Date.now(),
      dedupe: [], outbox: [{ name: 'app_open', envelope: {
        event_id: 'e_build33', schema_version: schemaVersion, occurred_at: '2026-11-04T17:59:55Z',
        app_version: '0.1.29', app_build: '33',
        ...(schemaVersion === 2 ? { properties: { source: 'direct' } } : { source: 'direct' }),
      } }] });
  });
  api.flushAnalytics();
  expect(api.bridge.getSoftwareBuildInfo).not.toHaveBeenCalled();
  api.track('app_open', { source: 'new_version' });
  const queue = api.getJSON<{ outbox: { envelope: Record<string, unknown> }[] }>(stateKey, { outbox: [] });
  expect(queue.outbox[0].envelope).toMatchObject({ event_id: 'e_build33', schema_version: 3,
    app_version: '0.1.29', app_build: '33', occurred_at: '2026-11-04T17:59:55Z' });
  expect(queue.outbox[1].envelope).toMatchObject({ app_version: '0.1.34', app_build: '34' });
  const persisted = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store, bridge) => {
    for (const [key, value] of persisted) store.setString(key, value);
    bridge.getSoftwareBuildInfo.mockReturnValue({ versionName: '0.1.35', versionCode: '35' });
  });
  restored.flushAnalytics();
  expect(payload(restored.bridge)).toMatchObject({ event_id: 'e_build33', app_version: '0.1.29', app_build: '33' });
  expect(payload(restored.bridge, 1)).toMatchObject({ app_version: '0.1.34', app_build: '34' });
  expect(restored.bridge.getSoftwareBuildInfo).not.toHaveBeenCalled();
});

test.each([2, 3])('missing historical software metadata in schema %s stays unknown instead of current34', (schemaVersion) => {
  const api = setup((store, bridge) => {
    bridge.getSoftwareBuildInfo.mockReturnValue({ versionName: '0.1.34', versionCode: '34' });
    store.setJSON(stateKey, { version: 2, playerId: 'p_build', sessionId: 's_build', lastActivityAt: Date.now(),
      dedupe: [], outbox: [{ name: 'app_open', envelope: {
        event_id: 'e_unknown_build', schema_version: schemaVersion, occurred_at: new Date().toISOString(),
        app_version: 'bad version', app_build: null,
        ...(schemaVersion === 2 ? { properties: { source: 'direct' } } : { source: 'direct' }),
      } }] });
  });
  api.flushAnalytics();
  expect(payload(api.bridge)).toMatchObject({ app_version: 'unknown', app_build: 'unknown' });
  expect(api.bridge.getSoftwareBuildInfo).not.toHaveBeenCalled();
});

test.each(['missing', 'throws'])('old Android %s build getter yields explicit unknown software metadata', (behavior) => {
  const api = setup((_store, bridge) => {
    if (behavior === 'missing') delete bridge.getSoftwareBuildInfo;
    else bridge.getSoftwareBuildInfo.mockImplementation(() => { throw new Error('unavailable'); });
  });
  api.track('app_open', { source: 'direct' });
  expect(payload(api.bridge)).toMatchObject({ app_version: 'unknown', app_build: 'unknown', schema_version: 3 });
});

test('PWA uses its static bundle version without asking an Android software getter', () => {
  const api = setup(() => { require('react-native').Platform.OS = 'web'; });
  api.track('app_open', { source: 'direct' });
  const app = require('../../../../app.json');
  expect(payload(api.bridge)).toMatchObject({ platform: 'web', app_version: app.expo.version,
    app_build: String(app.expo.android.versionCode) });
  expect(api.bridge.getSoftwareBuildInfo).not.toHaveBeenCalled();
});

test('strips private/unknown fields before persistence and reports schema diagnostics', () => {
  const { track, bridge, getString, getJSON, getAnalyticsHealth } = setup();
  bridge.isAppMetricaAvailable.mockReturnValue(false);
  track('word_submit_outcome', { result: 'grid', len: 4, levelId: 3, word: 'кот', rawInput: 'secret',
    email: 'me@example.com', fingerPath: [[1, 2]], reason: 'unexpected_for_word', cost: 100 });
  const queued = getJSON<{ outbox: { envelope: Record<string, unknown> }[] }>(stateKey, { outbox: [] });
  expect(queued.outbox[0].envelope).toMatchObject({ result: 'grid', len: 4, levelId: 3 });
  expect(getString(stateKey)).not.toMatch(/кот|secret|example.com|fingerPath|unexpected_for_word/);
  expect(getAnalyticsHealth().schema_rejected).toBeGreaterThanOrEqual(6);
});

test('preserves zero cost, status and landmark IDs in their own contracts', () => {
  const { track, bridge } = setup();
  track('help_used', { type: 'letter', paidWith: 'free', cost: 0 });
  track('marathon_screen_viewed', { status: 'active' });
  track('route_card_opened', { landmarkId: 'louvre', world: 1 });
  expect(payload(bridge)).toMatchObject({ type: 'letter', paidWith: 'free', cost: 0 });
  expect(payload(bridge, 1)).toMatchObject({ status: 'active' });
  expect(payload(bridge, 2)).toMatchObject({ landmarkId: 'louvre', world: 1 });
});

test('rejects unknown events and incomplete new contracts instead of silently losing required fields', () => {
  const { trackOnce, track, bridge, getAnalyticsHealth } = setup();
  expect(trackOnce('wallet_transaction', 'tx1', { delta: 10 })).toBeNull();
  track('event_typo', { amount: 10 });
  expect(bridge.reportEvent).not.toHaveBeenCalled();
  expect(getAnalyticsHealth().schema_rejected).toBeGreaterThan(0);
});

test('separates missing required fields, property losses and unknown-event rejection without losing saved counters', () => {
  const api = setup((store, bridge) => {
    bridge.isAppMetricaAvailable.mockReturnValue(false);
    store.setJSON(stateKey, {
      version: 2, playerId: 'p_quality', sessionId: 's_quality', lastActivityAt: 0, outbox: [], dedupe: [],
      health: { schema_rejected: 9, missing_required: 2, dropped_properties: 3, dedupe_hits: 4 },
    });
  });
  // Invalid delta is one dropped property and one missing required field; the private word is another drop.
  expect(api.trackOnce('wallet_transaction', 'invalid-payment', { transaction_id: 'tx1', currency: 'coins',
    delta: '10', balance_before: 0, balance_after: 10, word: 'секрет' })).toBeNull();
  api.track('event_typo');
  api.track('app_open', { source: 'direct', email: 'private@example.com', optional: undefined });
  expect(api.getAnalyticsHealth()).toMatchObject({ schema_rejected: 14,
    missing_required: 3, dropped_properties: 6, dedupe_hits: 4, queue_size: 1 });
  expect(api.getString(stateKey)).not.toMatch(/секрет|private@example|invalid-payment|"delta":"10"/);
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store, bridge) => {
    bridge.isAppMetricaAvailable.mockReturnValue(false);
    for (const [key, value] of saved) store.setString(key, value);
  });
  expect(restored.getAnalyticsHealth()).toMatchObject({ schema_rejected: 14,
    missing_required: 3, dropped_properties: 6, dedupe_hits: 4, queue_size: 1 });
});

test('persists diagnostics even when the first and only attempted event is invalid', () => {
  const api = setup();
  api.track('puzzle_paused', { attemptId: 'a1', pause_id: 'pause1' });
  expect(api.bridge.reportEvent).not.toHaveBeenCalled();
  expect(api.getJSON<{ health: Record<string, number>; outbox: unknown[] }>(stateKey, { health: {}, outbox: [] }))
    .toMatchObject({ health: { missing_required: 1, dropped_properties: 0, schema_rejected: 1 }, outbox: [] });
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store) => { for (const [key, value] of saved) store.setString(key, value); });
  expect(restored.getAnalyticsHealth()).toMatchObject({ missing_required: 1, dropped_properties: 0, schema_rejected: 1 });
});

test('reports suppressed local once-calls while keeping one event ID through queued, handed-off and restarted retries', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  const id = api.trackOnce('first_open', 'quality-once');
  expect(api.trackOnce('first_open', 'quality-once')).toBe(id);
  expect(api.getAnalyticsHealth()).toMatchObject({ dedupe_hits: 1, queue_size: 1, handoff_failures: 0 });
  api.bridge.isAppMetricaAvailable.mockReturnValue(true);
  expect(api.trackOnce('first_open', 'quality-once')).toBe(id);
  expect(api.trackOnce('first_open', 'quality-once')).toBe(id);
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(1);
  expect(api.getAnalyticsHealth()).toMatchObject({ dedupe_hits: 3, queue_size: 0, handoff_failures: 0 });
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store) => { for (const [key, value] of saved) store.setString(key, value); });
  expect(restored.trackOnce('first_open', 'quality-once')).toBe(id);
  expect(restored.bridge.reportEvent).not.toHaveBeenCalled();
  expect(restored.getAnalyticsHealth().dedupe_hits).toBe(4);
});

test('restored property losses exclude transport dimensions and are not recounted on offline restarts', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  api.setAnalyticsContext({ experimentVariants: { clarity: 'control' } });
  api.track('app_open', { source: 'direct' });
  const queue = api.getJSON<{ outbox: { envelope: Record<string, unknown> }[] }>(stateKey, { outbox: [] });
  Object.assign(queue.outbox[0].envelope, { word: 'секрет', durationSec: 'bad' });
  api.setJSON(stateKey, queue);
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store, bridge) => {
    bridge.isAppMetricaAvailable.mockReturnValue(false);
    for (const [key, value] of saved) store.setString(key, value);
  });
  expect(restored.getAnalyticsHealth()).toMatchObject({ missing_required: 0, dropped_properties: 2, schema_rejected: 0 });
  expect(restored.getString(stateKey)).not.toMatch(/секрет|durationSec/);
  const sanitized = restored.storage.getAllKeys().map((key) => [key, restored.getString(key)!] as const);
  const restarted = setup((store, bridge) => {
    bridge.isAppMetricaAvailable.mockReturnValue(false);
    for (const [key, value] of sanitized) store.setString(key, value);
  });
  expect(restarted.getAnalyticsHealth()).toMatchObject({ missing_required: 0, dropped_properties: 2, schema_rejected: 0 });
});

test('removes an incomplete restored fact and durably records its missing field without revalidation inflation', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  api.track('puzzle_paused', { attemptId: 'a1', pause_id: 'pause1', reason: 'background' });
  const queue = api.getJSON<{ outbox: { envelope: Record<string, unknown> }[] }>(stateKey, { outbox: [] });
  delete queue.outbox[0].envelope.reason;
  queue.outbox[0].envelope.raw_input = 'секрет';
  api.setJSON(stateKey, queue);
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store, bridge) => {
    bridge.isAppMetricaAvailable.mockReturnValue(false);
    for (const [key, value] of saved) store.setString(key, value);
  });
  expect(restored.getAnalyticsHealth()).toMatchObject({ queue_size: 0, missing_required: 1,
    dropped_properties: 1, schema_rejected: 1 });
  const sanitized = restored.storage.getAllKeys().map((key) => [key, restored.getString(key)!] as const);
  const restarted = setup((store) => { for (const [key, value] of sanitized) store.setString(key, value); });
  expect(restarted.getAnalyticsHealth()).toMatchObject({ queue_size: 0, missing_required: 1,
    dropped_properties: 1, schema_rejected: 1 });
  expect(restarted.bridge.reportEvent).not.toHaveBeenCalled();
});

test.each([{}, { missing_required: -1, dropped_properties: '4', dedupe_hits: Number.MAX_SAFE_INTEGER + 1 }])(
  'legacy health starts missing or invalid new fields at zero (%j)', (newFields) => {
  const api = setup((store) => store.setJSON(stateKey, {
    version: 2, playerId: 'p_legacy_quality', sessionId: 's_legacy_quality', outbox: [], dedupe: [],
    health: { schema_rejected: 7, handoff_failures: 2, queue_dropped: 3, ...newFields },
  }));
  expect(api.getAnalyticsHealth()).toMatchObject({ schema_rejected: 7, handoff_failures: 2, queue_dropped: 3,
    missing_required: 0, dropped_properties: 0, dedupe_hits: 0 });
  },
);

test('new health field counts saturate at a safe integer instead of becoming invalid telemetry', () => {
  const api = setup((store) => store.setJSON(stateKey, {
    version: 2, playerId: 'p_max_quality', sessionId: 's_max_quality', outbox: [], dedupe: [],
    health: { missing_required: Number.MAX_SAFE_INTEGER, dropped_properties: Number.MAX_SAFE_INTEGER,
      dedupe_hits: Number.MAX_SAFE_INTEGER },
  }));
  api.track('puzzle_paused', { attemptId: 'a1', pause_id: 'pause1', raw_input: 'секрет' });
  api.trackFirstOpen(); api.trackFirstOpen();
  expect(api.getAnalyticsHealth()).toMatchObject({ missing_required: Number.MAX_SAFE_INTEGER,
    dropped_properties: Number.MAX_SAFE_INTEGER, dedupe_hits: Number.MAX_SAFE_INTEGER });
  api.trackAnalyticsHealthSummary();
  const summary = api.bridge.reportEvent.mock.calls.find(([name]: [string]) => name === 'analytics_health_summary');
  expect(summary?.[1]).toMatchObject({ missing_required: Number.MAX_SAFE_INTEGER,
    dropped_properties: Number.MAX_SAFE_INTEGER, dedupe_hits: Number.MAX_SAFE_INTEGER });
});

test('opt-out clears quality diagnostics and disabled calls cannot rebuild or emit them', () => {
  const api = setup();
  api.track('puzzle_paused', { attemptId: 'a1', pause_id: 'pause1', email: 'private@example.com' });
  api.trackFirstOpen(); api.trackFirstOpen();
  expect(api.getAnalyticsHealth()).toMatchObject({ missing_required: 1, dropped_properties: 1, dedupe_hits: 1 });
  api.useAnalyticsPrefs.getState().setOptOut(true);
  api.bridge.reportEvent.mockClear();
  api.track('puzzle_paused', { raw_input: 'секрет' });
  api.trackFirstOpen(); api.trackFirstOpen(); api.trackAnalyticsHealthSummary();
  expect(api.getAnalyticsHealth()).toMatchObject({ missing_required: 0, dropped_properties: 0, dedupe_hits: 0, queue_size: 0 });
  expect(api.getString(stateKey)).toBeNull();
  expect(api.bridge.reportEvent).not.toHaveBeenCalled();
  api.useAnalyticsPrefs.getState().setOptOut(false);
  api.trackFirstOpen();
  api.trackAnalyticsHealthSummary();
  const summary = api.bridge.reportEvent.mock.calls.find(([name]: [string]) => name === 'analytics_health_summary');
  expect(summary?.[1]).toMatchObject({ missing_required: 0, dropped_properties: 0, dedupe_hits: 0,
    schema_version: 3, consent_state: 'enabled', app_version: expect.any(String) });
});

test.each(['development', 'qa', 'test_ads', 'native_test', 'persisted_qa', 'unknown_bridge'])(
  'excludes every event family in %s, not just subscription', (kind) => {
    const api = setup();
    if (kind === 'development') Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
    if (kind === 'qa') process.env.EXPO_PUBLIC_ANALYTICS_TEST_DEVICE = '1';
    if (kind === 'test_ads') process.env.EXPO_PUBLIC_YANDEX_TEST_ADS = '1';
    if (kind === 'native_test') api.bridge.isAppMetricaTestDevice.mockReturnValue(true);
    if (kind === 'persisted_qa') api.setString('analytics.subscription-test-device.v1', '1');
    if (kind === 'unknown_bridge') api.bridge.isAppMetricaTestDevice.mockImplementation(() => { throw new Error('unknown'); });
    api.track('word_submit_outcome', { result: 'target' });
    api.trackFirstOpen(); api.flushAnalytics();
    expect(api.bridge.reportEvent).not.toHaveBeenCalled();
    expect(api.getString(stateKey)).toBeNull();
  },
);

test('applies native opt-out synchronously, clears pending data and rotates the local identity on opt-in', () => {
  const api = setup();
  api.track('app_open'); const oldPlayer = payload(api.bridge).player_id;
  api.bridge.isAppMetricaAvailable.mockReturnValue(false); api.track('app_open');
  api.useAnalyticsPrefs.getState().setOptOut(true);
  expect(api.bridge.setDataSendingEnabled).toHaveBeenLastCalledWith(false);
  expect(api.getString(stateKey)).toBeNull();
  api.bridge.reportEvent.mockClear(); api.trackFirstOpen(); api.flushAnalytics();
  expect(api.bridge.reportEvent).not.toHaveBeenCalled();
  api.useAnalyticsPrefs.getState().setOptOut(false); api.bridge.isAppMetricaAvailable.mockReturnValue(true);
  api.trackFirstOpen();
  expect(payload(api.bridge).player_id).not.toBe(oldPlayer);
});

test('retains committed once-keys beyond 512 newer facts and across a process restart', () => {
  const api = setup();
  const first = api.trackOnce('reward_granted', 'committed:0', { amount: 1 });
  for (let i = 1; i <= 600; i++) api.trackOnce('reward_granted', 'committed:' + i, { amount: 1 });
  expect(api.trackOnce('reward_granted', 'committed:0')).toBe(first);
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(601);
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store) => { for (const [key, value] of saved) store.setString(key, value); });
  expect(restored.trackOnce('reward_granted', 'committed:0')).toBe(first);
  expect(restored.bridge.reportEvent).not.toHaveBeenCalled();
});

test('accepts long domain keys without exposing them or confusing different keys', () => {
  const { trackOnce, bridge } = setup();
  const longKey = 'committed:' + 'a'.repeat(250);
  const first = trackOnce('reward_granted', longKey, { amount: 10 });
  expect(first).toMatch(/^e_/); expect(trackOnce('reward_granted', longKey)).toBe(first);
  expect(trackOnce('reward_granted', longKey + 'b')).not.toBe(first);
  expect(JSON.stringify(bridge.reportEvent.mock.calls)).not.toContain(longKey);
});

test('keeps false/throwing SDK handoffs for retry with the original event ID', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T10:00:00Z'));
  const api = setup();
  api.bridge.reportEvent.mockReturnValueOnce(false);
  const first = api.trackOnce('reward_granted', 'retry:1', { rewardId: 'reward1' });
  expect(api.getJSON<{ outbox: unknown[] }>(stateKey, { outbox: [] }).outbox).toHaveLength(1);
  api.flushAnalytics();
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(1);
  jest.setSystemTime(Date.now() + 1000);
  api.flushAnalytics();
  expect(payload(api.bridge, 1).event_id).toBe(first);
  expect(api.getJSON<{ outbox: unknown[] }>(stateKey, { outbox: [] }).outbox).toHaveLength(0);
  expect(api.getAnalyticsHealth().handoff_failures).toBe(1);
});

test('does not acknowledge any critical event if durable state storage silently fails', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  const original = api.storage.set.bind(api.storage);
  const writer = jest.spyOn(api.storage, 'set').mockImplementation((key, value) => {
    if (key === stateKey) throw new Error('disk full');
    original(key, value);
  });
  expect(api.trackOnce('reward_granted', 'durable:1', { amount: 10 })).toBeNull();
  expect(api.bridge.reportEvent).not.toHaveBeenCalled();
  writer.mockRestore();
  expect(api.trackOnce('reward_granted', 'durable:1', { amount: 10 })).not.toBeNull();
});

test('bounds the outbox and protects committed reminders from a high-volume diagnostic stream', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  const first = api.trackOnce('reminder_delivered', 'reminder1');
  for (let i = 0; i < 700; i++) api.track('gameplay_action', { action: 'word_submitted' });
  const queue = api.getJSON<{ outbox: { envelope: { event_id: string } }[] }>(stateKey, { outbox: [] }).outbox;
  expect(queue).toHaveLength(512);
  expect(queue.some((entry) => entry.envelope.event_id === first)).toBe(true);
  expect(api.getAnalyticsHealth().queue_dropped).toBe(189);
});

test('a later reminder cannot evict an acknowledged wallet fact from a full critical queue', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  const walletId = api.trackOnce('wallet_transaction', 'wallet:committed', {
    transaction_id: 'wallet:committed', currency: 'coins', delta: 10, balance_before: 0, balance_after: 10,
  });
  expect(walletId).not.toBeNull();
  for (let index = 0; index < 511; index += 1) {
    expect(api.trackOnce('reward_granted', 'reward:fill:' + index, { amount: 1 })).not.toBeNull();
  }
  expect(api.trackOnce('reminder_delivered', 'reminder:retry')).toBeNull();
  const queue = api.getJSON<{ outbox: { envelope: { event_id: string } }[] }>(stateKey, { outbox: [] }).outbox;
  expect(queue).toHaveLength(512);
  expect(queue.some((event) => event.envelope.event_id === walletId)).toBe(true);
  api.bridge.isAppMetricaAvailable.mockReturnValue(true);
  api.flushAnalytics();
  expect(api.bridge.reportEvent.mock.calls.filter(([name]: [string]) => name === 'wallet_transaction')).toHaveLength(1);
  expect(api.trackOnce('reminder_delivered', 'reminder:retry')).not.toBeNull();
});

test('migrates v2 outbox in place, preserving ID/time/assignment and stripping untrusted persisted fields', () => {
  const api = setup((store) => store.setJSON(stateKey, {
    version: 2, playerId: 'p_stable', sessionId: 's_stable', lastActivityAt: 0, dedupe: [],
    context: { variantId: 'control', experimentVariants: { intro: 'A' } },
    outbox: [{ name: 'word_submitted', envelope: {
      event_id: 'e_stable', schema_version: 2, occurred_at: '2026-09-26T10:00:00.000Z',
      session_id: 's_stable', app_version: '0.1.28', secret: 'private',
      experiment_variants: { intro: 'B', phone: '+71234567890' },
      properties: { len: 5, word: 'кошка', fingerPath: [[1, 2]] },
    } }],
  }));
  api.flushAnalytics();
  expect(payload(api.bridge)).toMatchObject({ event_id: 'e_stable', player_id: 'p_stable', session_id: 's_stable',
    schema_version: 3, migrated_from_schema: 2, occurred_at: '2026-09-26T10:00:00.000Z', app_version: '0.1.28', len: 5, experiment_variant_intro: 'B' });
  expect(JSON.stringify(payload(api.bridge))).not.toMatch(/private|кошка|fingerPath|71234567890/);
});

test('background delivery does not extend a session, while actual user activity does', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-26T10:00:00Z'));
  const api = setup();
  api.trackGameSessionStart(); const first = api.getAnalyticsSession().sessionId;
  jest.setSystemTime(new Date('2026-09-26T10:20:00Z'));
  api.track('reminder_delivered', { promptId: 'r1' }); api.flushAnalytics();
  jest.setSystemTime(new Date('2026-09-26T10:31:00Z'));
  expect(api.getAnalyticsSession().sessionId).not.toBe(first);
  const next = api.getAnalyticsSession().sessionId;
  jest.setSystemTime(new Date('2026-09-26T10:55:00Z'));
  api.noteAnalyticsActivity();
  jest.setSystemTime(new Date('2026-09-26T11:10:00Z'));
  expect(api.getAnalyticsSession().sessionId).toBe(next);
});

test('first-open remains once-per-profile, and letter gesture frames do not flood gameplay telemetry', () => {
  const api = setup();
  api.trackFirstOpen(); api.trackFirstOpen();
  api.trackGameplayAction('letters_connected'); api.trackGameplayAction('word_submitted', { len: 3, word: 'кот' });
  expect(api.bridge.reportEvent.mock.calls.map(([name]: [string]) => name)).toEqual(['first_open', 'gameplay_action']);
  expect(payload(api.bridge, 1)).toMatchObject({ action: 'word_submitted', len: 3 });
});

test('preserves integer SDK identity as text and emits at most one nonrecursive health summary per session', async () => {
  const api = setup();
  api.track('app_open'); await Promise.resolve();
  api.track('app_open');
  expect(payload(api.bridge, 1)).toMatchObject({ device_key: '18446744073709551615', install_key: 'install_test' });
  api.trackAnalyticsHealthSummary(); api.trackAnalyticsHealthSummary();
  expect(api.bridge.reportEvent.mock.calls.filter(([name]: [string]) => name === 'analytics_health_summary')).toHaveLength(1);
});

test('does not manufacture server-only payment facts from the client', () => {
  const api = setup();
  expect(api.trackOnce('subscription_server_event', 'fake', { server_event_id: 'fake', event_type: 'paid' })).toBeNull();
  expect(api.bridge.reportEvent).not.toHaveBeenCalled();
});

test('a persisted native denial wins over a missing JS preference until explicit opt-in', () => {
  const api = setup((_store, bridge) => bridge.getDataSendingPreference.mockReturnValue(false));
  expect(api.useAnalyticsPrefs.getState().optOut).toBe(true);
  expect(api.bridge.setDataSendingEnabled).toHaveBeenLastCalledWith(false);
  api.trackFirstOpen();
  expect(api.bridge.reportEvent).not.toHaveBeenCalled();
  api.useAnalyticsPrefs.getState().setOptOut(false);
  api.trackFirstOpen();
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(1);
});

test('a recovered cumulative summary retains its original analytic session ID', () => {
  const api = setup();
  api.trackGameSessionStart();
  api.trackOnce('gameplay_session_summary', 's_older:2', {
    analytics_session_id: 's_older', revision: 2, gameplay_visible_ms: 2000,
  });
  expect(payload(api.bridge, 1).analytics_session_id).toBe('s_older');
});

test('health summaries retain once-per-session identity across process restart', () => {
  const api = setup();
  api.trackGameSessionStart(); api.trackAnalyticsHealthSummary();
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store) => { for (const [key, value] of saved) store.setString(key, value); });
  restored.trackAnalyticsHealthSummary();
  expect(restored.bridge.reportEvent).not.toHaveBeenCalled();
});

test('queued v3 assignments survive changed context and restart without overwriting experiment_id', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  api.setAnalyticsContext({ experimentVariants: { id: 'metadata', intro: 'B' } });
  api.track('experiment_assigned', { experiment_id: 'exp_real', assignment_id: 'asg1', variant: 'B' });
  api.setAnalyticsContext({ experimentVariants: { intro: 'control' } });
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store) => { for (const [key, value] of saved) store.setString(key, value); });
  restored.flushAnalytics();
  expect(payload(restored.bridge)).toMatchObject({ experiment_id: 'exp_real', experiment_variant_intro: 'B', experiment_variant_id: 'metadata' });
});

test('marks unknown recovered occurrence time without relabelling it as verified gameplay today', () => {
  const api = setup();
  api.track('daily_completed', { dateKey: '2026-09-25', actionDay: '2026-09-26', timeKnown: false, recovery: true });
  expect(payload(api.bridge)).toMatchObject({ timeKnown: false, recovery: true, time_trust: 'occurrence_unknown' });
});

test('push correlation does not overwrite SDK identity linkage or vice versa', () => {
  const api = setup();
  api.track('push_lifecycle', { message_id_hash: 'm1', stage: 'opened', provider: 'rustore', binding_state: 'unknown' });
  expect(payload(api.bridge)).toMatchObject({ binding_state: 'unknown', identity_binding_state: 'unlinked' });
});

test('a new consent epoch excludes old/off-period and unknown recovered actions across restart', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-01T10:00:00Z'));
  const api = setup();
  expect(api.getAnalyticsConsentEpoch()).toBeNull();
  api.useAnalyticsPrefs.getState().setOptOut(true);
  jest.setSystemTime(new Date('2026-11-01T11:00:00Z'));
  api.useAnalyticsPrefs.getState().setOptOut(false);
  const epoch = Date.now();
  expect(api.getAnalyticsConsentEpoch()).toBe(epoch);
  api.trackOnce('daily_completed', 'off_daily', { occurredAtMs: epoch - 30_000, timeKnown: true, recovery: true });
  api.trackOnce('quest_completed', 'off_quest', { timeKnown: false, recovery: true });
  api.trackOnce('quest_completed', 'unknown_quest', { recovery: true });
  expect(api.bridge.reportEvent).not.toHaveBeenCalled();
  api.trackOnce('daily_completed', 'new_daily', { occurredAtMs: epoch + 1, timeKnown: true });
  expect(payload(api.bridge)).toMatchObject({ consent_epoch_at: '2026-11-01T11:00:00.000Z' });
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store) => { for (const [key, value] of saved) store.setString(key, value); });
  expect(restored.getAnalyticsConsentEpoch()).toBe(epoch);
  restored.trackOnce('daily_completed', 'off_daily', { occurredAtMs: epoch - 30_000, timeKnown: true });
  expect(restored.bridge.reportEvent).not.toHaveBeenCalled();
});

test('a failed consent boundary write keeps native collection disabled', () => {
  const api = setup();
  api.useAnalyticsPrefs.getState().setOptOut(true);
  const original = api.storage.set.bind(api.storage);
  jest.spyOn(api.storage, 'set').mockImplementation((key, value) => {
    if (key === 'analytics.consent-epoch.v1') throw new Error('disk full');
    original(key, value);
  });
  api.useAnalyticsPrefs.getState().setOptOut(false);
  expect(api.useAnalyticsPrefs.getState().optOut).toBe(true);
  expect(api.bridge.setDataSendingEnabled).toHaveBeenLastCalledWith(false);
  api.trackFirstOpen(); expect(api.bridge.reportEvent).not.toHaveBeenCalled();
});

test('UI intent gets an opaque interaction ID at the collection boundary', () => {
  const api = setup();
  api.track('ui_action', { screen: 'daily', element_id: 'start', action: 'press' });
  expect(payload(api.bridge)).toMatchObject({ interaction_id: expect.stringMatching(/^interaction_/), screen: 'daily' });
});

test('expires queued data exactly after seven days without replaying an acknowledged once fact', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T10:00:00Z'));
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  const id = api.trackOnce('first_open', 'ttl-profile');
  api.track('app_open');
  jest.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 - 1);
  api.flushAnalytics();
  expect(api.getAnalyticsHealth().queue_size).toBe(2);
  jest.setSystemTime(Date.now() + 1);
  api.bridge.isAppMetricaAvailable.mockReturnValue(true);
  api.flushAnalytics();
  expect(api.bridge.reportEvent).not.toHaveBeenCalled();
  expect(api.getAnalyticsHealth()).toMatchObject({ queue_size: 0, queue_expired: 2, queue_dropped: 2 });
  expect(api.trackOnce('first_open', 'ttl-profile')).toBe(id);
  expect(api.bridge.reportEvent).not.toHaveBeenCalled();
});

test('a recovered old occurrence gets its own queue lifetime without rewriting the occurrence', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T10:00:00Z'));
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  api.track('daily_completed', { occurredAtMs: Date.now() - 30 * 24 * 60 * 60 * 1000, recovery: true, timeKnown: true });
  jest.setSystemTime(Date.now() + 1000);
  api.bridge.isAppMetricaAvailable.mockReturnValue(true);
  api.flushAnalytics();
  expect(payload(api.bridge)).toMatchObject({ occurred_at: '2026-10-03T10:00:00.000Z', recovery: true });
  expect(payload(api.bridge).queuedAtMs).toBeUndefined();
  expect(payload(api.bridge).handoffAttempts).toBeUndefined();
});

test('bounds throwing native handoffs to eight attempts with increasing delays and a stable once ID', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T10:00:00Z'));
  const api = setup();
  api.bridge.reportEvent.mockImplementation(() => { throw new Error('native unavailable'); });
  const id = api.trackOnce('first_open', 'retry-limit');
  for (const delay of [1000, 2000, 4000, 8000, 16000, 32000, 60000]) {
    const calls = api.bridge.reportEvent.mock.calls.length;
    jest.setSystemTime(Date.now() + delay - 1);
    api.flushAnalytics();
    expect(api.bridge.reportEvent).toHaveBeenCalledTimes(calls);
    jest.setSystemTime(Date.now() + 1);
    api.flushAnalytics();
    expect(api.bridge.reportEvent).toHaveBeenCalledTimes(calls + 1);
  }
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(8);
  expect(api.bridge.reportEvent.mock.calls.every(([, event]: [string, Record<string, unknown>]) => event.event_id === id)).toBe(true);
  expect(api.getAnalyticsHealth()).toMatchObject({ queue_size: 0, handoff_failures: 8, handoff_exhausted: 1 });
  expect(api.trackOnce('first_open', 'retry-limit')).toBe(id);
  api.flushAnalytics();
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(8);
});

test('a record waiting for retry does not block another ready event', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T10:00:00Z'));
  const api = setup();
  api.bridge.reportEvent.mockImplementation((name: string) => name !== 'first_open');
  const id = api.trackOnce('first_open', 'retry-head');
  api.track('app_open');
  expect(api.bridge.reportEvent.mock.calls.map(([name]: [string]) => name)).toEqual(['first_open', 'app_open']);
  expect(api.getAnalyticsHealth().queue_size).toBe(1);
  api.bridge.reportEvent.mockReturnValue(true);
  jest.setSystemTime(Date.now() + 1000);
  api.flushAnalytics();
  expect(payload(api.bridge, 2).event_id).toBe(id);
  expect(api.getAnalyticsHealth().queue_size).toBe(0);
});

test('persists retry delay and attempt count across a process restart', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T10:00:00Z'));
  const api = setup();
  api.bridge.reportEvent.mockReturnValue(false);
  const id = api.trackOnce('first_open', 'retry-restart');
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store) => { for (const [key, value] of saved) store.setString(key, value); });
  jest.setSystemTime(Date.now() + 999);
  restored.flushAnalytics();
  expect(restored.bridge.reportEvent).not.toHaveBeenCalled();
  jest.setSystemTime(Date.now() + 1);
  restored.flushAnalytics();
  expect(payload(restored.bridge).event_id).toBe(id);
  expect(restored.getAnalyticsHealth().handoff_failures).toBe(1);
});

test('never calls the SDK when the retry reservation cannot be persisted', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T10:00:00Z'));
  const api = setup();
  api.bridge.reportEvent.mockReturnValueOnce(false);
  const id = api.trackOnce('first_open', 'retry-storage');
  jest.setSystemTime(Date.now() + 1000);
  const original = api.storage.set.bind(api.storage);
  const writer = jest.spyOn(api.storage, 'set').mockImplementation((key, value) => {
    if (key === stateKey) throw new Error('disk full');
    original(key, value);
  });
  api.flushAnalytics();
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(1);
  writer.mockRestore();
  api.flushAnalytics();
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(2);
  expect(payload(api.bridge, 1).event_id).toBe(id);
});

test('a large backward clock jump cannot hold a once record indefinitely or recreate it', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T10:00:00Z'));
  const api = setup();
  api.bridge.reportEvent.mockReturnValue(false);
  const id = api.trackOnce('first_open', 'clock-jump');
  jest.setSystemTime(Date.now() - 120_000);
  api.flushAnalytics();
  expect(api.getAnalyticsHealth()).toMatchObject({ queue_size: 0, queue_dropped: 1 });
  expect(api.trackOnce('first_open', 'clock-jump')).toBe(id);
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(1);
});

test('keeps each flush bounded while later flushes drain the existing queue', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  for (let index = 0; index < 40; index += 1) api.track('app_open');
  api.bridge.isAppMetricaAvailable.mockReturnValue(true);
  api.flushAnalytics();
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(32);
  expect(api.getAnalyticsHealth().queue_size).toBe(8);
  api.flushAnalytics();
  expect(api.bridge.reportEvent).toHaveBeenCalledTimes(40);
  expect(api.getAnalyticsHealth().queue_size).toBe(0);
});

test('persists a legacy queue migration once so offline restarts cannot reset its TTL', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T10:00:00Z'));
  const startedAt = Date.now();
  const api = setup((store, bridge) => {
    bridge.isAppMetricaAvailable.mockReturnValue(false);
    store.setJSON(stateKey, {
      version: 2, playerId: 'p_old', sessionId: 's_old', lastActivityAt: 0, dedupe: [],
      outbox: [{ name: 'app_open', envelope: { event_id: 'e_old', schema_version: 2,
        occurred_at: '2026-09-26T10:00:00.000Z', properties: {} } }],
    });
  });
  api.flushAnalytics();
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  expect(api.getJSON<{ outbox: { queuedAtMs: number }[] }>(stateKey, { outbox: [] }).outbox[0].queuedAtMs).toBe(startedAt);
  jest.setSystemTime(startedAt + 7 * 24 * 60 * 60 * 1000);
  const restored = setup((store, bridge) => {
    bridge.isAppMetricaAvailable.mockReturnValue(false);
    for (const [key, value] of saved) store.setString(key, value);
  });
  restored.flushAnalytics();
  expect(restored.getAnalyticsHealth()).toMatchObject({ queue_size: 0, queue_expired: 1 });
  expect(restored.bridge.reportEvent).not.toHaveBeenCalled();
});

test('deduplicates a repeated persisted event before native replay', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  const id = api.trackOnce('first_open', 'duplicate-persisted');
  const queue = api.getJSON<{ outbox: unknown[] }>(stateKey, { outbox: [] });
  queue.outbox.push(queue.outbox[0]);
  api.setJSON(stateKey, queue);
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store) => { for (const [key, value] of saved) store.setString(key, value); });
  restored.flushAnalytics();
  expect(restored.bridge.reportEvent).toHaveBeenCalledTimes(1);
  expect(payload(restored.bridge).event_id).toBe(id);
  expect(restored.getAnalyticsHealth()).toMatchObject({ queue_size: 0, queue_dropped: 1, dedupe_hits: 1 });
});

test('a corrupt persisted retry budget cannot start a fresh series of native attempts', () => {
  const api = setup();
  api.bridge.isAppMetricaAvailable.mockReturnValue(false);
  const id = api.trackOnce('first_open', 'corrupt-budget');
  const queue = api.getJSON<{ outbox: { handoffAttempts: unknown }[] }>(stateKey, { outbox: [] });
  queue.outbox[0].handoffAttempts = -1;
  api.setJSON(stateKey, queue);
  const saved = api.storage.getAllKeys().map((key) => [key, api.getString(key)!] as const);
  const restored = setup((store) => { for (const [key, value] of saved) store.setString(key, value); });
  restored.flushAnalytics();
  expect(restored.bridge.reportEvent).not.toHaveBeenCalled();
  expect(restored.getAnalyticsHealth()).toMatchObject({ queue_size: 0, handoff_exhausted: 1 });
  expect(restored.trackOnce('first_open', 'corrupt-budget')).toBe(id);
});

test.each([2, 3])('restores schema %s with valid retry metadata without reviving untrusted persisted fields', (schemaVersion) => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-04T08:00:00Z'));
  const now = Date.now();
  const properties = { source: 'direct', email: 'private.user@example.com', raw_token: 'private-persisted-token' };
  const api = setup((store, bridge) => {
    bridge.reportEvent.mockReturnValue(false);
    store.setJSON(stateKey, {
      version: 2, playerId: 'p_saved', sessionId: 's_saved', lastActivityAt: now, dedupe: [],
      outbox: [{ name: 'app_open', raw_secret: 'private-entry-extra',
        queuedAtMs: now - 3000, handoffAttempts: 1, lastAttemptAtMs: now - 2000, nextAttemptAtMs: now - 1000,
        envelope: { event_id: 'e_saved', schema_version: schemaVersion, occurred_at: '2026-11-04T07:59:55.000Z',
          email: 'private-envelope@example.com', ...(schemaVersion === 2 ? { properties } : properties) } }],
    });
  });
  api.flushAnalytics();
  const saved = api.getJSON<{ outbox: { envelope: Record<string, unknown>; handoffAttempts: number;
    queuedAtMs: number; lastAttemptAtMs: number; nextAttemptAtMs: number }[] }>(stateKey, { outbox: [] });
  const expected = { event_id: 'e_saved', schema_version: 3, source: 'direct', occurred_at: '2026-11-04T07:59:55.000Z',
    ...(schemaVersion === 2 ? { migrated_from_schema: 2 } : {}) };
  expect(payload(api.bridge)).toMatchObject(expected);
  expect(saved.outbox[0]).toMatchObject({ queuedAtMs: now - 3000, handoffAttempts: 2,
    lastAttemptAtMs: now, nextAttemptAtMs: now + 2000, envelope: expected });
  expect(JSON.stringify({ handedOff: payload(api.bridge), saved }))
    .not.toMatch(/private[.-]|email|raw_token|raw_secret/);
});
