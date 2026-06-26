import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ECONOMY } from '@/core/config/economy';
import { t } from '@/core/i18n';
import { useCurrency } from '@/features/currency';
import { useDailyBonus } from '@/features/dailybonus';
import { useDailyPuzzle } from '@/features/dailypuzzle';
import { AppButton, AppText, CoinBadge, colors, GlassPanel, Icon, radius, WorldBackground } from '@/ui';

const CAL = ECONOMY.daily.loginCalendar;

export default function Daily() {
  const router = useRouter();
  const coins = useCurrency((s) => s.coins);
  const addCoins = useCurrency((s) => s.add);
  const canClaim = useDailyBonus((s) => s.canClaim());
  const claim = useDailyBonus((s) => s.claim);
  const dayIndex = useDailyBonus((s) => s.index);
  const isDone = useDailyPuzzle((s) => s.isDoneToday());
  const streak = useDailyPuzzle((s) => s.streak);
  const [claimed, setClaimed] = useState(false);

  const onClaim = () => {
    const r = claim();
    if (r.reward) {
      addCoins('coins', r.reward);
      setClaimed(true);
    }
  };

  const activeDay = canClaim ? dayIndex + 1 : dayIndex;

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
          <CoinBadge value={coins} />
        </View>

        <View style={{ padding: 16, gap: 16 }}>
          <AppText preset="display">{t('daily')}</AppText>

          <GlassPanel strong style={{ gap: 12 }}>
            <AppText preset="title">Ежедневный вход</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CAL.map((reward, i) => {
                const active = i === (activeDay - 1) % CAL.length;
                return (
                  <View
                    key={i}
                    style={{
                      width: 64,
                      paddingVertical: 10,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      gap: 2,
                      backgroundColor: active ? colors.amber : colors.glass,
                      borderWidth: 1,
                      borderColor: colors.glassBorder,
                    }}
                  >
                    <AppText preset="body" style={{ color: active ? colors.onAmber : colors.textMuted, fontSize: 12 }}>
                      Д{i + 1}
                    </AppText>
                    <AppText preset="label" style={{ color: active ? colors.onAmber : colors.text }}>
                      {reward}
                    </AppText>
                  </View>
                );
              })}
            </View>
            {canClaim && !claimed ? (
              <AppButton label="Забрать бонус" icon="coin" onPress={onClaim} />
            ) : (
              <AppText preset="body" style={{ color: colors.textMuted }}>Бонус получен. Возвращайтесь завтра!</AppText>
            )}
          </GlassPanel>

          <GlassPanel strong style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="daily" size={26} color={colors.amber} />
              <AppText preset="title" style={{ flex: 1 }}>Пазл дня</AppText>
              <AppText preset="coin">🔥 {streak}</AppText>
            </View>
            {isDone ? (
              <AppText preset="body" style={{ color: colors.textMuted }}>Сегодня решено! Серия: {streak} дн.</AppText>
            ) : (
              <AppButton label="Играть пазл дня" icon="play" onPress={() => router.push('/game?mode=daily' as never)} />
            )}
          </GlassPanel>
        </View>
      </SafeAreaView>
    </View>
  );
}
