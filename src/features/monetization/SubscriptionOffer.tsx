import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { MONETIZATION } from '@/core/config/monetization';
import { isYandexGamesBuild } from '@/core/platform/yandexGames';
import { getString, KEYS, setString } from '@/core/storage';
import { trackSubscription } from '@/features/analytics/subscription';
import { AppText, colors, GlassPanel, Icon, radius } from '@/ui';

import { useEntitlements } from './entitlements';
import { useSubscription } from './subscription';

function readDismissedUntil(): number {
  const value = Number(getString(KEYS.subscriptionOfferDismissedUntil));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The screen owns this model so its viewport can measure the eligible card. */
export function useSubscriptionOffer(completedLevels: number) {
  const router = useRouter();
  const removeAds = useEntitlements((state) => state.removeAds);
  const { catalog, status, busy, error, hasPendingCheckout, needsMigration } = useSubscription();
  const [dismissedUntil, setDismissedUntil] = useState(readDismissedUntil);
  const [now, setNow] = useState(Date.now);
  const shownDuringVisit = useRef(false);

  useFocusEffect(useCallback(() => {
    shownDuringVisit.current = false;
    setNow(Date.now());
    setDismissedUntil(readDismissedUntil());
  }, []));

  const visible = !(!MONETIZATION.subscriptionVisible || isYandexGamesBuild()
    || completedLevels < MONETIZATION.subscriptionOffer.minCompletedLevels
    || removeAds || busy || error || needsMigration || hasPendingCheckout
    || !status || status.active || status.autoRenew || status.pendingPaymentId
    || !catalog?.available || catalog.mode !== 'live' || now < dismissedUntil);

  const amount = Number(catalog?.plan.amount);
  const price = catalog ? `${amount.toLocaleString('ru-RU')} ₽ / ${catalog.plan.periodDays} дней` : '';
  const analytics = { source: 'home_card', mode: catalog?.mode, amount, periodDays: catalog?.plan.periodDays };
  const dismiss = () => {
    if (!visible || Date.now() < readDismissedUntil()) return;
    const until = Date.now() + MONETIZATION.subscriptionOffer.dismissForMs;
    setString(KEYS.subscriptionOfferDismissedUntil, String(until));
    setDismissedUntil(until);
    trackSubscription('subscription_offer_dismissed', analytics);
  };
  const open = () => {
    if (!visible || Date.now() < readDismissedUntil()) return;
    trackSubscription('subscription_offer_clicked', analytics);
    router.push({ pathname: '/shop', params: { source: 'home_card' } });
  };
  const trackShown = () => {
    if (!visible || shownDuringVisit.current || Date.now() < readDismissedUntil()) return;
    shownDuringVisit.current = true;
    trackSubscription('subscription_offer_shown', analytics);
  };
  return { visible, price, dismiss, open, trackShown };
}

/** A dismissible home card, never a modal or an interruption to a level. */
export function SubscriptionOffer({ offer }: { offer: ReturnType<typeof useSubscriptionOffer> }) {
  if (!offer.visible) return null;

  return (
    <GlassPanel tone="cream" style={{ padding: 12, gap: 8, borderBottomWidth: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="privacy" size={22} color={colors.plum} />
        <AppText preset="label" style={{ flex: 1, color: colors.brown }}>Отключить рекламу?</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Скрыть предложение на неделю"
          onPress={offer.dismiss} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <AppText style={{ fontSize: 12, color: colors.brown }}>Позже</AppText>
        </Pressable>
      </View>
      <AppText style={{ fontSize: 13, color: colors.brown }}>Без баннеров и рекламных пауз. Видео за бонусы — по желанию.</AppText>
      <Pressable accessibilityRole="button" accessibilityLabel={`Подписка · ${offer.price}`}
        onPress={offer.open} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', alignItems: 'center',
          padding: 10, borderRadius: radius.pill, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.goldBorder,
          backgroundColor: pressed ? colors.creamDeep : colors.cream })}>
        <AppText preset="label" style={{ textAlign: 'center', color: colors.brown }}>{`Подписка · ${offer.price}`}</AppText>
      </Pressable>
      <AppText style={{ fontSize: 12, color: colors.brown }}>С автопродлением. Отменить можно в любой момент.</AppText>
    </GlassPanel>
  );
}
