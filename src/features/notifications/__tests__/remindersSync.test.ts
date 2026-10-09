import { Platform } from 'react-native';

import RemindersModule from '../../../../modules/reminders/src/RemindersModule';
import { selectDailyContent, useDailyPuzzle } from '@/features/dailypuzzle';
import { useSettings } from '@/features/settings';
import { KEYS, removeKey, setJSON } from '@/core/storage';

import { cancelDailyReminderForDate, cancelDailyReminders, hasDailyReminderConsent, requestDailyReminderPermission, syncDailyReminders } from '../reminders';

jest.mock('../../../../modules/reminders/src/RemindersModule', () => ({
  __esModule: true,
  default: {
    permissionGranted: jest.fn(() => true),
    replaceSchedules: jest.fn(() => 1),
    cancelDate: jest.fn(),
    cancelAll: jest.fn(),
    sentHistory: jest.fn(() => '[]'),
    requestPermission: jest.fn(() => Promise.resolve('granted')),
    readTelemetry: jest.fn(() => '[]'),
    acknowledgeTelemetry: jest.fn(),
  },
}));
jest.mock('@/features/dailypuzzle', () => ({
  useDailyPuzzle: { getState: jest.fn(() => ({ solvedDates: ['2026-09-20', '2026-09-21'] })) },
  selectDailyContent: jest.fn(() => ({ puzzleId: 'verified' })),
}));
jest.mock('@/features/settings', () => ({
  useSettings: { getState: jest.fn(() => ({ notifications: true })) },
}));

const native = RemindersModule!;
const date = new Date(2026, 8, 26, 11, 0);

beforeEach(() => {
  jest.clearAllMocks();
  removeKey('daily.reminders.consent.v1');
  removeKey(KEYS.pushPrompt);
  // Old explicitly allowed profiles migrate without changing their existing schedule.
  setJSON(KEYS.pushPrompt, { schemaVersion: 1, handled: true, outcome: 'allowed' });
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  (native.permissionGranted as jest.Mock).mockReturnValue(true);
  (native.replaceSchedules as jest.Mock).mockImplementation((raw: string) => JSON.parse(raw).length);
  (native.sentHistory as jest.Mock).mockReturnValue('[]');
  (selectDailyContent as jest.Mock).mockReturnValue({ puzzleId: 'verified' });
  (useDailyPuzzle.getState as jest.Mock).mockReturnValue({ solvedDates: ['2026-09-20', '2026-09-21'] });
  (useSettings.getState as jest.Mock).mockReturnValue({ notifications: true });
});

test('schedules only verified local content after opt-in', async () => {
  const result = await syncDailyReminders(date);
  expect(result.scheduled).toBeGreaterThan(0);
  expect(native.replaceSchedules).toHaveBeenCalledTimes(1);
  const scheduled = JSON.parse((native.replaceSchedules as jest.Mock).mock.calls[0][0]);
  expect(scheduled.length).toBeLessThanOrEqual(3);
  expect(selectDailyContent).toHaveBeenCalled();
  expect(native.cancelAll).not.toHaveBeenCalled();
});

test('setting off or revoked permission cancels pending alarms, zero daily wins do not', async () => {
  (useSettings.getState as jest.Mock).mockReturnValueOnce({ notifications: false });
  await syncDailyReminders(date);
  (useDailyPuzzle.getState as jest.Mock).mockReturnValueOnce({ solvedDates: [] });
  await syncDailyReminders(date);
  (native.permissionGranted as jest.Mock).mockReturnValueOnce(false);
  await syncDailyReminders(date);
  expect(native.cancelAll).toHaveBeenCalledTimes(2);
  expect(native.replaceSchedules).toHaveBeenCalledTimes(1);
});

test('a checked setting and OS permission alone never create opt-in', async () => {
  removeKey(KEYS.pushPrompt);
  expect(hasDailyReminderConsent()).toBe(false);
  expect(await syncDailyReminders(date)).toEqual({ scheduled: 0, reason: 'no_consent' });
  expect(native.replaceSchedules).not.toHaveBeenCalled();
  expect(native.cancelAll).toHaveBeenCalled();
});

test('explicit permission acceptance persists consent; denied/dismissed do not', async () => {
  removeKey(KEYS.pushPrompt);
  (native.requestPermission as jest.Mock).mockResolvedValueOnce('denied');
  expect(await requestDailyReminderPermission('settings')).toBe('denied');
  expect(hasDailyReminderConsent()).toBe(false);
  (native.requestPermission as jest.Mock).mockResolvedValueOnce('dismissed');
  expect(await requestDailyReminderPermission('home')).toBe('dismissed');
  expect(hasDailyReminderConsent()).toBe(false);
  (native.requestPermission as jest.Mock).mockResolvedValueOnce('granted');
  expect(await requestDailyReminderPermission('home')).toBe('granted');
  expect(hasDailyReminderConsent()).toBe(true);
});

test('a new same-profile opt-in plans tomorrow and day two, never today, and survives resync', async () => {
  jest.useFakeTimers().setSystemTime(date);
  removeKey(KEYS.pushPrompt);
  try {
    await requestDailyReminderPermission('home');
    (useDailyPuzzle.getState as jest.Mock).mockReturnValue({ solvedDates: [] });
    await syncDailyReminders(date);
    const plan = JSON.parse((native.replaceSchedules as jest.Mock).mock.calls[0][0]);
    expect(plan.map((item: { fireAtMs: number }) => new Date(item.fireAtMs).getDate())).toEqual([27, 28, 29]);
    await syncDailyReminders(date);
    expect((native.replaceSchedules as jest.Mock).mock.calls[1][0]).toBe(JSON.stringify(plan));
    expect(hasDailyReminderConsent()).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test('opt-out cannot be revived by a migrated old allowed outcome', async () => {
  expect(hasDailyReminderConsent()).toBe(true);
  await cancelDailyReminders();
  expect(hasDailyReminderConsent()).toBe(false);
  expect((await syncDailyReminders(date)).reason).toBe('no_consent');
});

test('missing verified content produces no scheduled notification', async () => {
  (selectDailyContent as jest.Mock).mockReturnValue(null);
  expect(await syncDailyReminders(date)).toEqual({ scheduled: 0, reason: 'no_verified_unsolved_date' });
  expect(native.replaceSchedules).toHaveBeenCalledWith('[]');
});

test('daily completion and explicit settings opt-out cancel native alarms', async () => {
  await cancelDailyReminderForDate('2026-09-26');
  await cancelDailyReminders();
  expect(native.cancelDate).toHaveBeenCalledWith('2026-09-26');
  expect(native.cancelAll).toHaveBeenCalledTimes(1);
});
