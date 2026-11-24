import { trackOnce } from '@/features/analytics';
import { selectHelpContext } from '@/features/analytics/helpContext';
import type { WalletTransactionRecord } from '@/features/currency';
import type { NativeRewardReceipt } from './nativeRewardJournal';

export type AdFormat = 'banner' | 'interstitial' | 'rewarded';
export type AdStage = 'show_intent' | 'eligible' | 'skipped' | 'requested' | 'loaded' | 'shown' | 'impression'
  | 'click' | 'closed' | 'reward' | 'error' | 'earned_pending' | 'grant_persisted';

let sequence = 0;
export function newMonetizationId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${sequence.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** One network load retains its identity when the preloaded ad is eventually shown. */
export function createAdTelemetry(format: AdFormat, placement: string) {
  const opportunityId = newMonetizationId('ao');
  const requestId = newMonetizationId('ar');
  const startedAt = Date.now();
  const recorded = new Set<string>();
  let operation: 'load' | 'show' = 'load';
  return {
    opportunityId,
    requestId,
    emit(stage: AdStage, props: Record<string, unknown> = {}, ordinal = 0) {
      if (stage !== 'requested' && stage !== 'loaded' && stage !== 'error') operation = 'show';
      const callbackId = `${requestId}:${stage}:${ordinal}`;
      if (recorded.has(callbackId)) return;
      recorded.add(callbackId);
      // SDK exceptions, impression blobs and ad-unit credentials are deliberately excluded.
      try { trackOnce('ad_lifecycle', callbackId, {
        opportunity_id: opportunityId,
        request_id: requestId,
        callback_id: callbackId,
        format,
        placement,
        stage,
        operation,
        latency_ms: Math.max(0, Date.now() - startedAt),
        is_test: process.env.EXPO_PUBLIC_YANDEX_TEST_ADS === '1',
        ...props,
      }); } catch { /* Optional telemetry cannot change loading, callbacks or rewards. */ }
    },
  };
}

export type AdTelemetry = ReturnType<typeof createAdTelemetry>;

/** Replay native proof with the same key as the live callback, never as a second earned reward. */
export function trackRewardReceipt(receipt: Pick<NativeRewardReceipt, 'rewardId' | 'kind' | 'flowContext' | 'earnedAtMs'>,
  stage: 'reward' | 'grant_persisted', grant?: WalletTransactionRecord | null): void {
  const context = receipt.flowContext;
  const opportunity = context?.opportunity_id;
  const request = context?.request_id;
  if (typeof opportunity !== 'string' || typeof request !== 'string') return;
  // An already applied ledger entry is not a new grant on recovery. Missing legacy
  // transaction time remains unknown; never move an old grant across a consent epoch.
  if (stage === 'grant_persisted' && (!grant || grant.currency !== 'coins' || grant.delta <= 0
    || !Number.isSafeInteger(grant.occurredAtMs) || grant.occurredAtMs < 0)) return;
  const occurredAtMs = stage === 'reward' ? receipt.earnedAtMs : grant?.occurredAtMs;
  const timeKnown = Number.isSafeInteger(occurredAtMs) && (occurredAtMs ?? -1) >= 0;
  const help = selectHelpContext(context);
  const callback = `${request}:${stage}:0`;
  try { trackOnce('ad_lifecycle', callback, { opportunity_id: opportunity, request_id: request,
    ...help,
    callback_id: callback, format: 'rewarded', placement: receipt.kind === 'wheel' ? 'wheel' : 'hint',
    stage, operation: 'show', operation_id: help.interaction_id ?? request, rewardId: receipt.rewardId,
    recovery: true, timeKnown, ...(timeKnown ? { occurredAtMs } : {}),
    ...(stage === 'grant_persisted' && grant ? { transaction_id: grant.id } : {}),
  }); } catch { /* Durable fulfillment is independent of event delivery. */ }
}

/** The RN loader wraps the SDK code in a JSON error message; retain only its numeric code. */
export function safeAdErrorProperties(error: unknown): Record<string, number> {
  if (!error || typeof error !== 'object') return {};
  let code: unknown = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  if (typeof code !== 'number' && typeof message === 'string' && message.length <= 8_192) {
    try { code = (JSON.parse(message) as { code?: unknown })?.code; } catch { /* no arbitrary text */ }
  }
  if (typeof code === 'string' && /^\d{1,5}$/.test(code)) code = Number(code);
  return typeof code === 'number' && Number.isSafeInteger(code) && code >= 0 && code <= 65_535
    ? { error_code: code } : {};
}

export function recordInterstitialPolicySkip(reason: string, policyRevision?: number): void {
  createAdTelemetry('interstitial', 'level_complete').emit('skipped', { reason, policyRevision });
}
