import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ECONOMY } from '@/core/config/economy';
import { t } from '@/core/i18n';
import { useCurrency } from '@/features/currency';
import { getIap, PRODUCT_IDS, useEntitlements } from '@/features/monetization';
import {
  AppButton,
  AppText,
  CoinBadge,
  colors,
  GlassPanel,
  Icon,
  WorldBackground,
} from '@/ui';

export default function Shop() {
  const router = useRouter();
  const coins = useCurrency((s) => s.coins);
  const addCoins = useCurrency((s) => s.add);
  const setRemoveAds = useEntitlements((s) => s.setRemoveAds);
  const setProUntil = useEntitlements((s) => s.setProUntil);

  const buy = async (id: string, grantCoins?: number) => {
    const res = await getIap().purchase(id);
    if (res === 'purchased') {
      if (grantCoins) addCoins('coins', grantCoins);
      if (id === PRODUCT_IDS.removeAds) setRemoveAds(true);
      if (id === PRODUCT_IDS.proWeekly) setProUntil(Date.now() + 7 * 86_400_000);
    }
    // Noop/iapEnabled=false → 'failed': каталог виден, покупка включится с RuStore Billing.
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
          <CoinBadge value={coins} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <AppText preset="display">{t('shop')}</AppText>

          {ECONOMY.packs.map((p) => (
            <GlassPanel key={p.id} strong style={row}>
              <Icon name="coin" size={30} color={colors.amber} />
              <View style={{ flex: 1 }}>
                <AppText preset="title">{p.coins} монет</AppText>
              </View>
              <AppButton label={p.price} variant="accent" onPress={() => buy(p.id, p.coins)} />
            </GlassPanel>
          ))}

          <GlassPanel strong style={row}>
            <Icon name="play" size={28} color={colors.success} />
            <View style={{ flex: 1 }}>
              <AppText preset="title">Без рекламы</AppText>
              <AppText preset="body" style={{ color: colors.textMuted }}>Убрать баннер и межстраничную</AppText>
            </View>
            <AppButton label={ECONOMY.removeAdsPrice} onPress={() => buy(PRODUCT_IDS.removeAds)} />
          </GlassPanel>

          <GlassPanel strong style={row}>
            <Icon name="leaderboard" size={28} color={colors.amber} />
            <View style={{ flex: 1 }}>
              <AppText preset="title">Pro-подписка</AppText>
              <AppText preset="body" style={{ color: colors.textMuted }}>×2 бонус, подсказки, без рекламы</AppText>
            </View>
            <AppButton label={ECONOMY.proWeeklyPrice} onPress={() => buy(PRODUCT_IDS.proWeekly)} />
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14 };
