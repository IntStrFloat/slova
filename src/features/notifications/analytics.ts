import { getAnalyticsConsentEpoch, isAnalyticsCollectionEnabled, trackOnce, useAnalyticsPrefs } from '@/features/analytics';
import { screenFromPath, telemetryId } from '@/features/analytics/navigationTelemetry';
import { getJSON, removeKey, setJSON } from '@/core/storage';
import { notificationOwner } from './context';
import type { ParsedPush } from './payload';
import { wasNotificationTapVisible } from './delivery';

const KEY = 'notifications.route-analytics.v1';
const RETURN_KEY = 'notifications.remote-return.v1';
type RemoteReturn = { id: string; campaignId: string; owner: string; openedAtMs: number; consentEpoch: number | null };
const consentEpoch = () => typeof getAnalyticsConsentEpoch === 'function' ? getAnalyticsConsentEpoch() : null;
type PendingRoute = { open_id: string; promptId: string; provider: 'rustore' | 'local_reminder';
  destination: string; createdAt: number; targetReason?: string };

/** Provider IDs only. Message text, deep-link query strings and payload bodies are never sent. */
function messageKey(value?: string): string {
  if (!value) return telemetryId('uncorrelated');
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < value.length; i++) {
    a = Math.imul(a ^ value.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ value.charCodeAt(i);
  }
  return `push_${(a >>> 0).toString(16)}_${(b >>> 0).toString(16)}`;
}

export function recordPushLifecycle(stage: 'received' | 'opened', providerMessageId?: string, campaignId?: string): string {
  const id = providerMessageId && /^push_[a-f0-9]{1,8}_[a-f0-9]{1,8}$/.test(providerMessageId) ? providerMessageId : messageKey(providerMessageId);
  try {
    trackOnce('push_lifecycle', `${id}:${stage}`, {
      message_id_hash: id, stage, provider: 'rustore', binding_state: providerMessageId ? 'correlated' : 'unknown',
      ...(campaignId ? { campaign_id: campaignId } : {}),
    });
  } catch { /* Navigation does not depend on analytics persistence. */ }
  return id;
}

export function beginNotificationRoute(destination: string, promptId: string, provider: PendingRoute['provider'], openId = telemetryId('open'), targetReason = 'accepted'): void {
  if (useAnalyticsPrefs.getState().optOut || !isAnalyticsCollectionEnabled()) { removeKey(KEY); return; }
  const previous = getJSON<PendingRoute | null>(KEY, null);
  if (previous && previous.open_id !== openId) finish(previous, 'failed', 'superseded');
  setJSON(KEY, { open_id: openId, promptId, provider, destination: screenFromPath(destination), createdAt: Date.now(), targetReason });
}

function finish(pending: PendingRoute, result: 'success' | 'failed', reason: string) {
  trackOnce('notification_route_result', `${pending.open_id}:route`, {
    open_id: pending.open_id, prompt_id: pending.promptId, provider: pending.provider,
    destination: pending.destination, result, reason, launch_kind: 'notification', occurredAtMs: Date.now(),
  });
}

export function confirmNotificationRoute(pathname: string): void {
  const pending = getJSON<PendingRoute | null>(KEY, null);
  if (!pending) return;
  if (useAnalyticsPrefs.getState().optOut || !isAnalyticsCollectionEnabled()) { removeKey(KEY); return; }
  if (screenFromPath(pathname) === pending.destination) {
    finish(pending, 'success', pending.targetReason && pending.targetReason !== 'accepted' ? pending.targetReason : 'destination_visible');
    removeKey(KEY);
  } else if (Date.now() - pending.createdAt >= 30_000) {
    finish(pending, 'failed', 'destination_timeout');
    removeKey(KEY);
  }
}

export function beginRemoteReturn(message: ParsedPush, owner: string, nowMs = Date.now()): void {
  if (message.reason !== 'accepted' || !isAnalyticsCollectionEnabled() || useAnalyticsPrefs.getState().optOut) return;
  const epoch = consentEpoch();
  if (!Number.isFinite(nowMs) || epoch !== null && nowMs < epoch) { removeKey(RETURN_KEY); return; }
  setJSON(RETURN_KEY, { id: message.id, campaignId: message.campaignId, owner, openedAtMs: nowMs,
    consentEpoch: epoch } satisfies RemoteReturn);
}
export function clearRemoteReturn(): void { removeKey(RETURN_KEY); removeKey(KEY); }
export function getRemoteReturn(nowMs = Date.now()): (RemoteReturn & { valid: boolean }) | null {
  const value = getJSON<RemoteReturn | null>(RETURN_KEY, null);
  if (!isAnalyticsCollectionEnabled() || useAnalyticsPrefs.getState().optOut) { removeKey(RETURN_KEY); return null; }
  if (!value) return null;
  const epoch = consentEpoch();
  if (value.owner !== notificationOwner() || value.consentEpoch !== epoch || typeof value.id !== 'string'
    || epoch !== null && value.openedAtMs < epoch
    || !/^push_[a-f0-9]+_[a-f0-9]+$/.test(value.id) || !Number.isFinite(value.openedAtMs)) { removeKey(RETURN_KEY); return null; }
  return { ...value, valid: wasNotificationTapVisible(value.id, value.owner, 'remote', nowMs)
    && nowMs >= value.openedAtMs && nowMs - value.openedAtMs <= 30 * 60_000 };
}
