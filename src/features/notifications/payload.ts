import { safeNotificationRoute, type NotificationRoute } from './routing';

export interface PushContentContext {
  nowMs: number; versionCode: number; totalLevels: number; currentLevel: number;
  unlockedRoutes: readonly NotificationRoute[];
  dailySolved?: boolean; hasDailyContent?: boolean;
  productDate?: string;
}
export type ParsedPush = Readonly<{ id: string; route: NotificationRoute; campaignId: string;
  reason: string; receivedAtMs: number; senderAdmissionId?: string;
  channel?: 'local' | 'remote'; promptId?: string; requestedRoute?: NotificationRoute;
  minimumVersionCode?: number; minimumContentLevels?: number; targetDate?: string; openedAtMs?: number }>;
const CAMPAIGNS = new Set(['levels-expanded-1000-v1', 'daily-reminder-v1', 'voluntary-activity-v1']);
const ID = /^[a-z0-9][a-z0-9_.:-]{0,95}$/i;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
export function notificationHash(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return `push_${(a >>> 0).toString(16)}_${(b >>> 0).toString(16)}`;
}

/** SDK data is a string map. No text, raw payload or arbitrary URL crosses this boundary. */
export function parsePushMessage(input: unknown, context: PushContentContext): ParsedPush {
  const message = object(input), raw = object(message.data), notification = object(message.notification);
  const data = raw.key === 'route' && typeof raw.value === 'string' ? { route: raw.value } : raw;
  const rawRoute = notification.clickActionType === 'DEEP_LINK' ? notification.clickAction : data.route;
  const route = typeof rawRoute === 'string' && /^slova:\/\/(daily|wheel|events)$/.test(rawRoute)
    ? safeNotificationRoute('/' + rawRoute.slice(8)) : safeNotificationRoute(rawRoute);
  const candidate = data.campaign_id === undefined ? 'legacy'
    : typeof data.campaign_id === 'string' && ID.test(data.campaign_id) ? data.campaign_id : 'unknown';
  const knownCampaign = candidate === 'legacy' || CAMPAIGNS.has(candidate);
  const campaignId = knownCampaign ? candidate : 'unknown';
  const receivedAtMs = typeof message.receivedAtMs === 'number' && Number.isFinite(message.receivedAtMs)
    && message.receivedAtMs >= 0 && message.receivedAtMs <= context.nowMs ? message.receivedAtMs : context.nowMs;
  const providerId = typeof message.messageId === 'string' && message.messageId.length <= 192 ? message.messageId : '';
  // Missing IDs are conservatively coalesced for one receipt day, not assigned a random ID on each callback.
  const id = notificationHash(providerId || `${campaignId}:${route}:${Math.floor(receivedAtMs / 86_400_000)}`);
  const result = (reason: string): ParsedPush => ({ id, route: reason === 'accepted' ? route : '/', campaignId, reason, receivedAtMs,
    openedAtMs: typeof message.openedAtMs === 'number' && Number.isSafeInteger(message.openedAtMs) && message.openedAtMs >= 0
      ? message.openedAtMs : context.nowMs,
    requestedRoute: route, minimumVersionCode: Number(data.min_version_code ?? 0), minimumContentLevels: Number(data.min_content_levels ?? 0),
    ...(campaignId === 'daily-reminder-v1' && context.productDate ? { targetDate: context.productDate } : {}),
    ...(typeof data.sender_admission_id === 'string' && ID.test(data.sender_admission_id) ? { senderAdmissionId: data.sender_admission_id } : {}) });
  if (Object.keys(data).length > 32 || Object.values(data).some((value) => typeof value !== 'string' || value.length > 512)
    || typeof message.messageId === 'string' && message.messageId.length > 192) return result('invalid_payload');
  if (!knownCampaign) return result('campaign_unknown');
  if (data.sender_admission_id !== undefined && (typeof data.sender_admission_id !== 'string'
    || !/^[a-f0-9]{32}$/.test(data.sender_admission_id))) return result('invalid_payload');
  for (const key of ['min_version_code', 'min_content_levels']) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || !/^\d{1,8}$/.test(data[key] as string))) return result('invalid_payload');
  }
  return revalidatePushTarget(result('accepted'), context);
}

/** A queued message is not a policy snapshot: content may finish or lock before the user safely exits. */
export function revalidatePushTarget(message: ParsedPush, context: PushContentContext): ParsedPush {
  const route = safeNotificationRoute(message.requestedRoute ?? message.route);
  const mapped = (reason: string): ParsedPush => ({ ...message, route: reason === 'accepted' ? route : '/', reason });
  if (message.reason === 'invalid_payload' || message.reason === 'campaign_unknown') return mapped(message.reason);
  for (const value of [message.minimumVersionCode ?? 0, message.minimumContentLevels ?? 0]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 99_999_999) return mapped('invalid_payload');
  }
  if ((message.minimumVersionCode ?? 0) > context.versionCode) return mapped('version_unavailable');
  if ((message.minimumContentLevels ?? 0) > context.totalLevels
    || message.campaignId === 'levels-expanded-1000-v1' && context.totalLevels < 1000) return mapped('content_unavailable');
  if (message.campaignId === 'levels-expanded-1000-v1' && context.currentLevel > 1000) return mapped('content_completed');
  if (message.campaignId === 'daily-reminder-v1' && context.dailySolved) return mapped('content_completed');
  if (message.campaignId === 'daily-reminder-v1' && (context.hasDailyContent === false
    || message.targetDate && context.productDate && message.targetDate !== context.productDate)) return mapped('content_unavailable');
  if (!context.unlockedRoutes.includes(route)) return mapped('activity_locked');
  return mapped('accepted');
}
