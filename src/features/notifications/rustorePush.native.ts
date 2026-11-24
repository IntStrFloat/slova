import { PermissionsAndroid, Platform } from 'react-native';
// eslint-disable-next-line import/no-unresolved -- Installed GitFlic wrapper has the audited local shim.
import RustorePushClient, { eventEmitter, PushEvents } from 'react-native-rustore-push';
import { track } from '@/features/analytics';
import { useSettings } from '@/features/settings';
import { useLevels } from '@/features/levels/store';
import { getJSON, removeKey, setJSON } from '@/core/storage';
import { PUSH } from './config';
import { notificationOwner, pushContentContext } from './context';
import { isLevelExpansionAudience, LEVEL_EXPANSION_CAMPAIGN } from './levelExpansionCampaign';
import { acceptNotificationTap, clearNotificationTaps } from './delivery';
import { beginRemoteReturn, clearRemoteReturn, recordPushLifecycle } from './analytics';
import { parsePushMessage } from './payload';
import type { PushPermissionResult, PushProvider } from './types';

const REMOVAL_KEY = 'notifications.unregister-pending.v1';
const refused = () => getJSON<{ optedIn?: boolean } | null>('daily.reminders.consent.v1', null)?.optedIn === false;
let emitterReady = false, consented = useSettings.getState().notifications && !refused(), generation = 0, owner = notificationOwner();
let audienceRegistration: string | undefined;
let needsTokenReset = getJSON<{ pending?: boolean }>(REMOVAL_KEY, {}).pending === true;
let operations = Promise.resolve();
let removal: Promise<void> | null = null;
const compatibleBridge = () => typeof RustorePushClient?.setNotificationContext === 'function';
const PUBLIC_TIMEOUT = Symbol('push public deadline');
const report = (result: string, reason: string, operation = 'audience') => {
  try { track('push_registration_result', { provider: 'rustore', result, reason, operation }); } catch { /* Optional telemetry. */ }
};
const permissionResult = (result: string, reason?: string) => {
  try { track('notification_permission_result', { provider: 'rustore', result, ...(reason ? { reason } : {}) }); } catch { /* OS outcome is authoritative. */ }
};
function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(PUBLIC_TIMEOUT), 3000); })])
    .finally(() => { if (timer) clearTimeout(timer); });
}
function enqueue(operation: () => Promise<void>): Promise<void> {
  const pending = operations.then(operation); operations = pending.catch(() => {}); return pending;
}
function configure(enabled: boolean, nextOwner = notificationOwner()): number {
  enabled = enabled && !refused();
  if (enabled && !consented) { clearNotificationTaps(); clearRemoteReturn(); }
  if (!enabled) { clearNotificationTaps(); clearRemoteReturn(); }
  if (owner !== nextOwner || consented !== enabled) {
    if (owner !== nextOwner) needsTokenReset = true;
    generation++; audienceRegistration = undefined;
    if (owner !== nextOwner || !enabled) { clearNotificationTaps(); clearRemoteReturn(); }
    owner = nextOwner; consented = enabled;
  }
  // App-private consent/scope only; this bridge operation does not invoke the SDK.
  RustorePushClient?.setNotificationContext?.(enabled, owner);
  return generation;
}
function ensureEmitter(): void {
  if (!consented || emitterReady) return;
  RustorePushClient.offNativeErrorHandling?.();
  RustorePushClient.createPushEmitter(); emitterReady = true;
}
const valid = (epoch: number) => consented && epoch === generation && !refused() && owner === notificationOwner();
async function removeToken(): Promise<void> {
  audienceRegistration = undefined;
  if (!await RustorePushClient.deleteToken()) throw Error('token_delete_failed');
  needsTokenReset = false;
}
async function init(): Promise<void> {
  if (!PUSH.projectId || !PUSH.enabled || !compatibleBridge()) return;
  configure(useSettings.getState().notifications);
  try { ensureEmitter(); } catch { report('unavailable', 'emitter_unavailable', 'init'); }
}
async function requestPermission(): Promise<PushPermissionResult> {
  if (Platform.OS !== 'android' || !PUSH.projectId || !PUSH.enabled || !compatibleBridge()) return 'unavailable';
  try {
    const granted = typeof Platform.Version === 'number' && Platform.Version < 33
      || await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) === PermissionsAndroid.RESULTS.GRANTED;
    permissionResult(granted ? 'granted' : 'denied');
    if (!granted) { if (consented) await unregister(); else configure(false); return 'denied'; }
    configure(true);
    try { await syncLevelExpansionAudience(useLevels.getState().currentLevel, true); return audienceRegistration ? 'granted' : 'registration_failed'; }
    catch (error) { return error instanceof Error && error.message === 'push_registration_pending' ? 'registration_pending' : 'registration_failed'; }
  } catch {
    permissionResult('unavailable', 'permission_api');
    return 'unavailable';
  }
}
async function unregister(): Promise<void> {
  configure(false);
  try { RustorePushClient.deletePushEmitter?.(); } catch { /* Cleanup never opens UI. */ }
  emitterReady = false;
  if (removal) { await bounded(removal).catch(() => {}); return; }
  setJSON(REMOVAL_KEY, { pending: true });
  // A killed process retries only this deletion, never a fresh token registration after refusal.
  removal = enqueue(removeToken).then(() => {
    removeKey(REMOVAL_KEY); report('removed', 'opt_out', 'unregister');
  }).catch(() => { needsTokenReset = true; report('retryable', 'token_delete_failed', 'unregister'); })
    .finally(() => { removal = null; });
  await bounded(removal).catch(() => report('pending', 'deletion_in_flight', 'unregister'));
}
async function syncLevelExpansionAudience(currentLevel: number, notifications: boolean): Promise<void> {
  if (Platform.OS !== 'android' || !PUSH.projectId || !PUSH.enabled || !compatibleBridge()) return;
  notifications = notifications && !refused();
  const previouslyEnabled = consented;
  const epoch = configure(notifications);
  if (!notifications) {
    if (previouslyEnabled || getJSON<{ pending?: boolean }>(REMOVAL_KEY, {}).pending) await unregister();
    return;
  }
  const actual = enqueue(async () => {
    if (!valid(epoch)) return;
    const permission = typeof Platform.Version === 'number' && Platform.Version < 33
      || await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (!valid(epoch) || !permission) {
      if (!permission) { audienceRegistration = undefined; report('unavailable', 'permission_revoked'); }
      return;
    }
      ensureEmitter();
      if (needsTokenReset) await removeToken();
      if (!valid(epoch)) return;
      if (await RustorePushClient.checkPushAvailability() !== true) throw Error('transport_unavailable');
      if (!valid(epoch)) return;
      const token = await RustorePushClient.getToken();
      if (!valid(epoch)) return;
      if (!token) throw Error('empty_token');
      const eligible = isLevelExpansionAudience(currentLevel, true) && pushContentContext().totalLevels >= 1000;
      const registration = owner + ':' + token + ':' + eligible; // Private memory only.
      if (audienceRegistration === registration) return;
      const accepted = await (eligible ? RustorePushClient.subscribeToTopic(LEVEL_EXPANSION_CAMPAIGN.topic)
        : RustorePushClient.unsubscribeFromTopic(LEVEL_EXPANSION_CAMPAIGN.topic));
      if (!valid(epoch)) return;
      if (!accepted) throw Error('topic_rejected');
      audienceRegistration = registration; report('ready', eligible ? 'subscribed' : 'unsubscribed');
  }).catch((error) => { report('retryable', 'registration_failed'); throw error; });
  // A public deadline never releases the actual operation queue or cancels the underlying SDK task.
  return bounded(actual).catch((error) => {
    if (error === PUBLIC_TIMEOUT) report('pending', 'operation_in_flight');
    throw Error(error === PUBLIC_TIMEOUT ? 'push_registration_pending' : 'push_registration_failed');
  });
}
function onNotificationTap(handler: (route: string) => void): () => void {
  let active = true;
  if (!PUSH.projectId || !PUSH.enabled || !compatibleBridge() || refused() || !useSettings.getState().notifications) return () => { active = false; };
  const epoch = configure(true), capturedOwner = owner;
  try {
    ensureEmitter();
    const live = () => active && valid(epoch) && !refused() && useSettings.getState().notifications && capturedOwner === notificationOwner();
    const owns = (raw: unknown) => !raw || typeof raw !== 'object'
      || (raw as { ownerScope?: unknown }).ownerScope === undefined || (raw as { ownerScope?: unknown }).ownerScope === capturedOwner;
    const parse = (raw: unknown) => parsePushMessage(raw, pushContentContext());
    const handleTap = (raw: unknown) => {
      if (!live()) return;
      if (!owns(raw)) return;
      const message = parse(raw);
      if (!acceptNotificationTap(message, capturedOwner)) return;
      recordPushLifecycle('opened', message.id, message.campaignId);
      beginRemoteReturn(message, capturedOwner, message.openedAtMs ?? Date.now());
      try { handler(message.route); } catch { report('retryable', 'navigation_not_ready', 'open'); }
    };
    const opened = eventEmitter.addListener(PushEvents.ON_OPENED, handleTap);
    const received = eventEmitter.addListener(PushEvents.ON_MESSAGE_RECEIVED, (raw) => {
      if (!live() || !owns(raw)) return;
      const message = parse(raw); recordPushLifecycle('received', message.id, message.campaignId);
    });
    const rotated = eventEmitter.addListener(PushEvents.ON_NEW_TOKEN, () => {
      if (!live()) return;
      audienceRegistration = undefined;
      void syncLevelExpansionAudience(useLevels.getState().currentLevel, true).catch(() => {});
    });
    void bounded(RustorePushClient.getInitialNotification()).then((raw) => { if (raw) handleTap(raw); })
      .catch(() => { if (live()) report('unavailable', 'initial_unavailable', 'open'); });
    return () => { active = false; opened.remove(); received.remove(); rotated.remove(); };
  } catch { report('unavailable', 'emitter_unavailable', 'open'); return () => { active = false; }; }
}
export const RuStorePushProvider: PushProvider = { init, requestPermission, unregister, syncLevelExpansionAudience, onNotificationTap };
