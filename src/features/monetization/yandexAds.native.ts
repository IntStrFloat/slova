import {
  InterstitialAd,
  InterstitialAdLoader,
  MobileAds,
  RewardedAdLoader,
} from 'yandex-mobile-ads';
import type { RewardedAd } from 'yandex-mobile-ads';
import { AppState } from 'react-native';

import { MONETIZATION } from '@/core/config/monetization';
import { getFullscreenSnapshot, releaseFullscreen, subscribeFullscreen, tryAcquireFullscreen, type FullscreenLease } from '@/core/fullscreen';
import { hasActiveForm, subscribeFormOwnership } from '../../../modules/rustore-review';
import { trackOnce } from '@/features/analytics';
import { addAdTime } from '@/features/analytics/sessionTelemetry';
import { useEntitlements } from './entitlements';
import { createAdTelemetry, newMonetizationId, safeAdErrorProperties, type AdTelemetry } from './adTelemetry';
import { selectHelpContext } from '@/features/analytics/helpContext';
import { hasActiveNativeRewardedShow, prepareNativeReward } from './nativeRewardJournal';
import { rewardedFailureReason } from './rewardedState';
import { recoverRewardedGrants, useRewardRecovery } from './rewardRecovery';

import type { AdsProvider, InterstitialResult, RewardConfirmation, RewardedObservation, RewardedPlacement, RewardedResult, RewardedState } from './types';

let interstitialAd: InterstitialAd | null = null;
let interstitialPreloadAllowed = false;
let rewardedAd: RewardedAd | null = null;
let interstitialTelemetry: AdTelemetry | null = null;
let rewardedTelemetry: AdTelemetry | null = null;
// The native bridge retains loaders, so reuse one per format across refills.
let interstitialLoader: InterstitialAdLoader | null = null;
let rewardedLoader: RewardedAdLoader | null = null;
let interstitialLoadPromise: Promise<void> | null = null;
let rewardedLoadPromise: Promise<void> | null = null;
let sdkInitPromise: Promise<boolean> | null = null;
let sdkReady = false;
let lifecycleObserved = false;
let foreground = AppState.currentState === 'active';
let appFocused = foreground;
let fullscreen: 'interstitial' | 'rewarded' | null = null;
let orphanedRewardedAd: RewardedAd | null = null;
let orphanedInterstitialAd: InterstitialAd | null = null;
let orphanedInterstitialLease: FullscreenLease | null = null;
let orphanedRewardedLease: FullscreenLease | null = null;
let orphanedRewardSession = false;
let orphanReconcileTimer: ReturnType<typeof setTimeout> | null = null;
let fullscreenShown = false;
let fullscreenActiveSince: number | null = null;
let fullscreenActiveMs = 0;
const rewardedReadyListeners = new Set<() => void>();
const rewardedStateListeners = new Set<() => void>();
let lastRewardedReady = false;
let rewardedLoadState: RewardedState = 'not_ready';
let lastRewardedState: RewardedState = 'not_ready';
let rewardedFailure: RewardedState | null = null;

type RetryState = { timer: ReturnType<typeof setTimeout> | null; failures: number };
const sdkRetry: RetryState = { timer: null, failures: 0 };
const interstitialRetry: RetryState = { timer: null, failures: 0 };
const rewardedRetry: RetryState = { timer: null, failures: 0 };
const retryStates = [sdkRetry, interstitialRetry, rewardedRetry];
// A finite burst avoids permanent failed requests when offline or SDK-limited.
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];

function observeFullscreenTime(): void {
  if (fullscreenActiveSince !== null) {
    fullscreenActiveMs += Math.max(0, Date.now() - fullscreenActiveSince);
  }
  fullscreenActiveSince = fullscreenShown && foreground ? Date.now() : null;
}

function shownFullscreen(): void {
  if (fullscreenShown) return;
  fullscreenShown = true;
  fullscreenActiveSince = foreground ? Date.now() : null;
}

function finishFullscreenTime(): void {
  observeFullscreenTime();
  if (fullscreenActiveMs > 0) {
    try { addAdTime(fullscreenActiveMs); } catch { /* Timing cannot prevent dismissal/settlement. */ }
  }
  fullscreenShown = false;
  fullscreenActiveSince = null;
  fullscreenActiveMs = 0;
}

function reportAdsError(stage: string, error: unknown): void {
  console.warn(`[ads] Yandex ${stage} failed`, error);
}

