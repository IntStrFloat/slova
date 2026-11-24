import { PermissionsAndroid, Platform } from 'react-native';
// eslint-disable-next-line import/no-unresolved
import Client, { eventEmitter } from 'react-native-rustore-push';
import { storage } from '@/core/storage';
import { useSettings } from '@/features/settings';
import { useLevels } from '@/features/levels/store';
import { track, trackOnce } from '@/features/analytics';
import { clearNotificationTaps, confirmNotificationTap, dispatchNotificationTap, startNotificationNavigationRuntime } from '../delivery';
import { RuStorePushProvider as provider } from '../rustorePush.native';

let mockOwner = 'scope-a';
const mockHandlers = new Map<string, (message: unknown) => void>();
jest.mock('../context', () => ({ notificationOwner: () => mockOwner, pushContentContext: () => ({
  nowMs: Date.now(), versionCode: 33, totalLevels: 1500, currentLevel: 600, unlockedRoutes: ['/', '/daily', '/wheel', '/events'],
}) }));
jest.mock('../config', () => ({ PUSH: { projectId: 'test-project', enabled: true } }));
jest.mock('@/features/analytics', () => ({ track: jest.fn(), trackOnce: jest.fn(() => 'event'),
  isAnalyticsCollectionEnabled: () => true, useAnalyticsPrefs: { getState: () => ({ optOut: false }) } }));
jest.mock('react-native-rustore-push', () => ({ __esModule: true, default: {
  setNotificationContext: jest.fn(), createPushEmitter: jest.fn(), deletePushEmitter: jest.fn(), offNativeErrorHandling: jest.fn(),
  getToken: jest.fn(async () => 'private-device-token'), deleteToken: jest.fn(async () => true),
  checkPushAvailability: jest.fn(async () => true), getInitialNotification: jest.fn(async () => null),
  subscribeToTopic: jest.fn(async () => true), unsubscribeFromTopic: jest.fn(async () => true),
}, eventEmitter: { addListener: jest.fn((event: string, callback: (raw: unknown) => void) => {
  mockHandlers.set(event, callback); return { remove: jest.fn(() => mockHandlers.delete(event)) };
}) }, PushEvents: { ON_OPENED: 'opened', ON_MESSAGE_RECEIVED: 'received', ON_NEW_TOKEN: 'token' } }));
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const message = { messageId: 'message-one', data: { route: '/daily', campaign_id: 'daily-reminder-v1' }, ownerScope: 'scope-a' };
beforeEach(async () => {
  storage.remove('daily.reminders.consent.v1');
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  Object.defineProperty(Platform, 'Version', { value: 35, configurable: true });
  mockOwner = 'scope-a'; await provider.unregister(); clearNotificationTaps(); jest.clearAllMocks(); mockHandlers.clear();
  useSettings.setState({ notifications: true }); useLevels.setState({ currentLevel: 500 });
  (Client.getToken as jest.Mock).mockResolvedValue('private-device-token');
  (Client.deleteToken as jest.Mock).mockResolvedValue(true);
  (Client.subscribeToTopic as jest.Mock).mockResolvedValue(true);
  (Client.checkPushAvailability as jest.Mock).mockResolvedValue(true);
  (Client.getInitialNotification as jest.Mock).mockResolvedValue(null);
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
});
afterEach(() => { jest.restoreAllMocks(); });

