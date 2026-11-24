import { Platform } from 'react-native';
import { removeKey, setJSON, storage } from '@/core/storage';
import { getAnalyticsConsentEpoch, trackOnce, useAnalyticsPrefs } from '@/features/analytics';
import RemindersModule from '../../../../modules/reminders/src/RemindersModule';
import { drainDailyReminderTelemetry, getReminderGameplayAttribution, trackReminderGameplay } from '../reminderTelemetry';
import { useSettings } from '@/features/settings';
import { clearNotificationTaps, confirmNotificationTap, dispatchNotificationTap, hasPendingNotificationTap } from '../delivery';
import { notificationOwner } from '../context';

jest.mock('@/features/analytics', () => ({
  isAnalyticsCollectionEnabled: jest.fn(() => true),
  getAnalyticsConsentEpoch: jest.fn(),
  trackOnce: jest.fn(() => 'accepted'),
  useAnalyticsPrefs: { getState: jest.fn(() => ({ optOut: false })) },
}));
jest.mock('../../../../modules/reminders/src/RemindersModule', () => ({
  __esModule: true,
  default: { readTelemetry: jest.fn(), acknowledgeTelemetry: jest.fn() },
}));

const native = RemindersModule!;
const at = new Date('2026-10-04T15:05:00.000Z').getTime();
const reminderId = 'daily_2026-10-04_1791126000000';
const event = (kind: 'scheduled' | 'delivered' | 'opened') => ({
  reminderId, eventId: `${reminderId}:${kind}`, kind, dateKey: '2026-10-04',
  occurredAtMs: at, fireAtMs: at - 300000,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearNotificationTaps(); useSettings.setState({ notifications: false });
  removeKey('daily.reminders.telemetry-ack.v1');
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: false });
  (getAnalyticsConsentEpoch as jest.Mock).mockReturnValue(at - 1000);
  (trackOnce as jest.Mock).mockReturnValue('accepted');
  (native.readTelemetry as jest.Mock).mockReturnValue('[]');
});
afterEach(() => jest.restoreAllMocks());

test('reads schedule, actual delivery and tap independently, preserving correlation and occurrence', () => {
  const events = (['scheduled', 'delivered', 'opened'] as const).map(event);
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify(events));
  expect(drainDailyReminderTelemetry()).toBe(3);
  expect(trackOnce).toHaveBeenCalledWith('reminder_delivered', `${reminderId}:delivered`,
    expect.objectContaining({ promptId: reminderId, occurredAtMs: at }));
  expect(native.acknowledgeTelemetry).toHaveBeenCalledWith(JSON.stringify(events.map((item) => item.eventId)));
  // Native ack may have failed/crashed after JS journal persisted: retry without duplicate.
  expect(drainDailyReminderTelemetry()).toBe(3);
  expect(trackOnce).toHaveBeenCalledTimes(3);
});

test('does not acknowledge analytics rejection or failed MMKV persistence', () => {
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('delivered')]));
  (trackOnce as jest.Mock).mockReturnValue(null);
  expect(drainDailyReminderTelemetry()).toBe(0);
  expect(native.acknowledgeTelemetry).toHaveBeenLastCalledWith('[]');
  (native.acknowledgeTelemetry as jest.Mock).mockClear();
  (trackOnce as jest.Mock).mockReturnValue('accepted');
  const write = jest.spyOn(storage, 'set').mockImplementation(() => { throw new Error('disk'); });
  expect(drainDailyReminderTelemetry()).toBe(0);
  expect(native.acknowledgeTelemetry).not.toHaveBeenCalled();
  write.mockRestore();
});

test('attributes actual gameplay only for 30 minutes after a genuine tap', () => {
  const time = jest.spyOn(Date, 'now').mockReturnValue(at + 1000);
  useSettings.setState({ notifications: true });
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('opened')]));
  drainDailyReminderTelemetry();
  dispatchNotificationTap({ owner: notificationOwner(), ready: true, active: true, safe: true }, jest.fn());
  confirmNotificationTap('/daily', notificationOwner());
  expect(getReminderGameplayAttribution()).toEqual({ promptId: reminderId, dateKey: '2026-10-04', source: 'local_reminder' });
  trackReminderGameplay('word_submitted');
  expect(trackOnce).toHaveBeenCalledWith('reminder_gameplay', reminderId, expect.objectContaining({ action: 'word_submitted' }));
  expect(getReminderGameplayAttribution(at + 31 * 60 * 1000)).toEqual({});
  expect(getReminderGameplayAttribution(at - 1000)).toEqual({});
  time.mockRestore();
});

test('a queued local tap cannot attribute current-game actions before its destination is visible', () => {
  const time = jest.spyOn(Date, 'now').mockReturnValue(at + 1000);
  useSettings.setState({ notifications: true });
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('opened')]));
  drainDailyReminderTelemetry();
  expect(getReminderGameplayAttribution()).toEqual({});
  trackReminderGameplay('word_submitted');
  expect((trackOnce as jest.Mock).mock.calls.some((call) => call[0] === 'reminder_gameplay')).toBe(false);
  dispatchNotificationTap({ owner: notificationOwner(), ready: true, active: true, safe: true }, jest.fn());
  confirmNotificationTap('/daily', notificationOwner());
  trackReminderGameplay('word_submitted');
  expect(trackOnce).toHaveBeenCalledWith('reminder_gameplay', reminderId, expect.objectContaining({ source: 'local_reminder' }));
  time.mockRestore();
});