function isRewardedReady(): boolean {
  return rewardedAd !== null && foreground && appFocused && fullscreen === null && orphanedRewardedAd === null
    && !sharedFullscreenBusy() && !rewardRecoveryBlocked();
}

function sharedFullscreenBusy(): boolean {
  return getFullscreenSnapshot().owner !== null || hasActiveForm();
}

function rewardRecoveryBlocked(): boolean {
  const state = useRewardRecovery.getState();
  return state.checking || state.readFailed || state.pendingIds.length > 0;
}

function getRewardedState(): RewardedState {
  if (!foreground || !appFocused) return 'background';
  if (fullscreen !== null || orphanedRewardedAd || sharedFullscreenBusy()) return 'fullscreen_busy';
  if (useRewardRecovery.getState().checking) return 'loading';
  if (useRewardRecovery.getState().readFailed) return 'reward_check_failed';
  if (rewardRecoveryBlocked()) return 'save_failed';
  return rewardedAd ? 'ready' : rewardedLoadState === 'ready' ? 'not_ready' : rewardedLoadState;
}

async function reconcileNativeFullscreen(): Promise<void> {
  const interstitial = orphanedInterstitialAd;
  if (interstitial) {
    try {
      if (!await InterstitialAd.hasActiveShow()) releaseInterstitialOrphan(interstitial);
    } catch { /* Unknown native state must retain the old lease. */ }
  }
  const orphan = orphanedRewardedAd;
  if (!orphan) return;
  try {
    if (!await hasActiveNativeRewardedShow() && orphanedRewardedAd === orphan) {
      if (orphanedRewardSession) void recoverLateEarned();
      releaseOrphan(orphan);
    }
  } catch { /* Preserve fullscreen ownership until native state can be confirmed. */ }
}

function releaseInterstitialOrphan(ad: InterstitialAd): void {
  if (orphanedInterstitialAd !== ad) return;
  const lease = orphanedInterstitialLease;
  orphanedInterstitialAd = null;
  orphanedInterstitialLease = null;
  if (lease) releaseFullscreen(lease);
  notifyRewardedReady();
}

function releaseOrphan(ad: RewardedAd): void {
  if (orphanedRewardedAd !== ad) return;
  const lease = orphanedRewardedLease;
  orphanedRewardedAd = null;
  orphanedRewardedLease = null;
  if (lease) releaseFullscreen(lease);
  notifyRewardedReady();
}

function reconcileFullscreenWithRetry(): void {
  if (orphanReconcileTimer) clearTimeout(orphanReconcileTimer);
  orphanReconcileTimer = null;
  const poll = async (attempt: number) => {
    if (!foreground || (!orphanedRewardedAd && !orphanedInterstitialAd)) return;
    await reconcileNativeFullscreen();
    if ((orphanedRewardedAd || orphanedInterstitialAd) && foreground && attempt < 15) {
      orphanReconcileTimer = setTimeout(() => { orphanReconcileTimer = null; void poll(attempt + 1); }, 1_000);
    }
  };
  void poll(0);
}

function recoverLateEarned(): void {
  void recoverRewardedGrants().catch(() => {});
}

function notifyRewardedReady(): void {
  const ready = isRewardedReady();
  const state = getRewardedState();
  const readyChanged = lastRewardedReady !== ready;
  const stateChanged = lastRewardedState !== state;
  if (!readyChanged && !stateChanged) return;
  lastRewardedReady = ready;
  lastRewardedState = state;
  const listeners = [...(readyChanged ? rewardedReadyListeners : []), ...(stateChanged ? rewardedStateListeners : [])];
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      reportAdsError('rewarded readiness subscriber', error);
    }
  }
}

function setRewardedAd(ad: RewardedAd | null): void {
  rewardedAd = ad;
  notifyRewardedReady();
}

function resetRetry(state: RetryState): void {
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
  state.failures = 0;
}

function retryAfterFailure(state: RetryState, retry: () => Promise<void>): void {
  const delay = RETRY_DELAYS_MS[state.failures];
  state.failures += 1;
  if (!foreground || state.timer !== null || delay === undefined) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    if (foreground) void retry();
  }, delay);
}

function canLoad(state: RetryState): boolean {
  return foreground && state.timer === null && state.failures <= RETRY_DELAYS_MS.length;
}

