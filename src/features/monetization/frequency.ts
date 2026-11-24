import { MONETIZATION } from '@/core/config/monetization';

// Keep recent diagnostic timestamps without limiting the number of ad shows.
const INTERSTITIAL_HISTORY_WINDOW_MS = 60 * 60 * 1000;

/** Persisted ad counters. Optional fields allow existing ads.meta saves to migrate. */
export interface AdsMeta {
  /** Legacy count; eligibility uses campaignCompletedIds instead. */
  levelCompletes: number;
  lastInterstitialAt: number | null;
  campaignCompletedIds?: number[];
  lifetimeVisibleGameplaySec?: number;
  visibleGameplaySinceFullscreenSec?: number;
  visibleGameplaySinceInterstitialSec?: number;
  rewardedCooldownActive?: boolean;
  /** Retained storage name; rewarded ads no longer reset this counter. */
  newCampaignCompletionsSinceFullscreen?: number;
  interstitialShownAt?: number[];
  sessionId?: string | null;
  sessionInterstitialCount?: number;
}

export type AdsState = Required<AdsMeta>;

export const EMPTY_ADS_META: AdsState = {
  levelCompletes: 0,
  lastInterstitialAt: null,
  campaignCompletedIds: [],
  lifetimeVisibleGameplaySec: 0,
  visibleGameplaySinceFullscreenSec: 0,
  visibleGameplaySinceInterstitialSec: 0,
  rewardedCooldownActive: false,
  newCampaignCompletionsSinceFullscreen: 0,
  interstitialShownAt: [],
  sessionId: null,
  sessionInterstitialCount: 0,
};

export interface InterstitialCfg {
  onboardingProtectedThroughLevel: number;
  minUniqueCampaignCompletions: number;
  minVisibleGameplaySinceInterstitialSec: number;
  minNewCampaignCompletionsSinceFullscreen: number;
  rewardedCooldownSec: number;
}

export interface InterstitialContext {
  enabled: boolean;
  removeAds: boolean;
  loaded: boolean;
  nowMs: number;
  /** Installation-level first gameplay visit, independent of analytics inactivity. */
  isFirstGameplaySession: boolean;
  /** Null for daily puzzles, app launch, menu and other placements. */
  campaignLevelId: number | null;
  userContinued: boolean;
  rewardsCommitted: boolean;
  /** First postcard, album completion, weekly grand reward, tutorial, etc. */
  protectedTransition: boolean;
  cfg?: InterstitialCfg;
}

export type InterstitialSkipReason =
  | 'ads_disabled'
  | 'remove_ads'
  | 'first_session_protected'
  | 'not_campaign_result'
  | 'onboarding_level'
  | 'onboarding_incomplete'
  | 'protected_transition'
  | 'not_user_continuation'
  | 'rewards_not_committed'
  | 'ad_not_loaded'
  | 'invalid_time'
  | 'insufficient_unique_completions'
  | 'insufficient_interstitial_interval'
  | 'rewarded_cooldown';

