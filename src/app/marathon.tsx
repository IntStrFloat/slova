import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGoBack } from '@/core/nav';
import { totalCampaignLevels } from '@/core/config/worlds';
import { track } from '@/features/analytics';
import { useCurrency } from '@/features/currency';
import { applyMarathonCoinsOnce } from '@/features/game/marathonRewards';
import { loadGameSnapshot } from '@/features/game/persistence';
import { loadGlobalLevel, useLevels } from '@/features/levels';
import { getMarathonStatus, recoverMarathonProgress, reconcileMarathonRewards, useMarathon } from '@/features/marathon';
import { getFeatureGates, useRetention } from '@/features/retention';
import { pendingNormalResultLevel } from '@/features/retention-ui/homeModel';
import { startFocusedRefresh } from '@/features/retention-ui/foregroundRefresh';
import { ruCount } from '@/features/retention-ui/text';
import { AppButton, AppText, CoinBadge, colors, GlassPanel, Icon, radius, WorldBackground } from '@/ui';

export default function Marathon() {
  const router = useRouter();
  const goBack = useGoBack();
  const marathon = useMarathon();
  const coins = useCurrency((state) => state.coins);
  const currentLevel = useLevels((state) => state.currentLevel);
  const [now, setNow] = useState(Date.now);
  const [saveError, setSaveError] = useState(false);
  const event = getMarathonStatus(marathon, now);
  const campaignComplete = currentLevel > totalCampaignLevels()
    && pendingNormalResultLevel(loadGameSnapshot('normal'), loadGlobalLevel) === null;
  const canPlayDaily = getFeatureGates(useRetention()).daily;
  const playRoute = campaignComplete ? canPlayDaily ? '/daily?source=marathon' : '/collection' : '/game?source=marathon';
  const playLabel = campaignComplete ? canPlayDaily ? 'Кроссворд текущего дня' : 'Открыть альбом'
    : event.status === 'active' ? 'Играть в марафоне' : 'Играть обычные уровни';
  const refresh = useCallback(() => {
    setNow(Date.now());
    try {
      recoverMarathonProgress(useRetention.getState());
      reconcileMarathonRewards(applyMarathonCoinsOnce);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    track('marathon_screen_viewed', { status: getMarathonStatus(useMarathon.getState(), Date.now()).status });
    return startFocusedRefresh(refresh);
  }, [refresh]));
  const wonStages = event.tiers.filter((tier) => tier.completed).length;

  return <View style={{ flex: 1 }}>
    <Stack.Screen options={{ title: 'Марафон слов' }} />
    <WorldBackground world="world1" />
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <AppButton label="Назад" variant="glass" icon="back" onPress={goBack} />
        <CoinBadge value={coins} />
      </View>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }}>
        <View style={{ padding: 16, gap: 6, borderRadius: radius.md, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.glassBorder }}>
          <AppText preset="display" style={{ fontSize: 26 }}>Марафон слов</AppText>
          <AppText preset="body" style={{ fontSize: 16 }}>26 октября — 1 ноября 2026</AppText>
          <AppText preset="label" style={{ color: colors.cream }}>7 этапов · 150 монет</AppText>
        </View>
        <GlassPanel tone="cream" style={{ gap: 10 }}>
          <AppText preset="title" style={{ color: colors.brown, fontSize: 20 }}>
            {event.status === 'upcoming' ? 'Начнётся 26 октября'
              : event.status === 'ended' ? 'Марафон завершён' : wonStages === 7 ? 'Все этапы пройдены!' : `${wonStages} из 7 этапов`}
          </AppText>
          <AppText preset="body" style={{ color: colors.brown }}>
            {event.status === 'upcoming' ? 'Участие откроется в 00:00 по московскому времени. Первые прохождения до начала события в марафон не входят.'
              : event.status === 'ended' ? `За событие пройдено головоломок: ${event.completionCount}. Заработанные награды сохраняются.`
                : `Пройдено головоломок: ${event.completionCount}. Пройдите 21, чтобы завершить все этапы.`}
          </AppText>
          <AppText preset="body" style={{ color: colors.brown, fontSize: 14 }}>Каждый этап даёт 10 монет. За финальный этап — ещё 80. Награды начисляются автоматически.</AppText>
          {saveError ? <View style={{ gap: 10 }}>
            <AppText preset="body" accessibilityLiveRegion="assertive" style={{ color: colors.plum }}>Не удалось завершить сохранение награды. Повторите попытку — она не потеряется.</AppText>
            <AppButton label="Повторить сохранение" onPress={refresh} variant="glass" />
          </View> : null}
          <AppButton label={playLabel} icon="play"
            onPress={() => {
              track('marathon_play_clicked', { status: event.status });
              router.push(playRoute as never);
            }} />
        </GlassPanel>
        {event.tiers.map((tier, index) => <GlassPanel key={tier.id} tone="cream" style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: tier.completed ? colors.playGreenDark : colors.creamDeep, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={tier.completed ? 'check' : 'star'} size={22} color={tier.completed ? colors.cream : colors.plum} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText preset="label" style={{ color: colors.brown, fontSize: 16 }}>{tier.title}</AppText>
              <AppText preset="body" style={{ color: colors.brown, fontSize: 14 }}>Всего {ruCount(tier.target, 'головоломка', 'головоломки', 'головоломок')} · +{tier.rewardCoins} монет</AppText>
            </View>
          </View>
          <AppText preset="body" style={{ color: tier.completed ? colors.playGreenDark : colors.brown, fontSize: 14 }}>
            {tier.completed ? 'Этап пройден' : event.status === 'ended' ? 'Этап не пройден' : `До этапа: ${ruCount(tier.remaining, 'головоломка', 'головоломки', 'головоломок')}`}
          </AppText>
          <View accessibilityRole="progressbar" accessibilityLabel={`Этап ${index + 1}`} accessibilityValue={{ min: 0, max: tier.target, now: Math.min(event.completionCount, tier.target) }}
            style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.creamDeep, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${Math.min(100, event.completionCount / tier.target * 100)}%`, backgroundColor: colors.playGreen }} />
          </View>
        </GlassPanel>)}
        <GlassPanel tone="cream" style={{ gap: 8 }}>
          <AppText preset="title" style={{ color: colors.brown, fontSize: 19 }}>Правила</AppText>
          <AppText preset="body" style={{ color: colors.brown, fontSize: 15 }}>Засчитываются первые прохождения обычных уровней и кроссворд текущего дня в период события. Повторы, ранее пройденные уровни и кроссворды за старые даты не учитываются.</AppText>
          <AppText preset="body" style={{ color: colors.brown, fontSize: 15 }}>Можно пройти этапы в любые дни марафона. Ежедневная серия не нужна. Участие доступно с первого уровня, без отдельной платы.</AppText>
          <AppText preset="body" style={{ color: colors.brown, fontSize: 14 }}>Начало: 26 октября в 00:00 МСК. Завершение: 2 ноября в 00:00 МСК. Прогресс хранится на этом устройстве.</AppText>
        </GlassPanel>
      </ScrollView>
    </SafeAreaView>
  </View>;
}