function setInterstitialPreloadAllowed(allowed: boolean): void {
  if (!allowed && interstitialRetry.timer !== null) {
    clearTimeout(interstitialRetry.timer);
    interstitialRetry.timer = null;
  }
  if (allowed && !interstitialPreloadAllowed) resetRetry(interstitialRetry);
  interstitialPreloadAllowed = allowed;
  if (allowed) void preloadInterstitial();
}

function discardRemovedInterstitial(): void {
  if (!useEntitlements.getState().removeAds) return;
  setInterstitialPreloadAllowed(false);
  const ad = interstitialAd;
  interstitialAd = null;
  interstitialTelemetry = null;
  if (ad) void ad.dispose().catch(() => {});
}

function observeLifecycle(): void {
  if (lifecycleObserved) return;
  lifecycleObserved = true;
  useRewardRecovery.subscribe(notifyRewardedReady);
  subscribeFullscreen(notifyRewardedReady);
  subscribeFormOwnership(notifyRewardedReady);
  useEntitlements.subscribe(discardRemovedInterstitial);
  foreground = AppState.currentState === 'active';
  AppState.addEventListener('change', (state) => {
    const wasForeground = foreground;
    foreground = state === 'active';
    if (!foreground) appFocused = false;
    else if (!wasForeground) appFocused = true;
    observeFullscreenTime();
    notifyRewardedReady();
    if (!foreground) {
      if (orphanReconcileTimer) clearTimeout(orphanReconcileTimer);
      orphanReconcileTimer = null;
      for (const retry of retryStates) {
        if (retry.timer !== null) clearTimeout(retry.timer);
        retry.timer = null;
      }
    } else if (!wasForeground) {
      // Foreground resumption starts one new bounded recovery burst.
      retryStates.forEach(resetRetry);
      reconcileFullscreenWithRetry();
      if (rewardRecoveryBlocked()) recoverLateEarned();
      void initialize();
    }
  });
  // Android notification shade can restore window focus without an AppState change.
  AppState.addEventListener('focus', () => {
    appFocused = true;
    reconcileFullscreenWithRetry();
    if (rewardRecoveryBlocked()) recoverLateEarned();
    notifyRewardedReady();
  });
  AppState.addEventListener('blur', () => { appFocused = false; notifyRewardedReady(); });
}

async function preloadInterstitial(): Promise<void> {
  if (interstitialAd) return;
  if (!interstitialPreloadAllowed || useEntitlements.getState().removeAds) return;
  if (!sdkReady || (!interstitialLoadPromise && !canLoad(interstitialRetry))) return;
  if (!interstitialLoadPromise) {
    interstitialLoadPromise = Promise.resolve().then(async () => {
      const telemetry = createAdTelemetry('interstitial', 'level_complete');
      try {
        interstitialLoader ??= await InterstitialAdLoader.create();
        if (!foreground || !interstitialPreloadAllowed || useEntitlements.getState().removeAds) return;
        telemetry.emit('requested', { reason: 'preload' });
        const loaded = await interstitialLoader.loadAd({
          adUnitId: MONETIZATION.yandex.interstitialAdUnitId,
        });
        if (useEntitlements.getState().removeAds) {
          void loaded.dispose().catch(() => {});
          return;
        }
        interstitialAd = loaded;
        interstitialTelemetry = telemetry;
        telemetry.emit('loaded');
        resetRetry(interstitialRetry);
      } catch (error) {
        reportAdsError('interstitial load', error);
        interstitialAd = null;
        telemetry.emit('error', { reason: 'load_failed', normalized_reason: rewardedFailureReason(error),
          operation: 'load', ...safeAdErrorProperties(error) });
        if (interstitialPreloadAllowed && !useEntitlements.getState().removeAds) {
          retryAfterFailure(interstitialRetry, preloadInterstitial);
        }
      }
    }).finally(() => {
      interstitialLoadPromise = null;
    });
  }
  await interstitialLoadPromise;
}

