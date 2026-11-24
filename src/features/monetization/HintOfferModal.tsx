import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { track, trackOnce } from '@/features/analytics';
import { type HelpAnalyticsContext, selectHelpContext } from '@/features/analytics/helpContext';
import { AppButton, AppText, colors, GlassPanel, Icon } from '@/ui';
import { newMonetizationId } from './adTelemetry';
import { rewardedStateMessage } from './rewardedState';
import type { RewardedState } from './types';

type Action = (interactionId?: string, modalId?: string) => unknown | Promise<unknown>;

/** A selected hint has one acquisition choice; the wheel remains on its own screen. */
export function HintOfferModal({
  requestedHint, priceCoins, currentCoins, canWatchAd, rewardedEligible, rewardedState,
  earned = false, busy = false, recoveryChecking = false, routeFocused = true,
  errorMessage, helpContext, onWatchAd, onApplyHint, onRecoverReward, onClose,
}: {
  requestedHint: 'letter' | 'semantic';
  priceCoins: number;
  currentCoins: number;
  canWatchAd: boolean;
  rewardedEligible: boolean;
  rewardedState: RewardedState;
  earned?: boolean;
  busy?: boolean;
  recoveryChecking?: boolean;
  routeFocused?: boolean;
  errorMessage?: string | null;
  helpContext?: HelpAnalyticsContext;
  onWatchAd: Action;
  onApplyHint?: Action;
  onRecoverReward?: Action;
  onClose: () => void;
}) {
  const [modalId] = useState(() => newMonetizationId('hintoffer'));
  const selecting = useRef(false);
  const context = selectHelpContext(helpContext);
  const contextRef = useRef(context);
  useLayoutEffect(() => { contextRef.current = context; });
  const affordable = currentCoins >= priceCoins && Boolean(onApplyHint);
  const hint = requestedHint === 'letter' ? 'букву' : 'наводку';
  const recovery = !earned && Boolean(onRecoverReward);
  const apply = earned || affordable;
  const action = recovery ? onRecoverReward : apply ? onApplyHint : onWatchAd;
  const disabled = recovery ? recoveryChecking : busy || (apply ? !onApplyHint : !canWatchAd);

  useEffect(() => {
    if (!routeFocused) return;
    trackOnce('no_coins_shown', modalId, { ...contextRef.current, modal_id: modalId,
      cost: priceCoins, coins: currentCoins, rewarded_state: rewardedState,
      rewarded_eligible: rewardedEligible });
    // The exposure is once per mounted offer; changing readiness is not another exposure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalId, routeFocused]);

  useEffect(() => {
    if (!routeFocused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [onClose, routeFocused]);

  const select = async () => {
    if (disabled || !action || selecting.current) return;
    selecting.current = true;
    const interactionId = newMonetizationId('hintofferaction');
    try {
      track('no_coins_action', { ...contextRef.current, modal_id: modalId, interaction_id: interactionId,
        action: recovery ? 'recover_reward' : apply ? 'apply_hint' : 'rewarded',
        cost: priceCoins, coins: currentCoins });
      await action(interactionId, modalId);
    } finally { selecting.current = false; }
  };

  if (!routeFocused) return null;
  return (
    <View testID="hint-offer-overlay" style={styles.overlay} accessibilityViewIsModal onAccessibilityEscape={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
      <ScrollView style={styles.viewport} contentContainerStyle={styles.content} bounces={false}>
        <GlassPanel tone="cream" style={styles.card}>
          <View style={styles.symbol}><Icon name="bulb" size={32} color={colors.plum} /></View>
          <AppText preset="title" accessibilityRole="header" style={styles.title}>
            {earned ? 'Подсказка заработана' : affordable ? 'Монет хватает на подсказку' : 'Подсказка без монет?'}
          </AppText>
          <AppText preset="body" style={styles.description}>
            {earned ? `Откроем ${hint}. Повторно смотреть рекламу не нужно.`
              : affordable ? `Открыть ${hint} за ${priceCoins} монет?`
                : `Посмотрите рекламу — откроем ${hint}. Ваши монеты останутся у вас.`}
          </AppText>
          {errorMessage ? <AppText preset="body" accessibilityRole="alert" style={styles.description}>{errorMessage}</AppText> : null}
          {!apply && !recovery && !canWatchAd && !errorMessage ? (
            <AppText preset="body" accessibilityLiveRegion="polite" style={styles.status}>
              {rewardedEligible ? rewardedStateMessage(rewardedState) : 'На сегодня подсказки за рекламу закончились.'}
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <AppButton variant="accent" icon={!apply && !recovery ? 'play' : 'bulb'}
              label={recovery ? 'Повторить проверку награды' : earned ? `Открыть ${hint}`
                : affordable ? `Открыть за ${priceCoins} монет` : 'Да, за рекламу'}
              disabled={disabled} onPress={() => { void select(); }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Не сейчас" onPress={onClose} style={styles.decline}>
              <AppText preset="label" style={{ color: colors.brown }}>Не сейчас</AppText>
            </Pressable>
          </View>
        </GlassPanel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, elevation: 20, justifyContent: 'center',
    alignItems: 'center', padding: 20, backgroundColor: colors.scrim },
  viewport: { flexGrow: 0, maxHeight: '90%', width: '100%', maxWidth: 380 },
  content: { flexGrow: 1 },
  card: { paddingHorizontal: 22, paddingVertical: 20, gap: 12, alignItems: 'center' },
  symbol: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.creamDeep,
    alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.plum, textAlign: 'center', fontSize: 23, lineHeight: 29 },
  description: { color: colors.brown, textAlign: 'center', fontSize: 15, lineHeight: 22 },
  status: { color: colors.brown, textAlign: 'center', fontSize: 13, lineHeight: 18 },
  actions: { alignSelf: 'stretch', gap: 4, marginTop: 4 },
  decline: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
});
