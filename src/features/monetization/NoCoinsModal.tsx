import { Pressable, StyleSheet, View } from 'react-native';

import { t } from '@/core/i18n';
import { AppButton, AppText, colors, GlassPanel, Icon } from '@/ui';

/**
 * Попап «не хватает монет» (спека 08). Предлагает rewarded-рекламу за монеты
 * (если доступна) и/или переход в магазин. Награда — на стороне вызывающего,
 * строго после результата 'rewarded'.
 */
export function NoCoinsModal({
  deficit,
  rewardCoins,
  canWatchAd,
  onWatchAd,
  onShop,
  onClose,
}: {
  /** Реальная нехватка монет (стоимость − текущий баланс), а не полная цена. */
  deficit: number;
  rewardCoins: number;
  canWatchAd: boolean;
  onWatchAd: () => void;
  onShop: () => void;
  onClose: () => void;
}) {
  return (
    <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose}>
      <Pressable onPress={() => {}}>
        <GlassPanel strong style={styles.card}>
          <Icon name="coin" size={48} color={colors.amber} />
          <AppText preset="title" style={{ textAlign: 'center' }}>
            {t('notEnoughCoins')}
          </AppText>
          <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
            {t('needCoins', { n: deficit })}
          </AppText>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 4 }}>
            {canWatchAd ? (
              <AppButton
                label={t('watchAdCoins', { n: rewardCoins })}
                icon="play"
                variant="accent"
                onPress={onWatchAd}
              />
            ) : null}
            <AppButton label={t('shop')} icon="shop" variant="glass" onPress={onShop} />
          </View>
        </GlassPanel>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { alignItems: 'center', gap: 12, paddingVertical: 28, paddingHorizontal: 28, minWidth: 280 },
});