async function preloadRewarded(): Promise<void> {
  if (rewardedAd) return;
  if (!sdkReady || (!rewardedLoadPromise && !canLoad(rewardedRetry))) return;
  if (!rewardedLoadPromise) {
    rewardedLoadState = 'loading';
    notifyRewardedReady();
    rewardedLoadPromise = Promise.resolve().then(async () => {
      const telemetry = createAdTelemetry('rewarded', 'preload');
      try {
        rewardedLoader ??= await RewardedAdLoader.create();
        if (!foreground) return;
        telemetry.emit('requested', { reason: 'preload' });
        setRewardedAd(await rewardedLoader.loadAd({
          adUnitId: MONETIZATION.yandex.rewardedAdUnitId,
        }));
        rewardedTelemetry = telemetry;
        rewardedLoadState = 'ready';
        telemetry.emit('loaded');
        resetRetry(rewardedRetry);
      } catch (error) {
        reportAdsError('rewarded load', error);
        setRewardedAd(null);
        rewardedLoadState = rewardedFailureReason(error);
        rewardedFailure = rewardedLoadState;
        notifyRewardedReady();
        telemetry.emit('error', { reason: 'load_failed', normalized_reason: rewardedLoadState,
          operation: 'load', ...safeAdErrorProperties(error) });
        retryAfterFailure(rewardedRetry, preloadRewarded);
      }
    }).finally(() => {
      rewardedLoadPromise = null;
    });
  }
  await rewardedLoadPromise;
}

async function initialize(): Promise<void> {
  observeLifecycle();
  if (!foreground) return;
  if (!sdkReady) {
    if (!sdkInitPromise && !canLoad(sdkRetry)) return;
    sdkInitPromise ??= Promise.resolve().then(async () => {
      rewardedLoadState = 'loading';
      notifyRewardedReady();
      try {
        await MobileAds.initialize();
        sdkReady = true;
        resetRetry(sdkRetry);
        return true;
      } catch (error) {
        reportAdsError('SDK initialization', error);
        rewardedLoadState = rewardedFailureReason(error);
        rewardedFailure = rewardedLoadState;
        notifyRewardedReady();
        retryAfterFailure(sdkRetry, initialize);
        return false;
      }
    }).finally(() => { sdkInitPromise = null; });
    if (!(await sdkInitPromise)) return;
  }
  await Promise.all([preloadInterstitial(), preloadRewarded()]);
}

async function showInterstitial(): Promise<InterstitialResult> {
  const telemetry = interstitialTelemetry ?? createAdTelemetry('interstitial', 'level_complete');
  if (useEntitlements.getState().removeAds) {
    createAdTelemetry('interstitial', 'level_complete').emit('skipped', { reason: 'entitlement' });
    return 'skipped';
  }
  if (!foreground || !appFocused || fullscreen !== null || orphanedRewardedAd || sharedFullscreenBusy() || rewardRecoveryBlocked()) {
    createAdTelemetry('interstitial', 'level_complete').emit('skipped', { reason: !foreground ? 'background' : 'fullscreen_busy' });
    return 'unavailable';
  }
  const ad = interstitialAd;
  if (!ad) {
    telemetry.emit('skipped', { reason: 'not_ready' });
    void preloadInterstitial();
    return 'unavailable';
  }
  const lease = tryAcquireFullscreen('interstitial');
  if (!lease) return 'unavailable';
  fullscreen = 'interstitial';
  interstitialPreloadAllowed = false;
  telemetry.emit('eligible');
  notifyRewardedReady();
  interstitialAd = null;
  interstitialTelemetry = null;
  return new Promise((resolve) => {
    let settled = false;
    let shown = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      orphanedInterstitialAd = ad;
      orphanedInterstitialLease = lease;
      telemetry.emit('error', { reason: 'callback_timeout', operation: 'show' });
      void ad.dispose().then(reconcileFullscreenWithRetry).catch(reconcileFullscreenWithRetry);
      finish(shown ? 'shown' : 'unavailable');
    }, 180_000);
    const finish = (result: InterstitialResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      finishFullscreenTime();
      fullscreen = null;
      if (orphanedInterstitialAd !== ad) releaseFullscreen(lease);
      notifyRewardedReady();
      resolve(result);
    };
    ad.onAdShown = () => {
      if (settled) return;
      shown = true;
      shownFullscreen();
      telemetry.emit('shown');
    };
    ad.onAdImpression = () => { if (!settled) telemetry.emit('impression'); };
    ad.onAdClicked = () => { if (!settled) telemetry.emit('click'); };
    ad.onAdDismissed = () => {
      releaseInterstitialOrphan(ad);
      if (settled) return;
      telemetry.emit('closed');
      finish('shown');
    };
    const failed = (error: unknown) => {
      releaseInterstitialOrphan(ad);
      if (settled) return;
      reportAdsError('interstitial show', error);
      telemetry.emit('error', { reason: 'show_failed', ...safeAdErrorProperties(error) });
      void ad.dispose().catch(() => {});
      finish('unavailable');
    };
    ad.onAdFailedToShow = failed;
    try { void ad.show().catch(failed); } catch (error) { failed(error); }
  });
}

