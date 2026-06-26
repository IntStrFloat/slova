import { StyleSheet, View } from 'react-native';

import { t } from '@/core/i18n';
import { AppButton, AppText, colors, GlassPanel, Icon } from '@/ui';

export function LevelComplete({ coins, onNext }: { coins: number; onNext: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.scrim]}>
      <GlassPanel strong style={styles.card}>
        <Icon name="check" size={56} color={colors.success} />
        <AppText preset="display">{t('levelComplete')}</AppText>
        <View style={styles.coins}>
          <Icon name="coin" size={22} color={colors.amber} />
          <AppText preset="title" style={{ color: colors.amber }}>
            +{coins}
          </AppText>
        </View>
        <AppButton label={t('next')} icon="play" large onPress={onNext} />
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { alignItems: 'center', gap: 14, paddingVertical: 32, paddingHorizontal: 32, minWidth: 270 },
  coins: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
