import { Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton, AppText, colors, GlassPanel, Icon } from '@/ui';

import type { SubscriptionPromptPlan } from './usePostAdSubscriptionOffer';

export function PostAdSubscriptionOffer({ plan, onShown, onLater, onSubscribe }: {
  plan: SubscriptionPromptPlan | null;
  onShown: () => void;
  onLater: () => void;
  onSubscribe: () => void;
}) {
  if (!plan) return null;
  const amount = Number(plan.amount).toLocaleString('ru-RU');
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onShow={onShown} onRequestClose={onLater}>
      <SafeAreaView style={{ flex: 1, backgroundColor: 'rgba(27, 12, 30, 0.72)', justifyContent: 'center', padding: 24 }}>
        <ScrollView bounces={false} contentInsetAdjustmentBehavior="automatic"
          style={{ flexGrow: 0 }} contentContainerStyle={{ alignItems: 'center' }}>
          <View style={{ width: '100%', maxWidth: 380 }} accessibilityViewIsModal>
            <GlassPanel tone="cream" style={{ padding: 22, gap: 16 }}>
              <View style={{ alignItems: 'center' }}><Icon name="privacy" size={36} color={colors.plum} /></View>
              <AppText preset="title" style={{ color: colors.brown, textAlign: 'center', fontSize: 24 }}>Отключить рекламу?</AppText>
              <AppText style={{ color: colors.brown, textAlign: 'center', fontSize: 16 }}>Без баннеров и рекламы между уровнями.</AppText>
              <AppText style={{ color: colors.brown, textAlign: 'center', fontSize: 14 }}>Видео за бонусы — по желанию.</AppText>
              <AppText preset="label" style={{ color: colors.plum, textAlign: 'center' }}>{amount} ₽ каждые {plan.periodDays} дней</AppText>
              <AppText style={{ color: colors.brown, textAlign: 'center', fontSize: 13 }}>Автопродление. Отмена в любой момент.</AppText>
              <AppButton label="Посмотреть подписку" variant="primary" onPress={onSubscribe} />
              <AppButton label="Позже" variant="cream" onPress={onLater} />
            </GlassPanel>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
