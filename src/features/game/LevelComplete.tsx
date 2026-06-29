import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useEffect, useState } from 'react';

import { t } from '@/core/i18n';
import { AppButton, AppText, colors, GlassPanel, Icon } from '@/ui';

export function LevelComplete({
  coins,
  onNext,
  onDouble,
  canDouble = false,
  doubled = false,
}: {
  coins: number;
  onNext: () => void;
  onDouble?: () => void;
  canDouble?: boolean;
  doubled?: boolean;
}) {
  const showDouble = canDouble && !doubled && onDouble && coins > 0;
  const [shownCoins, setShownCoins] = useState(0);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setShownCoins(0);
    if (coins <= 0) return;
    const steps = 14;
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setShownCoins(Math.round((coins * current) / steps));
      if (current >= steps) clearInterval(timer);
    }, 28);
    return () => clearInterval(timer);
  }, [coins]);

  const nextOnce = () => {
    if (locked) return;
    setLocked(true);
    onNext();
  };

  return (
    <Animated.View entering={FadeIn.duration(180)} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Animated.View entering={ZoomIn.springify().damping(14)}>
        <GlassPanel strong style={styles.card}>
          <Icon name="check" size={56} color={colors.success} />
          <AppText preset="display">{t('levelComplete')}</AppText>
          <View style={styles.coins}>
            <Icon name="coin" size={22} color={colors.amber} />
            <AppText preset="title" style={{ color: colors.amber }}>
              +{shownCoins}
            </AppText>
          </View>
          {doubled ? (
            <AppText preset="body" style={{ color: colors.success }}>
              {t('doubled')}
            </AppText>
          ) : null}
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 4 }}>
            {showDouble ? (
              <AppButton label={t('doubleReward')} icon="play" variant="accent" disabled={locked} onPress={onDouble} />
            ) : null}
            <AppButton label={t('next')} icon="play" large disabled={locked} onPress={nextOnce} />
          </View>
        </GlassPanel>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { alignItems: 'center', gap: 14, paddingVertical: 32, paddingHorizontal: 32, minWidth: 270 },
  coins: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
