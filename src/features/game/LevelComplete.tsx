import { Pressable, StyleSheet, View } from 'react-native';

import { t } from '@/core/i18n';
import { AppText, colors, radius } from '@/ui';

export function LevelComplete({ coins, onNext }: { coins: number; onNext: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.scrim]}>
      <View style={styles.card}>
        <AppText preset="display">{t('levelComplete')}</AppText>
        <AppText preset="coin">+{coins} {t('coins')}</AppText>
        <Pressable onPress={onNext} style={styles.btn}>
          <AppText preset="label" style={{ color: colors.primaryText }}>
            {t('next')}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(8,12,20,0.82)', alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 28,
    alignItems: 'center',
    gap: 16,
    minWidth: 240,
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
});