export type InterstitialDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: InterstitialSkipReason };

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Copies and sanitizes old or partially written MMKV JSON without granting ad eligibility. */
export function normalizeAdsMeta(value: unknown): AdsState {
  const raw = value && typeof value === 'object' ? value as Partial<AdsMeta> : {};
  const ids = Array.isArray(raw.campaignCompletedIds)
    ? [...new Set(raw.campaignCompletedIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
    : [];
  const lastInterstitialAt = validTimestamp(raw.lastInterstitialAt) ? raw.lastInterstitialAt : null;
  const timestamps = Array.isArray(raw.interstitialShownAt)
    ? raw.interstitialShownAt.filter(validTimestamp)
    : lastInterstitialAt === null ? [] : [lastInterstitialAt];
  const sessionId = typeof raw.sessionId === 'string' && raw.sessionId.length > 0
    ? raw.sessionId : null;
  return {
    levelCompletes: Math.floor(nonNegative(raw.levelCompletes)),
    lastInterstitialAt,
    campaignCompletedIds: ids,
    lifetimeVisibleGameplaySec: nonNegative(raw.lifetimeVisibleGameplaySec),
    visibleGameplaySinceFullscreenSec: nonNegative(raw.visibleGameplaySinceFullscreenSec),
    visibleGameplaySinceInterstitialSec: nonNegative(raw.visibleGameplaySinceInterstitialSec === undefined
      ? raw.visibleGameplaySinceFullscreenSec : raw.visibleGameplaySinceInterstitialSec),
    rewardedCooldownActive: raw.rewardedCooldownActive === true,
    newCampaignCompletionsSinceFullscreen: Math.min(
      ids.length,
      Math.floor(nonNegative(raw.newCampaignCompletionsSinceFullscreen)),
    ),
    interstitialShownAt: timestamps,
    sessionId,
    sessionInterstitialCount: sessionId === null ? 0
      : Math.floor(nonNegative(raw.sessionInterstitialCount)),
  };
}

function skip(reason: InterstitialSkipReason): InterstitialDecision {
  return { allowed: false, reason };
}

/** Pure decision at the user's result-screen continuation, with a reason for analytics. */
export function evaluateInterstitial(meta: AdsMeta, context: InterstitialContext): InterstitialDecision {
  const cfg = context.cfg ?? MONETIZATION.interstitial;
  const state = normalizeAdsMeta(meta);
  if (!context.enabled) return skip('ads_disabled');
  if (context.removeAds) return skip('remove_ads');
  if (context.isFirstGameplaySession) return skip('first_session_protected');
  if (typeof context.campaignLevelId !== 'number' ||
      !Number.isSafeInteger(context.campaignLevelId) || context.campaignLevelId < 1) {
    return skip('not_campaign_result');
  }
  if (context.campaignLevelId <= cfg.onboardingProtectedThroughLevel) return skip('onboarding_level');
  if (Array.from({ length: cfg.onboardingProtectedThroughLevel }, (_, index) => index + 1)
    .some((id) => !state.campaignCompletedIds.includes(id))) return skip('onboarding_incomplete');
  if (context.protectedTransition) return skip('protected_transition');
  if (!context.userContinued) return skip('not_user_continuation');
  if (!context.rewardsCommitted) return skip('rewards_not_committed');
  if (!context.loaded) return skip('ad_not_loaded');
  if (!validTimestamp(context.nowMs)) return skip('invalid_time');
  if (state.campaignCompletedIds.length < cfg.minUniqueCampaignCompletions) {
    return skip('insufficient_unique_completions');
  }
  if (state.rewardedCooldownActive &&
      state.visibleGameplaySinceFullscreenSec < cfg.rewardedCooldownSec) {
    return skip('rewarded_cooldown');
  }
  if (state.visibleGameplaySinceInterstitialSec < cfg.minVisibleGameplaySinceInterstitialSec &&
      state.newCampaignCompletionsSinceFullscreen < cfg.minNewCampaignCompletionsSinceFullscreen) {
    return skip('insufficient_interstitial_interval');
  }
  return { allowed: true, reason: null };
}

/** Warm one upcoming pause, at most one campaign completion or 30 gameplay seconds ahead. */
export function shouldPreloadInterstitial(meta: AdsMeta, context: InterstitialContext): boolean {
  const state = normalizeAdsMeta(meta);
  const cfg = context.cfg ?? MONETIZATION.interstitial;
  // Warmup must not predict its way out of incomplete onboarding.
  if (state.campaignCompletedIds.length < cfg.minUniqueCampaignCompletions ||
      Array.from({ length: cfg.onboardingProtectedThroughLevel }, (_, i) => i + 1)
        .some((id) => !state.campaignCompletedIds.includes(id))) return false;
  const upcoming = recordCampaignLevelComplete(recordVisibleGameplay(state, 30), context.campaignLevelId ?? 0);
  return evaluateInterstitial(upcoming, { ...context, loaded: true, userContinued: true,
    rewardsCommitted: true }).allowed;
}

/** Compatibility facade: old callers without the safety context fail closed. */
export function shouldShowInterstitial(
  meta: AdsMeta,
  opts: Partial<InterstitialContext> & Pick<InterstitialContext, 'enabled' | 'removeAds' | 'nowMs'>,
): boolean {
  if (
    typeof opts.loaded !== 'boolean' || typeof opts.isFirstGameplaySession !== 'boolean' ||
    opts.campaignLevelId === undefined || typeof opts.userContinued !== 'boolean' ||
    typeof opts.rewardsCommitted !== 'boolean' || typeof opts.protectedTransition !== 'boolean'
  ) return false;
  return evaluateInterstitial(meta, opts as InterstitialContext).allowed;
}

/** Legacy counter only. Use recordCampaignLevelComplete for policy eligibility. */
export function recordLevelComplete(meta: AdsMeta): AdsState {
  const state = normalizeAdsMeta(meta);
  return { ...state, levelCompletes: state.levelCompletes + 1 };
}

/** Import existing campaign progress without inventing completions since the last ad. */
export function seedCampaignCompletions(meta: AdsMeta, completedIds: unknown): AdsState {
  const state = normalizeAdsMeta(meta);
  if (!Array.isArray(completedIds)) return state;
  const ids = [...new Set([
    ...state.campaignCompletedIds,
    ...completedIds.filter((id) => Number.isSafeInteger(id) && id > 0),
  ])];
  return {
    ...state,
    levelCompletes: Math.max(state.levelCompletes, ids.length),
    campaignCompletedIds: ids,
  };
}

/** One newly completed campaign puzzle advances the frequency interval once. */
export function recordCampaignLevelComplete(meta: AdsMeta, levelId: number): AdsState {
  const state = normalizeAdsMeta(meta);
  if (!Number.isSafeInteger(levelId) || levelId < 1 || state.campaignCompletedIds.includes(levelId)) {
    return state;
  }
  return {
    ...state,
    levelCompletes: state.levelCompletes + 1,
    campaignCompletedIds: [...state.campaignCompletedIds, levelId],
    newCampaignCompletionsSinceFullscreen: state.newCampaignCompletionsSinceFullscreen + 1,
  };
}

/** Caller supplies only seconds while the playable game field is foreground-visible. */
export function recordVisibleGameplay(meta: AdsMeta, seconds: number): AdsState {
  const state = normalizeAdsMeta(meta);
  if (!Number.isFinite(seconds) || seconds <= 0) return state;
  return {
    ...state,
    lifetimeVisibleGameplaySec: state.lifetimeVisibleGameplaySec + seconds,
    visibleGameplaySinceFullscreenSec: state.visibleGameplaySinceFullscreenSec + seconds,
    visibleGameplaySinceInterstitialSec: state.visibleGameplaySinceInterstitialSec + seconds,
  };
}

/** Rewarded ads add a short cooldown while preserving the next interstitial's progress. */
export function recordRewardedShown(meta: AdsMeta): AdsState {
  return {
    ...normalizeAdsMeta(meta),
    visibleGameplaySinceFullscreenSec: 0,
    rewardedCooldownActive: true,
  };
}

/** Call only after the ad SDK confirms a shown interstitial. */
export function recordInterstitialShown(meta: AdsMeta, nowMs: number, sessionId?: string): AdsState {
  const state = normalizeAdsMeta(meta);
  if (!validTimestamp(nowMs)) return state;
  const id = sessionId?.trim() || state.sessionId;
  return {
    ...state,
    lastInterstitialAt: nowMs,
    visibleGameplaySinceFullscreenSec: 0,
    visibleGameplaySinceInterstitialSec: 0,
    newCampaignCompletionsSinceFullscreen: 0,
    rewardedCooldownActive: false,
    interstitialShownAt: [...state.interstitialShownAt.filter(
      (at) => nowMs - at < INTERSTITIAL_HISTORY_WINDOW_MS,
    ), nowMs],
    sessionId: id,
    sessionInterstitialCount: id === null ? 0
      : state.sessionId === id ? state.sessionInterstitialCount + 1 : 1,
  };
}
