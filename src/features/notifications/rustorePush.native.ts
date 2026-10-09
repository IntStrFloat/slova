import { PermissionsAndroid, Platform } from 'react-native';
// eslint-disable-next-line import/no-unresolved -- GitFlic package is typed by the local shim.
import RustorePushClient, { eventEmitter, PushEvents } from 'react-native-rustore-push';
import type { RemoteMessage } from 'react-native-rustore-push';

import { PUSH } from './config';
import { isLevelExpansionAudience, LEVEL_EXPANSION_CAMPAIGN } from './levelExpansionCampaign';
import { resolvePushRoute } from './routing';
import type { PushPermissionResult, PushProvider } from './types';

let emitterReady = false;
let tokenOperations = Promise.resolve();
let audienceRegistration: string | undefined;

/** A pending subscription must finish before an opt-out deletes its token. */
function enqueueTokenOperation(operation: () => Promise<void>): Promise<void> {
  const result = tokenOperations.then(operation);
  tokenOperations = result.catch(() => {});
  return result;
}

async function deleteToken(): Promise<void> {
  audienceRegistration = undefined;
  ensureEmitter();
  if (!await RustorePushClient.deleteToken()) throw new Error('Token deletion was not accepted');
}

function reportPushError(stage: string, error: unknown): void {
  console.warn(`[push] RuStore ${stage} failed`, error);
}

function ensureEmitter(): void {
  if (emitterReady) return;
  RustorePushClient.createPushEmitter();
  emitterReady = true;
}

function routeFromMessage(message: RemoteMessage | null): string {
  if (!message) return resolvePushRoute(undefined);
  const route =
    message.notification?.clickActionType === 'DEEP_LINK'
      ? message.notification.clickAction
      : message.data?.key === 'route'
        ? message.data.value
        : undefined;
  return resolvePushRoute({ route });
}

async function init(): Promise<void> {
  if (!PUSH.projectId) return;
  try {
    ensureEmitter();
  } catch (error) {
    reportPushError('init', error);
  }
}

async function requestPermission(): Promise<PushPermissionResult> {
  if (Platform.OS !== 'android') return 'unavailable';
  if (typeof Platform.Version === 'number' && Platform.Version < 33) return 'granted';
  try {
    const status = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (status !== PermissionsAndroid.RESULTS.GRANTED) return 'denied';
    await enqueueTokenOperation(async () => {
      ensureEmitter();
      await RustorePushClient.getToken();
    });
    return 'granted';
  } catch (error) {
    reportPushError('permission', error);
    return 'denied';
  }
}

async function unregister(): Promise<void> {
  try {
    await enqueueTokenOperation(deleteToken);
  } catch (error) {
    reportPushError('unregister', error);
  }
}

async function syncLevelExpansionAudience(currentLevel: number, notifications: boolean): Promise<void> {
  if (Platform.OS !== 'android' || !PUSH.projectId) return;
  // A first launch or a player who declined notifications must not call the
  // RuStore SDK; availability/token APIs can surface an install prompt.
  if (!notifications) return;
  return enqueueTokenOperation(async () => {
    const permissionGranted = notifications && (
      typeof Platform.Version === 'number' && Platform.Version < 33
      || await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
    );
    if (!permissionGranted) {
      return;
    }
    ensureEmitter();
    const token = await RustorePushClient.getToken();
    if (!token) throw new Error('RuStore returned an empty token');
    const eligible = isLevelExpansionAudience(currentLevel, notifications);
    const registration = `${token}:${eligible}`;
    if (audienceRegistration === registration) return;
    const accepted = eligible
      ? await RustorePushClient.subscribeToTopic(LEVEL_EXPANSION_CAMPAIGN.topic)
      : await RustorePushClient.unsubscribeFromTopic(LEVEL_EXPANSION_CAMPAIGN.topic);
    if (!accepted) throw new Error('RuStore did not accept campaign audience update');
    audienceRegistration = registration;
  });
}

function onNotificationTap(handler: (route: string) => void): () => void {
  try {
    ensureEmitter();
    const subscription = eventEmitter.addListener(PushEvents.ON_OPENED, (message: RemoteMessage) => {
      handler(routeFromMessage(message));
    });
    void RustorePushClient.getInitialNotification()
      .then((message) => {
        if (message) handler(routeFromMessage(message));
      })
      .catch((error) => reportPushError('getInitialNotification', error));
    return () => subscription.remove();
  } catch (error) {
    reportPushError('tap subscription', error);
    return () => {};
  }
}

export const RuStorePushProvider: PushProvider = {
  init,
  requestPermission,
  unregister,
  syncLevelExpansionAudience,
  onNotificationTap,
};
