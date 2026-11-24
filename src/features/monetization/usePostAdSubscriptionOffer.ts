import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { MONETIZATION } from '@/core/config/monetization';
import { isYandexGamesBuild } from '@/core/platform/yandexGames';
import { KEYS, setString } from '@/core/storage';
import { trackSubscription } from '@/features/analytics/subscription';

import { useEntitlements } from './entitlements';
import { useSubscription } from './subscription';
import { recordSubscriptionOfferInterstitial, reserveSubscriptionOffer } from './subscriptionOfferProgress';

export type SubscriptionPromptResult = 'continue' | 'subscribe' | 'aborted';
export interface SubscriptionPromptPlan { amount: string; periodDays: number }
type Presentation = {
  plan: SubscriptionPromptPlan;
  shown: boolean;
  resolve: (result: SubscriptionPromptResult) => void;
};

/** The result's Continue action waits here, keeping its committed reward on screen. */
export function usePostAdSubscriptionOffer() {
  const [prompt, setPrompt] = useState<SubscriptionPromptPlan | null>(null);
  const pending = useRef<Presentation | null>(null);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');

  const finish = useCallback((result: SubscriptionPromptResult, reason?: string) => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    setPrompt(null);
    if (reason && current.shown) {
      trackSubscription('subscription_offer_dismissed', { source: 'post_ad', mode: 'live', reason });
    }
    current.resolve(result);
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; finish('aborted', 'screen_blur'); };
  }, [finish]));

  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (!foreground.current) finish('aborted', 'background');
    });
    const stopIfUnavailable = () => {
      if (!pending.current) return;
      const billing = useSubscription.getState();
      if (useEntitlements.getState().removeAds || !billing.status || billing.status.active || billing.status.autoRenew
        || billing.hasPendingCheckout || billing.status?.pendingPaymentId || billing.needsMigration
        || billing.error || billing.catalog?.mode !== 'live' || !billing.catalog.available
        || billing.catalog.plan.amount !== pending.current.plan.amount
        || billing.catalog.plan.periodDays !== pending.current.plan.periodDays) finish('continue', 'unavailable');
    };
    const subscription = useSubscription.subscribe(stopIfUnavailable);
    const entitlement = useEntitlements.subscribe(stopIfUnavailable);
    return () => {
      appState.remove(); subscription(); entitlement();
      const current = pending.current;
      pending.current = null;
      current?.resolve('aborted');
    };
  }, [finish]);

  const afterInterstitial = useCallback((completedLevels: number): Promise<SubscriptionPromptResult> => {
    recordSubscriptionOfferInterstitial();
    const billing = useSubscription.getState();
    // The SDK may dismiss after the player has already left this screen.
    if (!focused.current || !foreground.current) return Promise.resolve('aborted');
    if (pending.current || !MONETIZATION.subscriptionVisible
      || isYandexGamesBuild() || !Number.isSafeInteger(completedLevels)
      || completedLevels < MONETIZATION.subscriptionOffer.minCompletedLevels
      || useEntitlements.getState().removeAds || billing.busy || billing.error || billing.needsMigration
      || billing.hasPendingCheckout || !billing.status || billing.status.active || billing.status.autoRenew
      || billing.status.pendingPaymentId || !billing.catalog?.available || billing.catalog.mode !== 'live'
      || !reserveSubscriptionOffer(Date.now())) return Promise.resolve('continue');

    const plan = { amount: billing.catalog.plan.amount, periodDays: billing.catalog.plan.periodDays };
    return new Promise((resolve) => {
      pending.current = { plan, shown: false, resolve };
      setPrompt(plan);
    });
  }, []);

  const onShown = useCallback(() => {
    const current = pending.current;
    if (!current || current.shown || !focused.current || !foreground.current) return;
    current.shown = true;
    trackSubscription('subscription_offer_shown', { source: 'post_ad', mode: 'live',
      amount: Number(current.plan.amount), periodDays: current.plan.periodDays, trigger: 'interstitials' });
  }, []);
  const onLater = useCallback(() => {
    if (!pending.current) return;
    setString(KEYS.subscriptionOfferDismissedUntil, String(Date.now() + MONETIZATION.subscriptionOffer.dismissForMs));
    finish('continue', 'later');
  }, [finish]);
  const onSubscribe = useCallback(() => {
    if (!pending.current) return;
    trackSubscription('subscription_offer_clicked', { source: 'post_ad', mode: 'live' });
    finish('subscribe');
  }, [finish]);

  return { prompt, afterInterstitial, onShown, onLater, onSubscribe };
}
