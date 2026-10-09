/* eslint-disable import/first, @typescript-eslint/no-require-imports */
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: jest.fn(),
  isAppMetricaAvailable: jest.fn(() => true),
}));

import { isAppMetricaAvailable, reportEvent } from '@/core/native/appmetrica';
import { getJSON, getString, KEYS, removeKey, storage } from '@/core/storage';
import {
  flushAnalytics,
  getAnalyticsSession,
  setAnalyticsContext,
  track,
  trackFirstOpen,
  trackGameSessionStart,
  trackGameplayAction,
  trackOnce,
  useAnalyticsPrefs,
} from '@/features/analytics';

const mockReport = reportEvent as jest.MockedFunction<typeof reportEvent>;
const mockAvailable = isAppMetricaAvailable as jest.MockedFunction<typeof isAppMetricaAvailable>;
const stateKey = 'analytics.outbox.v2';
const sessionKey = 'analytics.session.v1';

function sent(index = 0): Record<string, unknown> {
  return mockReport.mock.calls[index][1] as Record<string, unknown>;
}

describe('analytics envelope and delivery', () => {
  beforeEach(() => {
    useAnalyticsPrefs.getState().setOptOut(true);
    removeKey(sessionKey);
    useAnalyticsPrefs.getState().setOptOut(false);
    mockReport.mockReset();
    mockReport.mockReturnValue(true);
    mockAvailable.mockReturnValue(true);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('sends an anonymous versioned envelope with event and receipt times', () => {
    track('level_complete', { levelId: 'w1l3', durationSec: 42 });
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport.mock.calls[0][0]).toBe('level_complete');
    expect(sent()).toMatchObject({
      schema_version: 2,
      time_trust: 'client_unverified',
      app_version: expect.any(String),
      config_version: 'local-v1',
      content_version: 'unknown',
      variant_id: 'unassigned',
      properties: { levelId: 'w1l3', durationSec: 42 },
    });
    expect(sent().event_id).toMatch(/^e_/);
    expect(sent().player_id).toMatch(/^p_/);
    expect(sent().session_id).toMatch(/^s_/);
    expect(Number.isNaN(Date.parse(sent().occurred_at as string))).toBe(false);
    expect(Number.isNaN(Date.parse(sent().received_at as string))).toBe(false);
    expect(getJSON<{ outbox: unknown[] }>(stateKey, { outbox: [] }).outbox).toHaveLength(0);
  });

  it('strips raw words, gesture paths, nested values, PII and unknown keys before persistence', () => {
    mockAvailable.mockReturnValue(false);
    track('word_submitted', {
      result: 'grid', len: 4, levelId: 3,
      word: 'кот', rawInput: 'кот', fingerPath: [[1, 2]], email: 'me@example.com',
      id: 'кошка', coords: { x: 2 }, reason: 'not_in_dictionary',
    });
    const queued = getJSON<{ outbox: { envelope: { properties: unknown } }[] }>(stateKey, { outbox: [] });
    expect(queued.outbox[0].envelope.properties).toEqual({
      result: 'grid', len: 4, levelId: 3, reason: 'not_in_dictionary',
    });
    expect(getString(stateKey)).not.toMatch(/кот|кошка|example\.com|fingerPath|rawInput/);
    mockAvailable.mockReturnValue(true);
    flushAnalytics();
    expect(sent().properties).toEqual(queued.outbox[0].envelope.properties);
  });

  it('preserves the zero cost of free introduction help in the delivered event', () => {
    track('help_used', { type: 'letter', paidWith: 'free', cost: 0 });
    expect(sent().properties).toEqual({ type: 'letter', paidWith: 'free', cost: 0 });
  });

  it('deduplicates a committed result by stable key, including after a simulated restart', () => {
    mockAvailable.mockReturnValue(false);
    const eventId = trackOnce('reward_granted', 'completion:42', { rewardId: 'postcard-1', amount: 10 });
    expect(trackOnce('reward_granted', 'completion:42', { amount: 20 })).toBe(eventId);
    expect(getJSON<{ outbox: unknown[] }>(stateKey, { outbox: [] }).outbox).toHaveLength(1);
    const saved = getString(stateKey);

    jest.isolateModules(() => {
      const storage = require('@/core/storage') as typeof import('@/core/storage');
      storage.setString(stateKey, saved!);
      const native = require('@/core/native/appmetrica') as typeof import('@/core/native/appmetrica');
      (native.isAppMetricaAvailable as jest.Mock).mockReturnValue(true);
      const reloaded = require('@/features/analytics') as typeof import('@/features/analytics');
      reloaded.flushAnalytics();
      const report = native.reportEvent as jest.Mock;
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0][1].event_id).toBe(eventId);
      expect(report.mock.calls[0][1].player_id).toBe(JSON.parse(saved!).playerId);
      expect(reloaded.trackOnce('reward_granted', 'completion:42')).toBe(eventId);
      expect(report).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps reminder telemetry through gameplay flooding and refuses an unretained acknowledgement', () => {
    mockAvailable.mockReturnValue(false);
    const original = trackOnce('reminder_delivered', 'reminder:1', {
      promptId: 'reminder:1', occurredAtMs: Date.now() - 1000, fireAtMs: Date.now() - 2000,
    });
    expect(original).not.toBeNull();
    for (let i = 0; i < 200; i++) track('gameplay_action', { action: 'word_submitted' });
    let queue = getJSON<{ outbox: { envelope: { event_id: string } }[] }>(stateKey, { outbox: [] });
    expect(queue.outbox.some((event) => event.envelope.event_id === original)).toBe(true);
    for (let i = 2; i <= 128; i++) expect(trackOnce('reminder_delivered', `reminder:${i}`)).not.toBeNull();
    expect(trackOnce('reminder_delivered', 'reminder:overflow')).toBeNull();
    queue = getJSON(stateKey, { outbox: [] });
    expect(queue.outbox).toHaveLength(128);
    mockAvailable.mockReturnValue(true);
    flushAnalytics();
    expect(trackOnce('reminder_delivered', 'reminder:overflow')).not.toBeNull();
  });

  it('does not acknowledge a reminder when storage silently fails', () => {
    mockAvailable.mockReturnValue(false);
    const write = jest.spyOn(storage, 'set');
    write.mockImplementation((key) => { if (key === stateKey) throw new Error('disk full'); });
    expect(trackOnce('reminder_delivered', 'reminder:retry')).toBeNull();
    expect(mockReport).not.toHaveBeenCalled();
    write.mockRestore();
    expect(trackOnce('reminder_delivered', 'reminder:retry')).not.toBeNull();
  });

  it('keeps a failed handoff in a bounded persisted outbox and retries the same event ID', () => {
    mockReport.mockImplementationOnce(() => { throw new Error('native unavailable'); });
    track('app_open');
    const queued = getJSON<{ outbox: { envelope: { event_id: string } }[] }>(stateKey, { outbox: [] });
    expect(queued.outbox).toHaveLength(1);
    flushAnalytics();
    expect(mockReport).toHaveBeenCalledTimes(2);
    expect(sent(0).event_id).toBe(queued.outbox[0].envelope.event_id);
    expect(sent(1).event_id).toBe(queued.outbox[0].envelope.event_id);
    expect(getJSON<{ outbox: unknown[] }>(stateKey, { outbox: [] }).outbox).toHaveLength(0);

    mockAvailable.mockReturnValue(false);
    trackOnce('reward_granted', 'important:1', { rewardId: 'postcard-1' });
    for (let i = 0; i < 140; i += 1) track('app_open');
    const bounded = getJSON<{ outbox: { name: string }[] }>(stateKey, { outbox: [] }).outbox;
    expect(bounded).toHaveLength(128);
    expect(bounded[0].name).toBe('reward_granted');
  });

  it('keeps a falsely acknowledged adapter call through restart and retries the same ID', () => {
    mockReport.mockReturnValueOnce(false);
    const eventId = trackOnce('reward_granted', 'ticket:42', { rewardId: 'ticket-42' });
    const queued = getJSON<{ outbox: { envelope: { event_id: string; received_at: string | null } }[] }>(
      stateKey, { outbox: [] },
    );
    expect(queued.outbox).toHaveLength(1);
    expect(queued.outbox[0].envelope).toMatchObject({ event_id: eventId, received_at: null });
    const persisted = getString(stateKey)!;

    jest.isolateModules(() => {
      const storage = require('@/core/storage') as typeof import('@/core/storage');
      storage.setString(stateKey, persisted);
      const native = require('@/core/native/appmetrica') as typeof import('@/core/native/appmetrica');
      (native.reportEvent as jest.Mock).mockReturnValue(true);
      const reloaded = require('@/features/analytics') as typeof import('@/features/analytics');
      reloaded.flushAnalytics();
      expect((native.reportEvent as jest.Mock).mock.lastCall?.[1].event_id).toBe(eventId);
      expect(storage.getJSON<{ outbox: unknown[] }>(stateKey, { outbox: [] }).outbox).toHaveLength(0);
    });
  });

  it('retains the session for 30 minutes and reports a new one after inactivity', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-26T10:00:00Z'));
    trackGameSessionStart('direct');
    trackGameSessionStart('direct');
    expect(mockReport).toHaveBeenCalledTimes(1);
    const first = sent().session_id;
    jest.setSystemTime(new Date('2026-09-26T10:31:00Z'));
    trackGameSessionStart('push');
    expect(mockReport).toHaveBeenCalledTimes(2);
    expect(sent(1).session_id).not.toBe(first);
    expect(sent(1).properties).toEqual({ source: 'push' });
  });

  it('persists the first-session ad gate through a process restart and analytics opt-out', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-26T10:00:00Z'));
    const first = getAnalyticsSession();
    expect(first.isFirstSession).toBe(true);
    useAnalyticsPrefs.getState().setOptOut(true);
    const savedSession = getString(sessionKey);
    expect(getString(stateKey)).toBeNull();

    jest.isolateModules(() => {
      const storage = require('@/core/storage') as typeof import('@/core/storage');
      storage.setString(sessionKey, savedSession!);
      const reloaded = require('@/features/analytics') as typeof import('@/features/analytics');
      expect(reloaded.getAnalyticsSession()).toEqual(first);
      jest.setSystemTime(new Date('2026-09-26T10:31:00Z'));
      const next = reloaded.getAnalyticsSession();
      expect(next.sessionId).not.toBe(first.sessionId);
      expect(next.isFirstSession).toBe(false);
      expect(reloaded.getAnalyticsSession()).toEqual(next);
    });
  });

  it('emits first open once and separates a gameplay action from app opening', () => {
    trackFirstOpen();
    trackFirstOpen();
    trackGameplayAction('word_submitted', { len: 3, word: 'кот' });
    expect(mockReport.mock.calls.map(([name]) => name)).toEqual(['first_open', 'gameplay_action']);
    expect(sent(1).properties).toEqual({ action: 'word_submitted', len: 3 });
  });

  it('persists assigned variants with the event at occurrence time', () => {
    mockAvailable.mockReturnValue(false);
    setAnalyticsContext({ configVersion: 'retention-v1', variantId: 'B', experimentVariants: { intro: 'B' } });
    track('onboarding_assigned');
    setAnalyticsContext({ variantId: 'control' });
    mockAvailable.mockReturnValue(true);
    flushAnalytics();
    expect(sent()).toMatchObject({
      config_version: 'retention-v1', variant_id: 'B', experiment_variants: { intro: 'B' },
    });
  });

  it('purges unsent events and stops collection on opt-out', () => {
    mockAvailable.mockReturnValue(false);
    track('ad_impression', { format: 'rewarded' });
    expect(getString(stateKey)).not.toBeNull();
    useAnalyticsPrefs.getState().setOptOut(true);
    expect(getString(stateKey)).toBeNull();
    mockAvailable.mockReturnValue(true);
    track('app_open');
    flushAnalytics();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('migrates analytics.v1 preferences without replaying a legacy unfiltered queue', () => {
    jest.isolateModules(() => {
      const storage = require('@/core/storage') as typeof import('@/core/storage');
      storage.setJSON(KEYS.analytics, { optOut: true, queue: [{ word: 'кот' }] });
      const native = require('@/core/native/appmetrica') as typeof import('@/core/native/appmetrica');
      const reloaded = require('@/features/analytics') as typeof import('@/features/analytics');
      expect(reloaded.useAnalyticsPrefs.getState().optOut).toBe(true);
      expect(storage.getJSON(KEYS.analytics, null)).toEqual({ optOut: true });
      reloaded.track('app_open');
      expect(native.reportEvent).not.toHaveBeenCalled();
      expect(storage.getString(stateKey)).toBeNull();
    });
  });

  it('normalizes a restored queue so extra persisted fields cannot bypass privacy filtering', () => {
    jest.isolateModules(() => {
      const storage = require('@/core/storage') as typeof import('@/core/storage');
      storage.setJSON(stateKey, {
        version: 2, playerId: 'p_stable', sessionId: 's_stable', lastActivityAt: 0,
        dedupe: [], context: { variantId: 'control', experimentVariants: { intro: 'A', email: 'me@example.com' } },
        outbox: [{
          name: 'word_submitted',
          envelope: {
            event_id: 'e_stable', schema_version: 2, occurred_at: '2026-09-26T10:00:00.000Z',
            session_id: 's_stable', secret: 'кошка',
            experiment_variants: { intro: 'A', phone: '+71234567890' },
            properties: { len: 5, word: 'кошка', fingerPath: [[1, 2]] },
          },
        }],
      });
      const native = require('@/core/native/appmetrica') as typeof import('@/core/native/appmetrica');
      (native.isAppMetricaAvailable as jest.Mock).mockReturnValue(true);
      const reloaded = require('@/features/analytics') as typeof import('@/features/analytics');
      reloaded.flushAnalytics();
      const payload = (native.reportEvent as jest.Mock).mock.calls[0][1];
      expect(payload.properties).toEqual({ len: 5 });
      expect(payload.experiment_variants).toEqual({ intro: 'A' });
      expect(JSON.stringify(payload)).not.toMatch(/кошка|fingerPath|example\.com|\+71234567890/);
    });
  });
});
