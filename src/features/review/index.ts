import { AppState } from 'react-native';

import { discard, isAvailable, launch, prepare } from '../../../modules/rustore-review';

import { markReviewHandled, reserveReviewAttempt, type ReviewContext } from './policy';

export type CampaignReviewResult = 'skipped' | 'unavailable' | 'completed' | 'error';
let busy = false;

/** Only preparation is timed out. An open RuStore form belongs to the user until its callback. */
async function prepareWithoutBlocking(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = await Promise.race([
      prepare(),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 1500); }),
    ]);
    if (!ready) discard();
    return ready;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run after rewards/postcard reveal and before advancing. Any attempt replaces the interstitial. */
export async function requestCampaignReview(context: ReviewContext): Promise<CampaignReviewResult> {
  if (busy || AppState.currentState !== 'active' || !isAvailable()) return 'skipped';
  busy = true;
  try {
    if (!reserveReviewAttempt(context)) return 'skipped';
    if (!await prepareWithoutBlocking()) return 'unavailable';
    if (AppState.currentState !== 'active') {
      discard();
      return 'unavailable';
    }
    const result = await launch();
    if (result === 'completed') markReviewHandled();
    return result;
  } catch {
    // A review or its local persistence must never turn a saved victory into a transition error.
    return 'error';
  } finally {
    busy = false;
  }
}
