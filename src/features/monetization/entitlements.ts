import { create } from 'zustand';

import type { SubscriptionStatus } from '@/core/net';
import { isYandexGamesBuild } from '@/core/platform/yandexGames';
import { getJSON, KEYS, setJSON } from '@/core/storage';
import { trackSubscription } from '@/features/analytics/subscription';
import { newMonetizationId } from './adTelemetry';

interface Saved {
  schemaVersion?: number;
  removeAds?: boolean;
  permanentRemoveAds?: boolean;
  proUntil?: number | null;
  subscriptionUntil?: number | null;
  subscriptionOwnerId?: string | null;
  subscriptionExpiresAt?: number | null;
  subscriptionAnalyticsMode?: 'live' | 'test' | 'disabled' | 'unknown';
}

interface EntitlementsState {
  removeAds: boolean;
  permanentRemoveAds: boolean;
  proUntil: number | null;
  subscriptionUntil: number | null;
  subscriptionOwnerId: string | null;
  /** Local deadline derived from the server clock, without changing the paid period. */
  subscriptionExpiresAt: number | null;
  subscriptionAnalyticsMode: 'live' | 'test' | 'disabled' | 'unknown';
  isPro: () => boolean;
  setRemoveAds: (value: boolean) => void;
  setProUntil: (untilMs: number | null) => void;
  applySubscription: (userId: string, status: SubscriptionStatus, mode?: 'live' | 'test' | 'disabled' | 'unknown') => void;
  refreshExpiration: (nowMs?: number) => void;
  clearSubscription: () => void;
}

const saved = getJSON<Saved>(KEYS.entitlements, {});
const profile = getJSON<{ userId?: string } | null>(KEYS.profile, null);
const permanentRemoveAds = saved.permanentRemoveAds === true
  || (saved.permanentRemoveAds === undefined && saved.schemaVersion !== 2 && saved.removeAds === true);
const cachedSubscription = !isYandexGamesBuild() && profile?.userId === saved.subscriptionOwnerId
  && typeof saved.subscriptionUntil === 'number' && Number.isFinite(saved.subscriptionUntil)
  && typeof saved.subscriptionExpiresAt === 'number' && Number.isFinite(saved.subscriptionExpiresAt)
  && saved.subscriptionExpiresAt > Date.now();

function persist(state: EntitlementsState): void {
  setJSON(KEYS.entitlements, {
    schemaVersion: 2,
    // Keep this legacy field permanent-only so a timed grant never migrates into a lifetime purchase.
    removeAds: state.permanentRemoveAds,
    permanentRemoveAds: state.permanentRemoveAds,
    proUntil: state.proUntil,
    subscriptionUntil: state.subscriptionUntil,
    subscriptionOwnerId: state.subscriptionOwnerId,
    subscriptionExpiresAt: state.subscriptionExpiresAt,
    subscriptionAnalyticsMode: state.subscriptionAnalyticsMode,
  });
}

function observeSubscriptionChange(previous: EntitlementsState, next: EntitlementsState, source: 'sync' | 'expiration' | 'clear') {
  if (previous.subscriptionUntil === next.subscriptionUntil && previous.subscriptionOwnerId === next.subscriptionOwnerId) return;
  const revision = newMonetizationId('en');
  trackSubscription('subscription_entitlement_changed', {
    entitlement_revision: revision,
    old_status: previous.subscriptionUntil !== null ? 'active' : 'inactive',
    new_status: next.subscriptionUntil !== null ? 'active' : 'inactive',
    source: 'direct', trigger: source === 'sync' ? 'poll' : 'manual',
    mode: next.subscriptionUntil !== null ? next.subscriptionAnalyticsMode : previous.subscriptionAnalyticsMode,
    policy_version: 'server_verified_v1',
  }, revision);
}

export const useEntitlements = create<EntitlementsState>((set, get) => ({
  removeAds: permanentRemoveAds || cachedSubscription,
  permanentRemoveAds,
  proUntil: saved.proUntil ?? null,
  subscriptionUntil: cachedSubscription ? saved.subscriptionUntil! : null,
  subscriptionOwnerId: cachedSubscription ? saved.subscriptionOwnerId! : null,
  subscriptionExpiresAt: cachedSubscription ? saved.subscriptionExpiresAt! : null,
  subscriptionAnalyticsMode: saved.subscriptionAnalyticsMode ?? 'unknown',
  isPro: () => {
    const until = get().proUntil;
    return until !== null && until > Date.now();
  },
  setRemoveAds: (value) => {
    const until = get().subscriptionExpiresAt;
    set({ permanentRemoveAds: value, removeAds: value || (until !== null && until > Date.now()) });
    persist(get());
  },
  setProUntil: (untilMs) => {
    set({ proUntil: untilMs });
    persist(get());
  },
  applySubscription: (userId, status, mode = 'unknown') => {
    const previous = get();
    const valid = !isYandexGamesBuild() && userId.length > 0 && status.active === true
      && typeof status.activeUntil === 'number' && Number.isFinite(status.activeUntil)
      && Number.isFinite(status.serverTime) && status.activeUntil > status.serverTime;
    if (!valid) {
      get().clearSubscription();
      return;
    }
    const subscriptionExpiresAt = Date.now() + (status.activeUntil! - status.serverTime);
    set({
      subscriptionUntil: status.activeUntil,
      subscriptionOwnerId: userId,
      subscriptionExpiresAt,
      subscriptionAnalyticsMode: mode,
      removeAds: true,
    });
    persist(get());
    observeSubscriptionChange(previous, get(), 'sync');
  },
  refreshExpiration: (nowMs = Date.now()) => {
    const state = get();
    if (state.subscriptionExpiresAt !== null && state.subscriptionExpiresAt <= nowMs) {
      state.clearSubscription();
    }
  },
  clearSubscription: () => {
    const previous = get();
    set({
      subscriptionUntil: null,
      subscriptionOwnerId: null,
      subscriptionExpiresAt: null,
      removeAds: get().permanentRemoveAds,
    });
    persist(get());
    observeSubscriptionChange(previous, get(), 'clear');
  },
}));

persist(useEntitlements.getState());
