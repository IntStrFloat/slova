import { removeKey, setJSON } from '@/core/storage';
import { trackOnce, useAnalyticsPrefs } from '@/features/analytics';
import { beginNotificationRoute, beginRemoteReturn, confirmNotificationRoute, getRemoteReturn } from '../analytics';
import { getReminderGameplayAttribution, trackReminderGameplay } from '../reminderTelemetry';
import { parsePushMessage } from '../payload';
import { acceptNotificationTap, clearNotificationTaps, confirmNotificationTap, dispatchNotificationTap } from '../delivery';
let mockEpoch: number | null = null;
let mockOwner = 'owner';
jest.mock('../context', () => ({ notificationOwner: () => mockOwner }));
jest.mock('@/features/analytics', () => ({
  trackOnce: jest.fn(() => 'event'), isAnalyticsCollectionEnabled: () => true,
  getAnalyticsConsentEpoch: () => mockEpoch,
  useAnalyticsPrefs: { getState: jest.fn(() => ({ optOut: false })) },
}));
jest.mock('../../../../modules/reminders/src/RemindersModule', () => ({ __esModule: true,
  default: { readTelemetry: () => '[]', acknowledgeTelemetry: jest.fn() } }));
const at = 1_800_000_000_000;
const message = parsePushMessage({ messageId: 'push-return', data: { route: '/daily', campaign_id: 'daily-reminder-v1' } },
  { nowMs: at, versionCode: 33, totalLevels: 1500, currentLevel: 500, unlockedRoutes: ['/daily'] });
beforeEach(() => {
  for (const key of ['notifications.remote-return.v1', 'notifications.route-analytics.v1', 'daily.reminders.telemetry-ack.v1']) removeKey(key);
  jest.clearAllMocks(); mockEpoch = null; mockOwner = 'owner';
  clearNotificationTaps();
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: false });
  jest.spyOn(Date, 'now').mockReturnValue(at);
});
afterEach(() => jest.restoreAllMocks());
test('open alone cannot claim meaningful return; visible content followed by gameplay can', () => {
  beginRemoteReturn(message, mockOwner, at); beginNotificationRoute('/daily', message.id, 'rustore');
  expect(getReminderGameplayAttribution(at)).toEqual({});
  confirmNotificationRoute('/'); expect(getReminderGameplayAttribution(at)).toEqual({});
  confirmNotificationRoute('/daily');
  expect(getReminderGameplayAttribution(at)).toEqual({});
  acceptNotificationTap(message, mockOwner, at);
  dispatchNotificationTap({ owner: mockOwner, ready: true, active: true, safe: true, nowMs: at }, jest.fn());
  confirmNotificationTap('/daily', mockOwner, at);
  expect(getReminderGameplayAttribution(at)).toEqual({ promptId: message.id, source: 'remote', campaign_id: 'daily-reminder-v1' });
  trackReminderGameplay('word_submitted');
  expect(trackOnce).toHaveBeenCalledWith('notification_meaningful_return', message.id,
    expect.objectContaining({ channel: 'remote', provider: 'rustore', action: 'word_submitted' }));
});
test('the inclusive30minute edge, backwards clock and opt-out epoch are enforced', () => {
  beginRemoteReturn(message, mockOwner, at); beginNotificationRoute('/daily', message.id, 'rustore'); confirmNotificationRoute('/daily');
  acceptNotificationTap(message, mockOwner, at);
  dispatchNotificationTap({ owner: mockOwner, ready: true, active: true, safe: true, nowMs: at }, jest.fn());
  confirmNotificationTap('/daily', mockOwner, at);
  expect(getRemoteReturn(at + 30 * 60_000)?.valid).toBe(true);
  expect(getRemoteReturn(at + 30 * 60_000 + 1)?.valid).toBe(false);
  expect(getRemoteReturn(at - 1)?.valid).toBe(false);
  mockEpoch = at + 1; expect(getRemoteReturn(at + 2)).toBeNull();
});
test('another profile or analytics refusal clears the return instead of transferring it', () => {
  beginRemoteReturn(message, mockOwner, at); mockOwner = 'other'; expect(getRemoteReturn(at)).toBeNull();
  mockOwner = 'owner'; expect(getRemoteReturn(at)).toBeNull();
  beginRemoteReturn(message, mockOwner, at);
  (useAnalyticsPrefs.getState as jest.Mock).mockReturnValue({ optOut: true }); expect(getRemoteReturn(at)).toBeNull();
});

test('a delayed pre-consent remote tap can route but cannot start attribution in the new epoch', () => {
  mockEpoch = at + 500;
  jest.spyOn(Date, 'now').mockReturnValue(at + 1000);
  beginRemoteReturn(message, mockOwner, at);
  acceptNotificationTap(message, mockOwner, at + 1000);
  const navigate = jest.fn();
  dispatchNotificationTap({ owner: mockOwner, ready: true, active: true, safe: true, nowMs: at + 1000 }, navigate);
  confirmNotificationTap('/daily', mockOwner, at + 1000);
  expect(navigate).toHaveBeenCalledWith('/daily');
  expect(getRemoteReturn(at + 1000)).toBeNull();
  expect(getReminderGameplayAttribution(at + 1000)).toEqual({});
  (trackOnce as jest.Mock).mockClear();
  trackReminderGameplay('word_submitted');
  expect(trackOnce).not.toHaveBeenCalled();
});

test('a saved remote record cannot bind a pre-consent occurrence to the current epoch', () => {
  mockEpoch = at + 500;
  setJSON('notifications.remote-return.v1', { id: message.id, campaignId: message.campaignId,
    owner: mockOwner, openedAtMs: at, consentEpoch: mockEpoch });
  expect(getRemoteReturn(at + 1000)).toBeNull();
});
