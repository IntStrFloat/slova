import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { Landmark } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import { AppButton, AppText, colors, GlassPanel, radius } from '@/ui';

/** Оверлей открытия достопримечательности: фото + факт (спека 07). */
export function LandmarkReveal({ landmark, onClose }: { landmark: Landmark; onClose: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.scrim]}>
      <GlassPanel strong style={styles.card}>
        <AppText preset="body" style={{ color: colors.amber }}>
          Новое место открыто!
        </AppText>
        <Image source={landmark.image} style={styles.photo} contentFit="cover" />
        <AppText preset="display" style={{ textAlign: 'center' }}>
          {landmark.title}
        </AppText>
        <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
          {landmark.fact}
        </AppText>
        <AppButton label={t('next')} icon="check" large onPress={onClose} />
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { alignItems: 'center', gap: 14, maxWidth: 340 },
  photo: { width: 240, height: 180, borderRadius: radius.md },
});
