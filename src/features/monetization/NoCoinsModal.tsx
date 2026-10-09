import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ECONOMY } from '@/core/config/economy';
import { AppButton, AppText, colors, GlassPanel, Icon } from '@/ui';

/** Explicit options when a player asks for a letter without enough resources. */
export function NoCoinsModal({
  priceCoins,
  currentCoins,
  hintName = 'букву',
  canWatchAd,
  onWatchAd,
  onWheel,
  onShop,
  onClose,
  canShop = false,
}: {
  priceCoins: number;
  currentCoins: number;
  hintName?: string;
  canWatchAd: boolean;
  onWatchAd: () => void;
  onWheel: () => void;
  onShop: () => void;
  onClose: () => void;
  canShop?: boolean;
}) {
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable onPress={(event) => event.stopPropagation()}>
          <GlassPanel strong style={styles.card}>
            <Icon name="bulb" size={48} color={colors.amber} />
            <AppText preset="title" style={{ textAlign: 'center' }}>
              Нужна подсказка?
            </AppText>
            <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
              Чтобы открыть {hintName}, нужно {priceCoins} монет. Сейчас у вас {currentCoins}.
            </AppText>
            <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 4 }}>
              {canWatchAd ? (
                <AppButton label={`Посмотреть рекламу → +${ECONOMY.rewardedCoins} монет`} icon="play" variant="accent" onPress={onWatchAd} />
              ) : null}
              <AppButton label="Колесо монет" icon="wheel" variant="glass" onPress={onWheel} />
              {canShop ? <AppButton label="Магазин" icon="shop" variant="glass" onPress={onShop} /> : null}
              <AppButton label="Вернуться к игре" variant="glass" onPress={onClose} />
            </View>
          </GlassPanel>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { alignItems: 'center', gap: 12, paddingVertical: 28, paddingHorizontal: 28, minWidth: 280 },
});
