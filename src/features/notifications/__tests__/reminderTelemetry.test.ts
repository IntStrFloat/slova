import { Platform } from 'react-native';
import { removeKey, storage } from '@/core/storage';
import { trackOnce, useAnalyticsPrefs } from '@/features/analytics';
import RemindersModule from '../../../../modules/reminders/src/RemindersModule';
import { drainDailyReminderTelemetry, getReminderGameplayAttribution, trackReminderGameplay } from '../reminderTelemetry';

jest.mock('@/features/analytics', () => ({
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
  removeKey('daily.reminders.telemetry-ack.v1');
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: false });
  (trackOnce as jest.Mock).mockReturnValue('accepted');
  (native.readTelemetry as jest.Mock).mockReturnValue('[]');
});

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
  (native.readTelemetry as jest.Mock).mockReturnValue(JSON.stringify([event('opened')]));
  expect(getReminderGameplayAttribution()).toEqual({ promptId: reminderId, dateKey: '2026-10-04', source: 'local_reminder' });
  trackReminderGameplay('word_submitted');
  expect(trackOnce).toHaveBeenCalledWith('reminder_gameplay', reminderId, expect.objectContaining({ action: 'word_submitted' }));
  expect(getReminderGameplayAttribution(at + 31 * 60 * 1000)).toEqual({});
  expect(getReminderGameplayAttribution(at - 1000)).toEqual({});
  time.mockRestore();
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