test('initial+warm duplicate and runtime recreation preserve one visible navigation and one open', async () => {
  (Client.getInitialNotification as jest.Mock).mockResolvedValue(message);
  const wake = jest.fn(), navigate = jest.fn(), stop = provider.onNotificationTap(wake);
  await flush(); mockHandlers.get('opened')!(message); expect(wake).toHaveBeenCalledTimes(1);
  dispatchNotificationTap({ owner: mockOwner, ready: false, active: true, safe: true }, navigate);
  expect(navigate).not.toHaveBeenCalled();
  dispatchNotificationTap({ owner: mockOwner, ready: true, active: true, safe: true }, navigate);
  expect(navigate).toHaveBeenCalledWith('/daily'); confirmNotificationTap('/daily', mockOwner);
  stop(); startNotificationNavigationRuntime();
  const next = provider.onNotificationTap(wake); await flush();
  expect(wake).toHaveBeenCalledTimes(1); expect(navigate).toHaveBeenCalledTimes(1);
  expect((trackOnce as jest.Mock).mock.calls.filter((call) => call[0] === 'push_lifecycle')).toHaveLength(1);
  next();
});
test('late initial callback, opt-out and a different profile never navigate or reset attribution', async () => {
  let resolve!: (raw: unknown) => void;
  (Client.getInitialNotification as jest.Mock).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const wake = jest.fn(), stop = provider.onNotificationTap(wake); stop(); resolve(message); await flush();
  expect(wake).not.toHaveBeenCalled();
  const next = provider.onNotificationTap(wake); await flush();
  mockHandlers.get('opened')!({ ...message, ownerScope: 'foreign' }); expect(wake).not.toHaveBeenCalled();
  useSettings.setState({ notifications: false }); mockHandlers.get('opened')!(message); expect(wake).not.toHaveBeenCalled(); next();
});
test('a delayed token after opt-out cannot subscribe; deletion waits behind in-flight work', async () => {
  let resolve!: (value: string) => void;
  (Client.getToken as jest.Mock).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const sync = provider.syncLevelExpansionAudience(500, true); await flush();
  const cancel = provider.unregister(); resolve('private-late-token'); await Promise.all([sync, cancel]);
  expect(Client.subscribeToTopic).not.toHaveBeenCalled(); expect(Client.deleteToken).toHaveBeenCalledTimes(1);
});
test('profile switch resets the token and topic binding; rotation refreshes only the current owner', async () => {
  await provider.syncLevelExpansionAudience(500, true);
  mockOwner = 'scope-b'; await provider.syncLevelExpansionAudience(500, true);
  expect(Client.deleteToken).toHaveBeenCalledTimes(1); expect(Client.subscribeToTopic).toHaveBeenCalledTimes(2);
  const stop = provider.onNotificationTap(jest.fn()); await flush(); mockHandlers.get('token')!({ token: 'private-rotated-token' }); await flush();
  expect(Client.subscribeToTopic).toHaveBeenCalledTimes(3); stop();
  expect(JSON.stringify((track as jest.Mock).mock.calls)).not.toContain('private-');
});
test('OS permission grant and transport registration failure have different results', async () => {
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  (Client.checkPushAvailability as jest.Mock).mockResolvedValue(false);
  expect(await provider.requestPermission()).toBe('registration_failed');
  expect(track).toHaveBeenCalledWith('notification_permission_result', expect.objectContaining({ result: 'granted' }));
  expect(Client.getToken).not.toHaveBeenCalled();
});
test('refusal starts no emitter or token API, and duplicate/corrupt queued data is not a new route', async () => {
  useSettings.setState({ notifications: false }); await provider.init(); provider.onNotificationTap(jest.fn())();
  expect(Client.createPushEmitter).not.toHaveBeenCalled(); expect(Client.getToken).not.toHaveBeenCalled();
  expect(eventEmitter.addListener).not.toHaveBeenCalled();
  storage.set('notifications.routes.v2', '{broken'); expect(dispatchNotificationTap({ owner: mockOwner, ready: true, active: true, safe: true }, jest.fn())).toBe(false);
});
test('an old binary without the new scoped bridge stays unavailable without SDK side effects', async () => {
  const method = Client.setNotificationContext;
  Client.setNotificationContext = undefined;
  try {
    await provider.init(); await provider.syncLevelExpansionAudience(500, true);
    expect(await provider.requestPermission()).toBe('unavailable');
    provider.onNotificationTap(jest.fn())();
    expect(Client.getToken).not.toHaveBeenCalled(); expect(Client.createPushEmitter).not.toHaveBeenCalled();
  } finally { Client.setNotificationContext = method; }
});
test('persisted refusal wins over a stale checked setting after an interrupted opt-out', async () => {
  storage.set('daily.reminders.consent.v1', JSON.stringify({ version: 1, optedIn: false }));
  await provider.init(); await provider.syncLevelExpansionAudience(500, true); provider.onNotificationTap(jest.fn())();
  expect(Client.getToken).not.toHaveBeenCalled(); expect(Client.createPushEmitter).not.toHaveBeenCalled();
});
test('late SDK subscription completion cannot resurrect a token after public timeout and opt-out', async () => {
  jest.useFakeTimers();
  let finish!: () => void, subscribed = false;
  (Client.subscribeToTopic as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => {
    finish = () => { subscribed = true; resolve(true); };
  }));
  (Client.deleteToken as jest.Mock).mockImplementation(async () => { subscribed = false; return true; });
  try {
    const registering = provider.syncLevelExpansionAudience(500, true).catch(() => {}); await flush();
    await jest.advanceTimersByTimeAsync(3001); await registering;
    const cancelling = provider.unregister(); await jest.advanceTimersByTimeAsync(3001); await cancelling;
    finish(); await flush();
    expect(subscribed).toBe(false);
    expect(Client.deleteToken).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});
