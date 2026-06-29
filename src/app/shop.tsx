import { useGoBack } from '@/core/nav';
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
  radius,
  WorldBackground,
} from '@/ui';

export default function Shop() {
  const goBack = useGoBack();
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
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
          <CoinBadge value={coins} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <AppText preset="display">{t('shop')}</AppText>

          <View style={{ gap: 12 }}>
            {ECONOMY.packs.map((p, index) => {
              const best = index === 1;
              return (
                <GlassPanel key={p.id} strong style={[row, { gap: 10, borderColor: best ? colors.gridHint : colors.glassBorder }]}>
                  <View style={{ width: 48 + index * 4, height: 48 + index * 4, borderRadius: radius.pill, backgroundColor: best ? colors.amber : colors.offline, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="coin" size={25 + index * 2} color={best ? colors.onAmber : colors.amber} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {best ? (
                      <View style={{ alignSelf: 'flex-start', borderRadius: radius.pill, backgroundColor: colors.amber, paddingVertical: 2, paddingHorizontal: 7, marginBottom: 2 }}>
                        <AppText preset="body" style={{ color: colors.onAmber, fontSize: 10 }}>выгодно</AppText>
                      </View>
                    ) : null}
                    <AppText preset="title" style={{ fontSize: 18 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>{p.coins} монет</AppText>
                    <AppText preset="body" style={{ color: colors.textMuted, fontSize: 13 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                      {index === 0 ? 'Малый запас подсказок' : index === 1 ? 'Баланс цены и монет' : 'Для длинного путешествия'}
                    </AppText>
                  </View>
                  <AppButton label={p.price} variant="accent" onPress={() => buy(p.id, p.coins)} style={{ paddingHorizontal: 14, minHeight: 50 }} />
                </GlassPanel>
              );
            })}
          </View>

          <GlassPanel strong style={{ gap: 12 }}>
            <AppText preset="title">Комфорт</AppText>
            <View style={row}>
              <Icon name="play" size={28} color={colors.success} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText preset="label">Без рекламы</AppText>
                <AppText preset="body" style={{ color: colors.textMuted }} numberOfLines={2}>Убрать баннер и межстраничную</AppText>
              </View>
              <AppButton label={ECONOMY.removeAdsPrice} onPress={() => buy(PRODUCT_IDS.removeAds)} style={{ paddingHorizontal: 18 }} />
            </View>
            <View style={row}>
              <Icon name="star" size={28} color={colors.amber} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText preset="label">Pro-подписка</AppText>
                <AppText preset="body" style={{ color: colors.textMuted }} numberOfLines={2}>×2 бонус, подсказки, без рекламы</AppText>
              </View>
              <AppButton label={ECONOMY.proWeeklyPrice} onPress={() => buy(PRODUCT_IDS.proWeekly)} style={{ paddingHorizontal: 18 }} />
            </View>
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14 };
