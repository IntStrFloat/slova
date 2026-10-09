import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGoBack } from '@/core/nav';
import { RETENTION } from '@/core/config/retention';
import { dayKey } from '@/core/time';
import { track, trackOnce } from '@/features/analytics';
import { trackObservedRetentionMilestones } from '@/features/analytics/retentionEvents';
import { useCurrency } from '@/features/currency';
import { getFeatureGates, getQuestStatus, reconcileRewards, useRetention } from '@/features/retention';
import { displayDate } from '@/features/retention-ui/dateModel';
import { AppButton, AppText, colors, GlassPanel, Icon, radius, WorldBackground } from '@/ui';

export default function Quests() {
  const router = useRouter();
  const goBack = useGoBack();
  const retention = useRetention();
  const gates = getFeatureGates(retention);
  const today = dayKey();
  const status = gates.quests ? getQuestStatus(retention, today) : null;
  const completedCount = status?.quests.filter((quest) => quest.completed).length ?? 0;

  useFocusEffect(useCallback(() => {
    const progress = useRetention.getState();
    if (getFeatureGates(progress).quests) {
      progress.ensureDay({ actionDay: dayKey() });
      reconcileRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount));
    }
    const current = useRetention.getState();
    const available = getFeatureGates(current).quests;
    track('quest_screen_viewed', { enabled: available, dateKey: dayKey() });
    if (available && getQuestStatus(current, dayKey())) trackOnce('feature_exposed', 'quests:v1', { kind: 'quests' });
    trackObservedRetentionMilestones(current);
  }, []));

  const play = () => {
    track('quest_action_selected', { mode: 'campaign' });
    router.push('/game' as never);
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ minHeight: 58, paddingHorizontal: 16, justifyContent: 'center' }}><AppButton label="Назад" variant="glass" icon="back" onPress={goBack} style={{ alignSelf: 'flex-start', paddingHorizontal: 14 }} /></View>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 30, gap: 15 }}>
          <View style={{ gap: 5, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glassStrong }}>
            <AppText preset="display" style={{ fontSize: 26 }}>Задания дня</AppText>
            <AppText preset="body" style={{ color: colors.textMuted }}>{displayDate(today)} · играйте в своём темпе</AppText>
          </View>
          {!gates.quests ? <GlassPanel tone="cream" style={{ gap: 12 }}>
            <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.creamDeep, borderWidth: 1, borderColor: colors.goldBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="lock" color={colors.plum} size={26} />
            </View>
            <AppText preset="title" style={{ color: colors.brown }}>{RETENTION.featureFlags.quests ? 'Откроются после 8 уровней' : 'Задания сейчас недоступны'}</AppText>
            <AppText preset="body" style={{ color: colors.brown }}>
              {RETENTION.featureFlags.quests
                ? 'Пока просто продолжайте путешествие. Пройденные уровни и открытки уже сохранены.'
                : 'Полученные награды и открытки сохранены. Обычные уровни остаются доступными.'}
            </AppText>
            <AppButton label="Играть уровни" icon="play" onPress={play} style={{ alignSelf: 'stretch', paddingHorizontal: 12 }} />
          </GlassPanel> : status ? <>
            <GlassPanel tone="cream" style={{ gap: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: colors.plum, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="star" size={24} color={colors.cream} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText preset="title" style={{ color: colors.brown, fontSize: 18 }}>Три небольшие цели</AppText>
                  <AppText preset="label" style={{ color: colors.playGreenDark, fontSize: 13 }}>{completedCount} из {status.quests.length} выполнено</AppText>
                </View>
              </View>
              <View style={{ height: 9, borderRadius: radius.pill, backgroundColor: colors.creamDeep, overflow: 'hidden' }}>
                <View style={{ width: `${Math.round(completedCount / Math.max(1, status.quests.length) * 100)}%`, height: '100%', borderRadius: radius.pill, backgroundColor: colors.playGreen }} />
              </View>
              <AppText preset="body" style={{ color: colors.brown }}>Действия учитываются во время обычной игры. Монеты начисляются автоматически при выполнении.</AppText>
              <AppText preset="label" style={{ color: colors.plum, fontSize: 13 }}>Все три задания — ещё 10 монет</AppText>
            </GlassPanel>
            {status.quests.map((quest) => <GlassPanel key={quest.id} tone="cream" style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={{ width: 43, height: 43, borderRadius: 22, backgroundColor: quest.completed ? colors.playGreenDark : colors.creamDeep, borderWidth: quest.completed ? 0 : 1, borderColor: colors.goldBorder, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={quest.completed ? 'check' : quest.kind === 'bonusWords' ? 'star' : quest.kind === 'manualWords' ? 'order' : 'play'} size={23} color={quest.completed ? colors.cream : colors.plum} />
                </View>
                <AppText preset="title" style={{ flex: 1, fontSize: 17, color: colors.brown }}>{quest.title}</AppText>
              </View>
              <AppText preset="body" style={{ color: colors.brown }}>Прогресс: {Math.min(quest.progress, quest.target)} из {quest.target}</AppText>
              <View style={{ width: '100%', height: 9, borderRadius: radius.pill, backgroundColor: colors.creamDeep, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, Math.round(quest.progress / quest.target * 100))}%`, height: '100%', backgroundColor: colors.playGreen }} />
              </View>
              <AppText preset="label" style={{ color: quest.completed ? colors.playGreenDark : colors.plum, fontSize: 13 }}>
                {quest.completed ? `Выполнено · +${quest.rewardCoins} монет получено` : `Награда · ${quest.rewardCoins} монет`}
              </AppText>
            </GlassPanel>)}
            {status.allCompleted ? <GlassPanel tone="cream" style={{ gap: 7 }}><AppText preset="title" style={{ color: colors.brown }}>Все цели на сегодня выполнены!</AppText><AppText preset="body" style={{ color: colors.brown }}>Общая награда сохранена. Завтра появятся новые задания.</AppText></GlassPanel> : null}
            <AppButton label="К уровням" icon="play" onPress={play} style={{ alignSelf: 'stretch', paddingHorizontal: 12 }} />
            <AppText preset="body" style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>Задания обновятся с новой игровой датой. Незавершённые цели не мешают обычным уровням.</AppText>
          </> : <GlassPanel tone="cream" style={{ gap: 9 }}>
            <AppText preset="title" style={{ color: colors.brown }}>На сегодня нет подходящих заданий</AppText>
            <AppText preset="body" style={{ color: colors.brown }}>Мы показываем только цели, выполнимые в доступных кроссвордах. Обычные уровни остаются доступными.</AppText>
            <AppButton label="Играть уровни" icon="play" onPress={play} style={{ alignSelf: 'stretch', paddingHorizontal: 12 }} />
          </GlassPanel>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
