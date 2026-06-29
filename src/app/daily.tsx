import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ECONOMY } from '@/core/config/economy';
import { t } from '@/core/i18n';
import { useGoBack } from '@/core/nav';
import { dayKey } from '@/core/time';
import { track } from '@/features/analytics';
import { useCurrency } from '@/features/currency';
import { claimLoginBonus, useDailyBonus } from '@/features/dailybonus';
import { useDailyPuzzle } from '@/features/dailypuzzle';
import { AppButton, AppText, CoinBadge, colors, GlassPanel, Icon, radius, WorldBackground } from '@/ui';

const CAL = ECONOMY.daily.loginCalendar;

export default function Daily() {
  const router = useRouter();
  const goBack = useGoBack();
  const coins = useCurrency((s) => s.coins);
  const addCoins = useCurrency((s) => s.add);
  const canClaim = useDailyBonus((s) => s.canClaim());
  const claim = useDailyBonus((s) => s.claim);
  const dayIndex = useDailyBonus((s) => s.index);
  const lastDay = useDailyBonus((s) => s.lastDay);
  const isDone = useDailyPuzzle((s) => s.isDoneToday());
  const streak = useDailyPuzzle((s) => s.streak);
  const [claimed, setClaimed] = useState(false);

  const onClaim = () => {
    const r = claim();
    if (r.reward) {
      addCoins('coins', r.reward);
      track('daily_bonus_claimed', { day: r.day, reward: r.reward });
      track('coins_earned', { reason: 'daily_bonus', amount: r.reward });
      setClaimed(true);
    }
  };

  // Подсвечиваем тот день, который сейчас актуален: если бонус доступен — тот, что
  // заберём следующим (та же логика, что и в claimLoginBonus, включая сброс серии);
  // если уже забрали сегодня — полученный сегодня день. 1-based → индекс.
  const activeIdx =
    (claimLoginBonus({ lastDay, index: dayIndex }, dayKey()).day - 1) % CAL.length;

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
          <CoinBadge value={coins} />
        </View>

        <View style={{ padding: 16, gap: 16 }}>
          <AppText preset="display">{t('daily')}</AppText>

          <GlassPanel strong style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 58, height: 58, borderRadius: radius.pill, backgroundColor: colors.offline, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="daily" size={30} color={colors.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText preset="title">Ежедневный вход</AppText>
                <AppText preset="body" style={{ color: colors.textMuted }}>Вчера · Сегодня · Завтра · День 7</AppText>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {CAL.map((reward, i) => {
                const active = i === activeIdx;
                const show = i === Math.max(0, activeIdx - 1) || active || i === Math.min(CAL.length - 1, activeIdx + 1) || i === CAL.length - 1;
                if (!show) return null;
                return (
                  <View
                    key={i}
                    style={{
                      flex: active ? 1.25 : 1,
                      minHeight: active ? 82 : 68,
                      paddingVertical: 10,
                      borderRadius: radius.lg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      backgroundColor: active ? colors.amber : colors.glass,
                      borderWidth: 1,
                      borderColor: active ? colors.gridHint : colors.glassBorder,
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

          <GlassPanel strong style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' }}>
                <AppText preset="title">{streak}</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText preset="title">Пазл дня</AppText>
                <AppText preset="body" style={{ color: colors.textMuted }}>Серия возвращений</AppText>
              </View>
            </View>
            {isDone ? (
              <AppText preset="body" style={{ color: colors.textMuted }}>Сегодня решено! Серия: {streak} дн.</AppText>
            ) : (
              <Pressable onPress={() => router.push('/game?mode=daily' as never)} style={({ pressed }) => ({ minHeight: 58, borderRadius: radius.pill, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                <AppText preset="title">Играть пазл дня</AppText>
              </Pressable>
            )}
          </GlassPanel>
        </View>
      </SafeAreaView>
    </View>
  );
}
