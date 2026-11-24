import { useCurrency } from '@/features/currency';
import { useWheel } from '@/features/wheel';
import { trackOnce } from '@/features/analytics';
import { selectHelpContext } from '@/features/analytics/helpContext';
import { create } from 'zustand';
import { persistRewardedHint } from '@/features/hints/rewarded-hint';

import { acknowledgeNativeReward, readNativeEarnedRewards, type NativeRewardReceipt } from './nativeRewardJournal';
import { trackRewardReceipt } from './adTelemetry';

export interface RewardRecoveryResult { granted: NativeRewardReceipt[]; pending: NativeRewardReceipt[] }
export const useRewardRecovery = create<{ checking: boolean; readFailed: boolean; pendingIds: string[]; revision: number }>(() => ({
  checking: false, readFailed: false, pendingIds: [], revision: 0,
}));
let recovery: Promise<RewardRecoveryResult> | null = null;
let passRequested = false;
let releaseRequested = false;

/** Retry fulfillment, never the ad. A prepared intent without native earned evidence is not a reward. */
export function recoverRewardedGrants(options: { releaseUnconfirmed?: boolean } = {}): Promise<RewardRecoveryResult> {
  if (recovery) {
    passRequested = true;
    releaseRequested ||= options.releaseUnconfirmed === true;
    return recovery;
  }
  releaseRequested = options.releaseUnconfirmed === true;
  useRewardRecovery.setState({ checking: true });
  recovery = (async () => {
    const granted = new Map<string, NativeRewardReceipt>();
    let pending: NativeRewardReceipt[] = [];
    do {
      passRequested = false;
      const releaseUnconfirmed = releaseRequested;
      releaseRequested = false;
      const receipts = await readNativeEarnedRewards();
      const result: RewardRecoveryResult = { granted: [], pending: [] };
      for (const receipt of receipts) {
      let fulfilled = false;
      try {
        trackRewardReceipt(receipt, 'reward');
        if (receipt.kind === 'hint') {
          if (!persistRewardedHint(receipt)) {
            result.pending.push(receipt);
            continue;
          }
          // Acknowledgment follows durable entitlement storage. The game applies
          // its free effect only when the matching attempt is active/restored.
          fulfilled = true;
          result.granted.push(receipt);
          await acknowledgeNativeReward(receipt.rewardId);
          continue;
        }
        const context = receipt.flowContext;
        const observation = typeof context?.opportunity_id === 'string' && typeof context?.request_id === 'string'
          ? { opportunityId: context.opportunity_id, requestId: context.request_id } : undefined;
        if (receipt.kind === 'wheel' && !useWheel.getState().confirmRewarded(receipt, observation)) {
          result.pending.push(receipt);
          continue;
        }
        const wallet = useCurrency.getState();
        if (receipt.flowContext) wallet.addOnce(receipt.rewardId, 'coins', receipt.amount, selectHelpContext(receipt.flowContext));
        else wallet.addOnce(receipt.rewardId, 'coins', receipt.amount);
        if (!useCurrency.getState().hasApplied(receipt.rewardId)) throw new Error('Reward wallet write unconfirmed');
        trackRewardReceipt(receipt, 'grant_persisted', useCurrency.getState().getTransaction(receipt.rewardId));
        if (receipt.kind === 'wheel' && useWheel.getState().pendingSpin?.effectId === receipt.rewardId) {
          useWheel.getState().claimPending(receipt.rewardId, useCurrency.getState().getTransaction(receipt.rewardId));
        }
        fulfilled = true;
        result.granted.push(receipt);
        // A failed ack leaves the earned receipt for another idempotent recovery.
        await acknowledgeNativeReward(receipt.rewardId);
      } catch {
        if (!fulfilled) result.pending.push(receipt);
        if (fulfilled) {
          try { trackOnce('technical_operation', `${receipt.rewardId}:ack_failure`, { operation: 'reward_ack',
            stage: 'result', operation_id: receipt.rewardId, attempt_no: 1, result: 'failed', normalized_code: 'save_failed', recovery: true }); } catch { /* The native record remains replayable. */ }
          continue;
        }
        try { trackOnce('reward_grant_failed', `${receipt.rewardId}:recovery`, {
          ...selectHelpContext(receipt.flowContext),
          rewardId: receipt.rewardId, operation_id: receipt.rewardId, attempt_no: 1,
          source: 'native_recovery', reason: 'save_failed', normalized_reason: 'save_failed', retryable: true,
          pending_age_ms: Math.max(0, Date.now() - (receipt.earnedAtMs ?? receipt.createdAtMs)),
        }); } catch { /* The native earned journal remains the recovery source. */ }
      }
      }
      const prepared = useWheel.getState().preparedReward;
      if (releaseUnconfirmed && prepared && !receipts.some((receipt) => receipt.rewardId === prepared.rewardId)) {
        useWheel.getState().releasePrepared(prepared.rewardId);
      }
      for (const receipt of result.granted) granted.set(receipt.rewardId, receipt);
      pending = result.pending;
    } while (passRequested);
    useRewardRecovery.setState((state) => ({ readFailed: false,
      pendingIds: pending.map((receipt) => receipt.rewardId), revision: state.revision + 1 }));
    return { granted: [...granted.values()], pending };
  })().catch((error: unknown) => {
    useRewardRecovery.setState((state) => ({ readFailed: true, revision: state.revision + 1 }));
    throw error;
  }).finally(() => { recovery = null; useRewardRecovery.setState({ checking: false }); });
  return recovery;
}