test('a failed first route write retains the native open until the routing retry is durable', () => {
  useSettings.setState({ notifications: true });
  let pending = [event('opened')];
  (native.readTelemetry as jest.Mock).mockImplementation(() => JSON.stringify(pending));
  (native.acknowledgeTelemetry as jest.Mock).mockImplementation((json: string) => {
    const ids = JSON.parse(json) as string[]; pending = pending.filter((item) => !ids.includes(item.eventId));
  });
  const original = storage.set.bind(storage);
  let first = true;
  const write = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === 'notifications.routes.v2' && first) { first = false; throw Error('first route write failed'); }
    original(key, value);
  });
  expect(drainDailyReminderTelemetry()).toBe(0); expect(pending).toHaveLength(1); expect(hasPendingNotificationTap()).toBe(false);
  write.mockRestore();
  expect(drainDailyReminderTelemetry()).toBe(1); expect(pending).toHaveLength(0); expect(hasPendingNotificationTap()).toBe(true);
});

test('a scheduled reminder alone cannot attribute gameplay, and corrupt events are ignored', () => {
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('scheduled'), { ...event('opened'), eventId: 'bad' }]));
  expect(getReminderGameplayAttribution(at)).toEqual({});
  expect(trackOnce).toHaveBeenCalledTimes(1);
});

test('analytics opt-out retires native events without analytics or attribution', () => {
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: true });
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('opened')]));
  expect(drainDailyReminderTelemetry()).toBe(1);
  expect(trackOnce).not.toHaveBeenCalled();
  expect(getReminderGameplayAttribution(at)).toEqual({});
});

test('a genuine local tap still routes safely when gameplay analytics is refused', () => {
  useSettings.setState({ notifications: true });
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: true });
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('opened')]));
  drainDailyReminderTelemetry();
  expect(hasPendingNotificationTap()).toBe(true);
  const navigate = jest.fn();
  dispatchNotificationTap({ owner: notificationOwner(), ready: false, active: true, safe: true }, navigate);
  expect(navigate).not.toHaveBeenCalled();
  dispatchNotificationTap({ owner: notificationOwner(), ready: true, active: true, safe: true }, navigate);
  expect(navigate).toHaveBeenCalledWith('/daily'); expect(trackOnce).not.toHaveBeenCalled();
});

test('an acknowledged visible local tap cannot revive after analytics refusal and a new consent epoch', () => {
  jest.spyOn(Date, 'now').mockReturnValue(at + 1000);
  useSettings.setState({ notifications: true });
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('opened')]));
  drainDailyReminderTelemetry();
  dispatchNotificationTap({ owner: notificationOwner(), ready: true, active: true, safe: true }, jest.fn());
  confirmNotificationTap('/daily', notificationOwner());
  expect(getReminderGameplayAttribution()).toEqual(expect.objectContaining({ promptId: reminderId }));
  (native.readTelemetry as jest.Mock).mockReturnValue('[]');
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: true });
  expect(getReminderGameplayAttribution()).toEqual({});
  (getAnalyticsConsentEpoch as jest.Mock).mockReturnValue(at + 500);
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: false });
  expect(getReminderGameplayAttribution()).toEqual({});
  (trackOnce as jest.Mock).mockClear();
  trackReminderGameplay('word_submitted');
  expect(trackOnce).not.toHaveBeenCalled();
});

test('legacy local attribution without a recorded consent binding fails closed', () => {
  jest.spyOn(Date, 'now').mockReturnValue(at + 1000);
  useSettings.setState({ notifications: true });
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('opened')]));
  drainDailyReminderTelemetry();
  dispatchNotificationTap({ owner: notificationOwner(), ready: true, active: true, safe: true }, jest.fn());
  confirmNotificationTap('/daily', notificationOwner());
  (native.readTelemetry as jest.Mock).mockReturnValue('[]');
  setJSON('daily.reminders.telemetry-ack.v1', { version: 1, acknowledged: [`${reminderId}:opened`],
    opened: { reminderId, dateKey: '2026-10-04', openedAtMs: at } });
  expect(getReminderGameplayAttribution()).toEqual({});
});

test('a delayed pre-consent native tap still routes but cannot start fresh attribution', () => {
  jest.spyOn(Date, 'now').mockReturnValue(at + 1000);
  useSettings.setState({ notifications: true });
  (getAnalyticsConsentEpoch as jest.Mock).mockReturnValue(at + 500);
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('opened')]));
  expect(drainDailyReminderTelemetry()).toBe(1);
  expect(hasPendingNotificationTap()).toBe(true);
  expect(native.acknowledgeTelemetry).toHaveBeenCalledWith(JSON.stringify([`${reminderId}:opened`]));
  expect(trackOnce).not.toHaveBeenCalled();
  dispatchNotificationTap({ owner: notificationOwner(), ready: true, active: true, safe: true }, jest.fn());
  confirmNotificationTap('/daily', notificationOwner());
  expect(getReminderGameplayAttribution()).toEqual({});
});

test('an explicitly recorded pre-epoch migration binding permits a new genuine local tap', () => {
  jest.spyOn(Date, 'now').mockReturnValue(at + 1000);
  useSettings.setState({ notifications: true });
  (getAnalyticsConsentEpoch as jest.Mock).mockReturnValue(null);
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('opened')]));
  drainDailyReminderTelemetry();
  dispatchNotificationTap({ owner: notificationOwner(), ready: true, active: true, safe: true }, jest.fn());
  confirmNotificationTap('/daily', notificationOwner());
  expect(getReminderGameplayAttribution()).toEqual(expect.objectContaining({ promptId: reminderId }));
});