async function showRewarded(
  placement: RewardedPlacement,
  confirmation?: RewardConfirmation,
  onOpportunity?: (observation: RewardedObservation) => void,
): Promise<RewardedResult> {
  const telemetry = rewardedTelemetry ?? createAdTelemetry('rewarded', placement);
  const context = selectHelpContext(confirmation?.receipt?.flowContext);
  const interactionId = context.interaction_id ?? newMonetizationId('show');
  const placementProps = { ...context, interaction_id: interactionId, operation_id: interactionId,
    operation: 'show', placement, ...(confirmation ? { rewardId: confirmation.rewardId } : {}) };
  if (!foreground || !appFocused || fullscreen !== null || orphanedRewardedAd || sharedFullscreenBusy() || rewardRecoveryBlocked()) {
    rewardedFailure = !foreground || !appFocused ? 'background' : rewardRecoveryBlocked() ? getRewardedState() : 'fullscreen_busy';
    createAdTelemetry('rewarded', placement).emit('skipped', { ...placementProps, reason: rewardedFailure,
      blocked_reason: rewardedFailure, normalized_reason: rewardedFailure });
    return 'unavailable';
  }
  if (confirmation && (!confirmation.rewardId.trim() || typeof confirmation.persistGrant !== 'function')) {
    rewardedFailure = 'offer_save_failed';
    createAdTelemetry('rewarded', placement).emit('skipped', { ...placementProps, reason: 'invalid_confirmation',
      blocked_reason: 'invalid_confirmation', normalized_reason: 'offer_save_failed' });
    return 'unavailable';
  }
  const ad = rewardedAd;
  if (!ad) {
    rewardedFailure = getRewardedState();
    telemetry.emit('skipped', { ...placementProps, reason: 'not_ready', blocked_reason: rewardedFailure,
      normalized_reason: rewardedFailure });
    void preloadRewarded();
    return 'unavailable';
  }
  const lease = tryAcquireFullscreen('rewarded');
  if (!lease) { rewardedFailure = 'fullscreen_busy'; return 'unavailable'; }
  fullscreen = 'rewarded';
  rewardedFailure = null;
  // Accepted user operations include subsequent prepare/show failures; preloads never enter this denominator.
  telemetry.emit('show_intent', { ...placementProps, outcome: 'accepted' });
  telemetry.emit('eligible', placementProps);
  try { onOpportunity?.({ opportunityId: telemetry.opportunityId, requestId: telemetry.requestId }); } catch { /* optional observation cannot block the ad */ }
  setRewardedAd(null);
  rewardedTelemetry = null;
  if (confirmation?.receipt) {
    try {
      if (confirmation.receipt.rewardId !== confirmation.rewardId) throw new Error('Receipt identity mismatch');
      const boundReceipt = { ...confirmation.receipt, flowContext: { ...context, interaction_id: interactionId,
        opportunity_id: telemetry.opportunityId, request_id: telemetry.requestId, placement } };
      await prepareNativeReward(ad, boundReceipt);
      if (!foreground || !appFocused) throw new Error('Application lost focus before showing ad');
    } catch {
      rewardedFailure = !foreground || !appFocused ? 'background' : 'offer_save_failed';
      fullscreen = null;
      releaseFullscreen(lease);
      void ad.dispose?.().catch(() => {});
      notifyRewardedReady();
      void preloadRewarded();
      telemetry.emit('error', { ...placementProps, reason: rewardedFailure, normalized_reason: rewardedFailure,
        blocked_reason: rewardedFailure, outcome: 'failed' });
      return 'unavailable';
    }
  }
  return new Promise((resolve) => {
    let settled = false;
    let earnedReward = false;
    let grantPersisted = false;
    let persistenceAttempt = 0;
    const watchdog = setTimeout(() => {
      if (settled) return;
      rewardedFailure = 'show_error';
      orphanedRewardedAd = ad;
      orphanedRewardedLease = lease;
      orphanedRewardSession = Boolean(confirmation?.receipt);
      telemetry.emit('error', { ...placementProps, reason: 'callback_timeout', normalized_reason: 'show_error', outcome: 'failed' });
      void ad.dispose?.().then(reconcileFullscreenWithRetry).catch(reconcileFullscreenWithRetry);
      finish(earnedReward ? 'rewarded' : 'unavailable');
    }, 180_000);
    const finish = (result: RewardedResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      finishFullscreenTime();
      fullscreen = null;
      if (orphanedRewardedAd !== ad) releaseFullscreen(lease);
      notifyRewardedReady();
      void preloadRewarded();
      resolve(result);
    };
    ad.onRewarded = () => {
      if (settled) { if (confirmation?.receipt) void recoverLateEarned(); return; }
      earnedReward = true;
      telemetry.emit('reward', placementProps);
      if (!confirmation || grantPersisted) return;
      persistenceAttempt += 1;
      try {
        // The SDK can confirm a reward before dismissal. Persist at this exact point.
        grantPersisted = confirmation.persistGrant(confirmation.rewardId) === true;
        if (grantPersisted) telemetry.emit(confirmation.persistenceStage ?? 'grant_persisted', placementProps);
      } catch (error) {
        // A duplicate callback can retry a failed write. The caller can retry after dismissal too.
        reportAdsError('reward persistence', error);
      }
      if (!grantPersisted) try { trackOnce('reward_grant_failed', `${telemetry.requestId}:${confirmation.rewardId}:${persistenceAttempt}`, {
        rewardId: confirmation.rewardId, operation_id: telemetry.requestId, attempt_no: persistenceAttempt,
        ...context, source: 'rewarded_confirmation', reason: 'storage_unconfirmed', normalized_reason: 'save_failed', retryable: true, pending_age_ms: 0,
      }); } catch { /* The earned provider reward remains visible to the caller. */ }
    };
    ad.onAdShown = () => {
      if (settled) return;
      shownFullscreen();
      telemetry.emit('shown', placementProps);
    };
    ad.onAdImpression = () => { if (!settled) telemetry.emit('impression', placementProps); };
    ad.onAdClicked = () => { if (!settled) telemetry.emit('click', placementProps); };
    ad.onAdDismissed = () => {
      if (orphanedRewardedAd === ad) {
        if (confirmation?.receipt) void recoverLateEarned();
        releaseOrphan(ad);
      }
      telemetry.emit('closed', { ...placementProps, result: earnedReward ? 'rewarded' : 'dismissed',
        outcome: earnedReward ? 'earned' : 'cancelled', ...(!earnedReward ? { normalized_reason: 'cancelled' } : {}) });
      finish(earnedReward ? 'rewarded' : 'dismissed');
    };
    ad.onAdFailedToShow = (error) => {
      if (orphanedRewardedAd === ad) {
        if (confirmation?.receipt) void recoverLateEarned();
        releaseOrphan(ad);
      }
      if (settled) return;
      reportAdsError('rewarded show', error);
      rewardedFailure = rewardedFailureReason(error, 'show_error');
      telemetry.emit('error', { ...placementProps, reason: 'show_failed', normalized_reason: rewardedFailure,
        outcome: 'failed', ...safeAdErrorProperties(error) });
      finish(earnedReward ? 'rewarded' : 'unavailable');
    };
    const failed = (error: unknown) => {
      if (orphanedRewardedAd === ad) {
        if (confirmation?.receipt) void recoverLateEarned();
        releaseOrphan(ad);
      }
      if (settled) return;
      reportAdsError('rewarded show', error);
      rewardedFailure = rewardedFailureReason(error, 'show_error');
      telemetry.emit('error', { ...placementProps, reason: 'show_failed', normalized_reason: rewardedFailure,
        outcome: 'failed', ...safeAdErrorProperties(error) });
      finish(earnedReward ? 'rewarded' : 'unavailable');
    };
    try { void ad.show().catch(failed); } catch (error) { failed(error); }
  });
}

export const YandexAdsProvider: AdsProvider = {
  init: initialize,
  setInterstitialPreloadAllowed,
  showInterstitial,
  showRewarded,
  isInterstitialReady: () => !useEntitlements.getState().removeAds && interstitialAd !== null && foreground && appFocused && fullscreen === null
    && orphanedRewardedAd === null && !sharedFullscreenBusy() && !rewardRecoveryBlocked(),
  isRewardedReady,
  getRewardedState,
  getRewardedFailure: () => rewardedFailure,
  subscribeRewardedReady: (listener) => {
    rewardedReadyListeners.add(listener);
    return () => { rewardedReadyListeners.delete(listener); };
  },
  subscribeRewardedState: (listener) => {
    rewardedStateListeners.add(listener);
    return () => { rewardedStateListeners.delete(listener); };
  },
};
