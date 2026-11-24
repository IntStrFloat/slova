import { PermissionsAndroid } from 'react-native';
// eslint-disable-next-line import/no-unresolved -- GitFlic SDK has a local type shim.
import RustorePushClient from 'react-native-rustore-push';

import { LEVEL_EXPANSION_CAMPAIGN } from '../levelExpansionCampaign';
import { RuStorePushProvider } from '../rustorePush.native';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  Object.defineProperty(actual.Platform, 'OS', { value: 'android', configurable: true });
  Object.defineProperty(actual.Platform, 'Version', { value: 35, configurable: true });
  return actual;
});
jest.mock('../config', () => ({ PUSH: { projectId: 'test-project', enabled: true, testMode: false } }));

const subscribe = jest.fn<Promise<boolean>, [string]>();
const unsubscribe = jest.fn<Promise<boolean>, [string]>();
Object.assign(RustorePushClient, { subscribeToTopic: subscribe, unsubscribeFromTopic: unsubscribe, setNotificationContext: jest.fn() });
const getToken = RustorePushClient.getToken as jest.Mock;
const deleteToken = RustorePushClient.deleteToken as jest.Mock;
const check = jest.spyOn(PermissionsAndroid, 'check');
const request = jest.spyOn(PermissionsAndroid, 'request');

beforeEach(async () => {
  deleteToken.mockResolvedValue(true);
  await RuStorePushProvider.unregister();
  jest.clearAllMocks();
  getToken.mockResolvedValue('test-token');
  (RustorePushClient.checkPushAvailability as jest.Mock).mockResolvedValue(true);
  subscribe.mockResolvedValue(true);
  unsubscribe.mockResolvedValue(true);
  check.mockResolvedValue(true);
});

it('subscribes once per token and re-registers after token rotation', async () => {
  await RuStorePushProvider.syncLevelExpansionAudience(500, true);
  await RuStorePushProvider.syncLevelExpansionAudience(501, true);
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledWith(LEVEL_EXPANSION_CAMPAIGN.topic);
  getToken.mockResolvedValue('rotated-token');
  await RuStorePushProvider.syncLevelExpansionAudience(501, true);
  expect(subscribe).toHaveBeenCalledTimes(2);
  expect(request).not.toHaveBeenCalled();
});

it('removes the topic after finishing level 1000 or resetting progress', async () => {
  await RuStorePushProvider.syncLevelExpansionAudience(500, true);
  await RuStorePushProvider.syncLevelExpansionAudience(1001, true);
  expect(unsubscribe).toHaveBeenCalledWith(LEVEL_EXPANSION_CAMPAIGN.topic);
  await RuStorePushProvider.syncLevelExpansionAudience(500, true);
  await RuStorePushProvider.syncLevelExpansionAudience(1, true);
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});

it('does not create a token or ask permission after settings opt-out', async () => {
  await RuStorePushProvider.syncLevelExpansionAudience(500, false);
  expect(deleteToken).not.toHaveBeenCalled();
  expect(getToken).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it('respects revoked Android permission even when the app setting remains on', async () => {
  check.mockResolvedValue(false);
  await RuStorePushProvider.syncLevelExpansionAudience(500, true);
  expect(deleteToken).not.toHaveBeenCalled();
  expect(getToken).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
});

it('finishes a pending subscription before deleting the token on opt-out', async () => {
  let finishSubscription!: (value: boolean) => void;
  let reportStarted!: () => void;
  const started = new Promise<void>((resolve) => { reportStarted = resolve; });
  subscribe.mockImplementationOnce(() => {
    reportStarted();
    return new Promise((resolve) => { finishSubscription = resolve; });
  });
  const syncing = RuStorePushProvider.syncLevelExpansionAudience(500, true);
  await started;
  const optingOut = RuStorePushProvider.unregister();
  expect(deleteToken).not.toHaveBeenCalled();
  finishSubscription(true);
  await Promise.all([syncing, optingOut]);
  expect(deleteToken).toHaveBeenCalledTimes(1);
  await RuStorePushProvider.syncLevelExpansionAudience(500, true);
  expect(subscribe).toHaveBeenCalledTimes(2);
});

it('retries a failed audience update on the next sync', async () => {
  subscribe.mockRejectedValueOnce(new Error('offline'));
  await expect(RuStorePushProvider.syncLevelExpansionAudience(500, true)).rejects.toThrow('push_registration_failed');
  await RuStorePushProvider.syncLevelExpansionAudience(500, true);
  expect(subscribe).toHaveBeenCalledTimes(2);
});
