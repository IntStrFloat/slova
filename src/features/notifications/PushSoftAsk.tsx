import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton, AppText, colors, GlassPanel } from '@/ui';

export function PushSoftAsk({
  visible,
  onAllow,
  onDecline,
  onDismiss,
}: {
  visible: boolean;
  onAllow: () => void;
  onDecline?: () => void;
  onDismiss: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = height < 700 || width < 350;
  const maxHeight = Math.max(240, height - insets.top - insets.bottom - 32);
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onDismiss}>
      <View
        style={{
          flex: 1,
          paddingHorizontal: compact ? 16 : 24,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(29, 17, 40, 0.72)',
        }}
      >
        <GlassPanel tone="cream" style={{ width: '100%', maxWidth: 380, maxHeight, padding: compact ? 12 : 18, alignItems: 'center', gap: compact ? 8 : 14 }}>
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Закрыть предложение"
            style={{ alignSelf: 'flex-end', flexShrink: 0, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
            <AppText preset="body" style={{ color: colors.brown, fontSize: 26 }}>×</AppText>
          </Pressable>
          <AppText preset="title" maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ color: colors.brown, fontSize: compact ? 18 : 21, textAlign: 'center', flexShrink: 0 }}>
            Напомнить завтра?
          </AppText>
          <ScrollView style={{ width: '100%', flexShrink: 1 }} contentContainerStyle={{ paddingVertical: 4 }}>
            <AppText preset="body" style={{ color: colors.brown, fontSize: compact ? 14 : 16, textAlign: 'center' }}>
              Завтра вас ждёт новый кроссворд и подарок. Напомним вечером, если кроссворд ещё не решён. Напоминания можно отключить в настройках.
            </AppText>
          </ScrollView>
          <View style={{ width: '100%', flexShrink: 0, gap: 10, marginTop: 4 }}>
            <AppButton label="Напомнить завтра" icon="notifications" onPress={onAllow} />
            <AppButton label="Не нужно" variant="glass" onPress={onDecline ?? onDismiss} />
          </View>
        </GlassPanel>
      </View>
    </Modal>
  );
}
