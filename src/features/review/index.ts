import { AppState } from 'react-native';

import { discard, hasActiveForm, isAvailable, launch, prepareResult, type ReviewPrepareResult } from '../../../modules/rustore-review';
import { getFullscreenSnapshot, releaseFullscreen, tryAcquireFullscreen } from '@/core/fullscreen';
import { track } from '@/features/analytics';

import { REVIEW_DIAGNOSTICS_ENABLED, REVIEW_ENABLED } from './config';
import { markReviewHandled, readReviewState, reserveReviewAttempt, reviewEligibility, type ReviewContext } from './policy';

export type CampaignReviewResult = 'skipped' | 'unavailable' | 'completed' | 'error';
let busy = false;
let sequence = 0;

type ReviewEvent = 'review_eligibility' | 'review_prepare_result' | 'review_launch_attempt' | 'review_flow_finished';
function observe(name: ReviewEvent, context: ReviewContext, properties: Record<string, string | number>): void {
  if (name !== 'review_flow_finished' && !REVIEW_DIAGNOSTICS_ENABLED) return;
  try { track(name, { levelId: context.levelId, completed_count: context.completedCount,
    source: 'campaign_milestone', ...properties }); } catch { /* Diagnostics cannot change a saved victory. */ }
}

/** Only preparation is timed out. An open RuStore form belongs to the user until its callback. */
async function prepareWithoutBlocking(): Promise<ReviewPrepareResult | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      prepareResult(),
      new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), 1500); }),
    ]);
    if (result !== 'ready') discard();
    return result;
  } catch {
    discard();
    return 'error';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run after rewards/postcard reveal and before advancing. Any attempt replaces the interstitial. */
export async function requestCampaignReview(
  context: ReviewContext, isSafePoint: () => boolean = () => false,
): Promise<CampaignReviewResult> {
  const safe = () => { try { return isSafePoint() === true; } catch { return false; } };
  const suppress = (reason: string, result: CampaignReviewResult = 'skipped') => {
    observe('review_eligibility', context, { result: 'suppressed', reason });
    return result;
  };
  if (!REVIEW_ENABLED) return suppress('disabled');
  if (busy || hasActiveForm() || getFullscreenSnapshot().owner !== null) return suppress('fullscreen_busy', 'unavailable');
  const eligibility = reviewEligibility(context);
  if (!eligibility.eligible) return suppress(eligibility.reason);
  if (AppState.currentState !== 'active') return suppress('background');
  if (!safe()) return suppress('unsafe_point', 'unavailable');
  if (!isAvailable()) return suppress('unavailable');
  const lease = tryAcquireFullscreen('review');
  if (!lease) return suppress('fullscreen_busy', 'unavailable');
  busy = true;
  const operation_id = `rv_${Date.now().toString(36)}_${(++sequence).toString(36)}`;
  let stage = 'reservation';
  let reason = 'storage_unconfirmed';
  let result: CampaignReviewResult = 'error';
  let attempt_no = readReviewState().attempts;
  observe('review_eligibility', context, { result: 'eligible', reason: 'eligible', operation_id });
  try {
    if (!reserveReviewAttempt(context)) { result = 'skipped'; reason = 'policy_changed'; return result; }
    attempt_no = readReviewState().attempts;
    stage = 'prepare';
    reason = 'prepare_error';
    const prepared = await prepareWithoutBlocking();
    observe('review_prepare_result', context, { operation_id, attempt_no, stage,
      result: prepared === 'ready' ? 'ready' : prepared === 'error' ? 'error' : 'unavailable', reason: prepared });
    if (prepared !== 'ready') { result = prepared === 'error' ? 'error' : 'unavailable'; reason = prepared; return result; }
    if (AppState.currentState !== 'active' || !safe()) {
      discard(); result = 'unavailable'; reason = AppState.currentState !== 'active' ? 'background' : 'unsafe_point'; return result;
    }
    stage = 'launch';
    reason = 'launch_error';
    observe('review_launch_attempt', context, { operation_id, attempt_no, stage, result: 'attempted', reason: 'prepared' });
    result = await launch();
    reason = result === 'completed' ? 'flow_completed' : result;
    if (result === 'completed') {
      stage = 'history';
      reason = 'handled_write_failed';
      markReviewHandled();
      reason = 'flow_completed';
    }
    return result;
  } catch {
    // A review or its local persistence must never turn a saved victory into a transition error.
    result = 'error';
    return result;
  } finally {
    observe('review_flow_finished', context, { operation_id, attempt_no, stage, result, reason });
    busy = false;
    releaseFullscreen(lease);
  }
}
