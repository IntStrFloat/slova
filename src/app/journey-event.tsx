import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGoBack } from '@/core/nav';
import { RETENTION } from '@/core/config/retention';
import { getRetentionUnlocks } from '@/core/config/runtimePolicy';
import { track, trackOnce } from '@/features/analytics';
import { trackObservedRetentionMilestones } from '@/features/analytics/retentionEvents';
import { useRetentionPolicyExposure } from '@/features/remote-config';
import { getCollectibles, getEventStatus, getFeatureGates, useRetention } from '@/features/retention';
import { displayDate } from '@/features/retention-ui/dateModel';
import { ruCount } from '@/features/retention-ui/text';
import { AppButton, AppText, colors, GlassPanel, Icon, radius, WorldBackground } from '@/ui';

export default function JourneyEvent() {
  useRetentionPolicyExposure('event');
  const router = useRouter();
  const goBack = useGoBack();
  const retention = useRetention();
  const gates = getFeatureGates(retention);
  const event = getEventStatus(retention, Date.now());
  const cards = getCollectibles(retention);

  useFocusEffect(useCallback(() => {
    const current = useRetention.getState();
    const active = getEventStatus(current, Date.now());
    track('event_screen_viewed', { enabled: getFeatureGates(current).event, active: active?.active === true });
    if (active?.active) {
      trackOnce('event_eligible', active.id, { eventInstanceId: active.id });
      trackOnce('feature_exposed', 'event:v1', { kind: 'event' });
    }
    trackObservedRetentionMilestones(current);
  }, []));

  const openGame = () => {
    track('event_action_selected', { mode: 'campaign' });
    router.push('/game' as never);
  };
  const openDaily = () => {
    track('event_action_selected', { mode: 'daily' });
    router.push('/daily' as never);
  };
  const openAlbum = () => {
    track('event_action_selected', { mode: 'album' });
    router.push('/collection' as never);
  };

  function rewardLabel(tier: NonNullable<typeof event>['tiers'][number]): string {
    if (tier.kind === 'coins') return `${tier.amount ?? 0} монет`;
    if (tier.kind === 'ticket') return '50 монет';
    return cards.find((card) => card.id === tier.collectibleId)?.title ?? 'Открытка события';
  }

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ minHeight: 58, paddingHorizontal: 16, justifyContent: 'center' }}><AppButton label="Назад" variant="glass" icon="back" onPress={goBack} style={{ alignSelf: 'flex-start', paddingHorizontal: 14 }} /></View>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 30, gap: 15 }}>
          <View style={{ gap: 6, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glassStrong }}>
            <AppText preset="display" style={{ fontSize: 25 }}>Собери чемодан</AppText>
            <AppText preset="body" style={{ color: colors.textMuted }}>Личное событие на маршруте путешествия</AppText>
          </View>
          {!gates.event ? <GlassPanel tone="cream" style={{ gap: 12 }}>
            <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.creamDeep, borderWidth: 1, borderColor: colors.goldBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="lock" size={26} color={colors.plum} />
            </View>
            <AppText preset="title" style={{ color: colors.brown }}>{RETENTION.featureFlags.event ? `Откроется после ${ruCount(getRetentionUnlocks().event, 'уровня', 'уровней', 'уровней')}` : 'Событие сейчас не проводится'}</AppText>
            <AppText preset="body" style={{ color: colors.brown }}>
              {RETENTION.featureFlags.event
                ? 'Пока собирайте слова и открытки в обычном путешествии.'
                : 'Ранее полученные награды остаются в альбоме. Обычные уровни доступны.'}
            </AppText>
            <AppButton label="Играть уровни" icon="play" onPress={openGame} style={{ alignSelf: 'stretch', paddingHorizontal: 12 }} />
          </GlassPanel> : !event?.active ? <GlassPanel tone="cream" style={{ gap: 12 }}>
            <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.creamDeep, borderWidth: 1, borderColor: colors.goldBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="events" size={27} color={colors.plum} />
            </View>
            <AppText preset="title" style={{ color: colors.brown }}>Сейчас событие не идёт</AppText>
            <AppText preset="body" style={{ color: colors.brown }}>Когда появится новый маршрут события, здесь будут его даты и награды. Уже заработанные открытки остаются в альбоме.</AppText>
            <AppButton label="Открыть альбом" icon="collection" variant="glass" onPress={openAlbum} style={{ alignSelf: 'stretch', paddingHorizontal: 12 }} />
          </GlassPanel> : <>
            <GlassPanel tone="cream" style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.plum, alignItems: 'center', justifyContent: 'center' }}><Icon name="events" size={27} color={colors.cream} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText preset="title" style={{ fontSize: 18, color: colors.brown }}>Чемодан</AppText>
                  <AppText preset="label" style={{ color: colors.playGreenDark, fontSize: 14 }}>{ruCount(event.points, 'очко', 'очка', 'очков')}</AppText>
                </View>
              </View>
              <AppText preset="body" style={{ color: colors.brown }}>С {displayDate(event.startDay)} до начала {displayDate(event.endDay)} по московскому времени.</AppText>
              <AppText preset="body" style={{ color: colors.brown, fontSize: 13 }}>
                {`Первое прохождение уровня кампании даёт 1 очко.${gates.daily ? ' Сегодняшний кроссворд дня даёт 2.' : ''} Повторы и кроссворд за старую дату очков не дают.`}
              </AppText>
            </GlassPanel>
            {event.tiers.map((tier) => {
              const reached = event.points >= tier.points;
              return <GlassPanel key={tier.points} tone="cream" style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: reached ? colors.playGreenDark : colors.creamDeep, borderWidth: reached ? 0 : 1, borderColor: colors.goldBorder, alignItems: 'center', justifyContent: 'center' }}><Icon name={tier.claimed ? 'check' : 'star'} size={21} color={reached ? colors.cream : colors.plum} /></View>
                  <View style={{ flex: 1, gap: 2 }}><AppText preset="label" style={{ color: colors.brown }}>{ruCount(tier.points, 'очко', 'очка', 'очков')} · {rewardLabel(tier)}</AppText><AppText preset="body" style={{ color: tier.claimed ? colors.playGreenDark : colors.brown, fontSize: 12 }}>{tier.claimed ? 'Получено' : reached ? 'Награда сохраняется автоматически' : `Осталось ${ruCount(tier.points - event.points, 'очко', 'очка', 'очков')}`}</AppText></View>
                </View>
                <View style={{ height: 9, width: '100%', backgroundColor: colors.creamDeep, borderRadius: radius.pill, overflow: 'hidden' }}><View style={{ height: '100%', width: `${Math.min(100, event.points / tier.points * 100)}%`, backgroundColor: colors.playGreen }} /></View>
              </GlassPanel>;
            })}
            <AppButton label="Играть уровни" icon="play" onPress={openGame} style={{ alignSelf: 'stretch', paddingHorizontal: 12 }} />
            {gates.daily ? <AppButton label="Кроссворд дня" icon="daily" variant="glass" onPress={openDaily} style={{ alignSelf: 'stretch', paddingHorizontal: 12 }} /> : null}
            <AppText preset="body" style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>После завершения события заработанные награды сохраняются. Набранные до следующего порога очки не обмениваются.</AppText>
          </>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
