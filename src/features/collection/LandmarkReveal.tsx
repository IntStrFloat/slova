import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import type { Landmark } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import { AppButton, AppText, colors, GlassPanel, radius } from '@/ui';

/**
 * Оверлей достопримечательности: фото + факт (спека 07).
 * `isNew` — баннер «Новое место открыто!» показываем только при реальном открытии,
 * но не при повторном просмотре карточки из Коллекции (компонент переиспользуется).
 */
export function LandmarkReveal({
  landmark,
  onClose,
  isNew = true,
}: {
  landmark: Landmark;
  onClose: () => void;
  isNew?: boolean;
}) {
  return (
    <Animated.View entering={FadeIn.duration(180)} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <GlassPanel strong style={styles.card}>
        {isNew ? (
          <AppText preset="body" style={{ color: colors.amber }}>
            Новое место открыто!
          </AppText>
        ) : null}
        <Animated.View entering={ZoomIn.springify().damping(15)} style={styles.photoWrap}>
          <Image source={landmark.image} style={styles.photo} contentFit="cover" />
        </Animated.View>
        <Animated.View entering={FadeIn.delay(120).duration(220)}>
          <AppText preset="display" style={{ textAlign: 'center' }}>
            {landmark.title}
          </AppText>
        </Animated.View>
        <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
          {landmark.fact}
        </AppText>
        <AppButton label={t('next')} icon="check" large onPress={onClose} />
      </GlassPanel>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { alignItems: 'center', gap: 14, maxWidth: 360, padding: 16 },
  photoWrap: { width: 300, maxWidth: '100%', aspectRatio: 1.35, borderRadius: radius.lg, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
});
