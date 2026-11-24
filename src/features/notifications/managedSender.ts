import RemindersModule from '../../../modules/reminders/src/RemindersModule';
import { track } from '@/features/analytics';
import type { ParsedPush } from './payload';
import { PUSH } from './config';

export interface RemoteSenderGateway {
  /** Future sender must enforce idempotency+expiry and use this admission ID in its payload. */
  send(request: { messageId: string; campaignId: string; route: string; admissionId: string; expiresAtMs: number }): Promise<'accepted' | 'rejected' | 'unknown'>;
}
export interface RemoteAdmissionPort {
  reserve(requestId: string): { allowed: boolean; reason: string; id?: string };
  settle(id: string, acceptedOrUnknown: boolean): boolean;
}
export const nativeRemoteAdmission: RemoteAdmissionPort = {
  reserve: (requestId) => {
    try { return JSON.parse(RemindersModule?.reserveRemoteNotification?.(JSON.stringify({ requestId })) ?? '{}'); }
    catch { return { allowed: false, reason: 'unavailable' }; }
  },
  settle: (id, acceptedOrUnknown) => {
    try { return RemindersModule?.settleRemoteNotification?.(id, acceptedOrUnknown) ?? false; } catch { return false; }
  },
};

/** Executable sender contract, intentionally dormant until a separately configured managed gateway exists. */
export async function sendAdmittedNotification(message: ParsedPush, gateway: RemoteSenderGateway,
  port = nativeRemoteAdmission, options: { enabled?: boolean; nowMs?: number } = {}): Promise<{ result: string; reason: string }> {
  if (!(options.enabled ?? PUSH.managedRemoteEnabled)) return { result: 'suppressed', reason: 'disabled' };
  const nowMs = options.nowMs ?? Date.now();
  if (message.reason !== 'accepted') return { result: 'rejected', reason: message.reason };
  let admission: ReturnType<RemoteAdmissionPort['reserve']>;
  try { admission = port.reserve(message.id); } catch { return { result: 'suppressed', reason: 'unavailable' }; }
  if (!admission.allowed || !admission.id || !/^[a-f0-9]{32}$/.test(admission.id)) {
    return { result: 'suppressed', reason: admission.reason ?? 'unavailable' };
  }
  let result: 'accepted' | 'rejected' | 'unknown' = 'unknown';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    result = await Promise.race([gateway.send({ messageId: message.id, campaignId: message.campaignId,
      route: message.route, admissionId: admission.id, expiresAtMs: nowMs + 120_000 }),
    new Promise<'unknown'>((resolve) => { timer = setTimeout(() => resolve('unknown'), 3000); })]);
  } catch { result = 'unknown'; }
  finally { if (timer) clearTimeout(timer); }
  // Unknown could have been accepted: consume conservatively, never free a slot and blindly retry.
  let saved = false;
  try { saved = port.settle(admission.id, result !== 'rejected'); } catch { /* Reservation remains conservative and retryable. */ }
  track('notification_admission_result', { provider: 'rustore', channel: 'remote', result,
    reason: saved ? 'reservation_settled' : 'settlement_pending' });
  return { result, reason: saved ? 'reservation_settled' : 'settlement_pending' };
}
