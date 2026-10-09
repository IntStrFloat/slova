import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { RETENTION } from '@/core/config/retention';
import { useGoBack } from '@/core/nav';
import { track, trackOnce } from '@/features/analytics';
import { trackObservedRetentionMilestones } from '@/features/analytics/retentionEvents';
import { useCurrency } from '@/features/currency';
import { useDailyBonus } from '@/features/dailybonus';
import { useDailyPuzzle } from '@/features/dailypuzzle';
import { getReminderGameplayAttribution } from '@/features/notifications';
import { getDailyCollectionStatus, getFeatureGates, getWeeklyStatus, reconcileRewards, useRetention } from '@/features/retention';
import { dailyDateState, dateRange, displayDate, displayWeekday, shiftDate } from '@/features/retention-ui/dateModel';
import { trackLoginGiftGrant } from '@/features/retention-ui/giftAnalytics';
import { startFocusedRefresh } from '@/features/retention-ui/foregroundRefresh';
import { ReminderAction } from '@/features/retention-ui/ReminderAction';
import { useViewportExposure } from '@/features/retention-ui/viewportExposure';
import { AppButton, AppText, CoinBadge, colors, GlassPanel, Icon, radius, WorldBackground } from '@/ui';

const DATE_STATE_LABEL: Record<ReturnType<typeof dailyDateState>, string> = {
  solved: 'Решено', started: 'Начато', today: 'Сегодня', future: 'Позже', past: 'Без отметки',
};
const DATE_TILE_LABEL: typeof DATE_STATE_LABEL = {
  solved: 'Готово', started: 'Начато', today: 'Сегодня', future: 'Позже', past: '—',
};

function entryContext(source: string): { source: string; promptId?: string } {
  if (source !== 'direct') return { source };
  const attribution = getReminderGameplayAttribution();
  return attribution.promptId ? { source: 'reminder', promptId: attribution.promptId } : { source };
}

function WideAction({ label, onPress, muted = false }: { label: string; onPress: () => void; muted?: boolean }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
    style={({ pressed }) => ({ minHeight: 56, padding: 12, borderRadius: radius.pill,
      justifyContent: 'center', alignItems: 'center', backgroundColor: muted ? colors.creamDeep : colors.playGreenDark,
      borderWidth: 1, borderColor: muted ? colors.goldBorder : colors.playGreen,
      transform: [{ scale: pressed ? 0.97 : 1 }], opacity: pressed ? 0.92 : 1 })}>
    <AppText preset="label" style={{ color: muted ? colors.brown : colors.text, flexShrink: 1, textAlign: 'center' }}>{label}</AppText>
  </Pressable>;
}

function DateTile({ date, today, solvedDates, pendingDates, tileWidth }: {
  date: string; today: string; solvedDates: string[]; pendingDates: string[]; tileWidth: '22%' | '30%' | '46%';
}) {
  const state = dailyDateState(date, today, solvedDates, pendingDates);
  const highlighted = state === 'solved' || state === 'today';
  return (
    <View accessibilityLabel={`${displayDate(date)}: ${DATE_STATE_LABEL[state]}`}
      style={{ width: tileWidth, minWidth: 54, minHeight: 76, padding: 6, alignItems: 'center', justifyContent: 'center', gap: 2,
        borderRadius: radius.md, borderWidth: 1, borderColor: highlighted ? colors.goldBorder : colors.creamDeep,
        backgroundColor: state === 'solved' ? colors.playGreenDark : state === 'today' ? colors.cream : colors.creamDeep }}>
      <AppText preset="body" style={{ fontSize: 11, color: state === 'solved' ? colors.text : colors.brown }}>{displayWeekday(date)}</AppText>
      <AppText preset="label" style={{ fontSize: 13, color: state === 'solved' ? colors.text : colors.brown }}>{displayDate(date)}</AppText>
      <AppText preset="body" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 10, color: state === 'solved' ? colors.text : highlighted ? colors.playGreenDark : colors.brown }}>{DATE_TILE_LABEL[state]}</AppText>
    </View>
  );
}

export default function Daily() {
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const tileWidth: '22%' | '30%' | '46%' = fontScale > 1.6 ? '46%' : fontScale > 1.2 ? '30%' : '22%';
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const source = ['home_card', 'home_primary', 'intro_completion', 'daily_completion', 'reminder'].includes(params.source ?? '') ? params.source! : 'direct';
  const goBack = useGoBack();
  const coins = useCurrency((state) => state.coins);
  const canClaim = useDailyBonus((state) => state.canClaim());
  const claim = useDailyBonus((state) => state.claim);
  const pendingGift = useDailyBonus((state) => state.pendingGift);
  const daily = useDailyPuzzle();
  const retention = useRetention();
  const dailyEnabled = getFeatureGates(retention).daily;
  const [nowDay, setNowDay] = useState(() => daily.effectiveDay());
  const [error, setError] = useState<string | null>(null);
  const [bonusError, setBonusError] = useState<string | null>(null);
  const [claimedReward, setClaimedReward] = useState<{ day: string; amount: number } | null>(null);
  const [replaceDate, setReplaceDate] = useState<string | null>(null);
  const [firstEntryError, setFirstEntryError] = useState(false);
  const [firstEntryRedirectingVisible, setFirstEntryRedirectingVisible] = useState(false);
  const firstEntryRedirecting = useRef(false);
  const menuVisible = !firstEntryRedirectingVisible && (!dailyEnabled || daily.solvedDates.length > 0 || Object.keys(daily.instances).length > 0 || daily.carryCandidates().length > 0);
  const exposure = useViewportExposure((id) => {
    if (id === 'menu') {
      track('daily_entry_seen', { dateKey: nowDay, screen: 'daily', ...entryContext(source) });
      track('daily_menu_viewed', { dateKey: nowDay, screen: 'daily', ...entryContext(source) });
    }
    if (id === 'gift') track('daily_bonus_seen', { dateKey: nowDay, screen: 'daily', claimable: canClaim });
  }, menuVisible ? ['menu', ...(canClaim || claimedReward?.day === nowDay ? ['gift'] : [])] : [], nowDay);

  /** The first voluntary visit starts play; a pinned instance makes later visits a normal menu. */
  const openFirstDaily = useCallback(() => {
    if (firstEntryRedirecting.current || !getFeatureGates(useRetention.getState()).daily) return;
    const store = useDailyPuzzle.getState();
    if (store.solvedDates.length > 0 || Object.keys(store.instances).length > 0) return;
    firstEntryRedirecting.current = true;
    setFirstEntryRedirectingVisible(true);
    const today = store.refreshDay();
    const instance = store.getOrStartDaily(today, 'starter');
    if (!instance) {
      firstEntryRedirecting.current = false;
      setFirstEntryRedirectingVisible(false);
      setFirstEntryError(true);
      return;
    }
    setFirstEntryError(false);
    router.replace(`/game?mode=daily&date=${instance.dateKey}&source=${entryContext(source).source}` as never);
  }, [router, source]);

  useFocusEffect(useCallback(() => {
    const refresh = () => {
      const today = useDailyPuzzle.getState().refreshDay();
      setNowDay(today);
      if (getFeatureGates(useRetention.getState()).daily) {
        useRetention.getState().ensureDay({ actionDay: today });
        reconcileRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount));
      }
      const result = useDailyBonus.getState().reconcilePending();
      if (result.error) setBonusError('Не удалось завершить сохранение подарка. Нажмите ещё раз, чтобы повторить.');
      else setBonusError(null);
      trackLoginGiftGrant(result, useDailyBonus.getState().lastDay, 'daily', 'focus_recovery');
    };
    const stopRefresh = startFocusedRefresh(refresh);
    exposure.focus();
    const progress = useRetention.getState();
    const dailyState = useDailyPuzzle.getState();
    const today = dailyState.effectiveDay();
    if (getFeatureGates(progress).daily) {
      track('daily_entered', { dateKey: today, screen: 'daily', ...entryContext(source),
        entryKind: dailyState.solvedDates.length === 0 && Object.keys(dailyState.instances).length === 0 ? 'first_play' : 'menu' });
      trackOnce('daily_eligible', 'first-eligible:v1');
    }
    trackObservedRetentionMilestones(progress);
    openFirstDaily();
    return () => { stopRefresh(); exposure.blur(); };
  }, [openFirstDaily, source, exposure]));

  const today = nowDay;
  const visibleClaimedReward = claimedReward?.day === today ? claimedReward.amount : null;
  const todayInstance = daily.instances[today];
  const doneToday = daily.solvedDates.includes(today);
  const carried = daily.carryCandidates();
  const hasCarryConflict = carried.length > 1;
  const requiresCarryChoice = hasCarryConflict && !todayInstance && !doneToday;
  const pending = daily.pendingOlder();
  const firstDailyEntry = dailyEnabled && daily.solvedDates.length === 0 && Object.keys(daily.instances).length === 0 && carried.length === 0;
  const week = getWeeklyStatus(retention, today);
  const tome = daily.tomeProgress();
  const dailyCollection = getDailyCollectionStatus(retention);
  const calendarDates = dateRange(shiftDate(today, -6), 10);

  const openPuzzle = (date: string) => {
    if (!dailyEnabled) return;
    const wasStarted = Boolean(daily.instances[date]);
    const instance = daily.getOrStartDaily(date);
    if (!instance) {
      setError(requiresCarryChoice && date === today
        ? 'Сначала выберите, какой незаконченный кроссворд сохранить.'
        : 'Кроссворд пока недоступен. Обычные уровни можно играть без ожидания.');
      return;
    }
    setError(null);
    const entrySource = date !== today && wasStarted ? 'carry' : 'daily_menu';
    track('daily_entry_clicked', { screen: 'daily', source: entrySource, dateKey: date });
    router.push(`/game?mode=daily&date=${date}&source=${entrySource}` as never);
  };

  const confirmReplacement = () => {
    if (!dailyEnabled) return;
    if (!replaceDate) return;
    const result = daily.replaceCarriedDaily(replaceDate);
    if (!result) {
      setError('Не удалось заменить старый кроссворд. Если награда за него ещё оформляется, откройте его и завершите выдачу.');
      return;
    }
    setError(null);
    setReplaceDate(null);
    track('daily_carry_replaced', { dateKey: replaceDate });
  };

  const claimBonus = () => {
    const result = claim();
    if (result.error) {
      setBonusError('Подарок пока не сохранён полностью. Нажмите ещё раз, чтобы повторить.');
      return;
    }
    setBonusError(null);
    if (!result.reward) return;
    setClaimedReward({ day: nowDay, amount: result.reward });
    trackLoginGiftGrant(result, useDailyBonus.getState().lastDay, 'daily', 'daily_gift');
  };

  if (firstDailyEntry || firstEntryRedirectingVisible) {
    return <View style={{ flex: 1 }}>
      <WorldBackground world="world1" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppButton label="Назад" variant="glass" icon="back" onPress={goBack} style={{ paddingHorizontal: 14 }} />
          <CoinBadge value={coins} />
        </View>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, padding: 16, justifyContent: 'center' }}>
          <GlassPanel tone="cream" style={{ gap: 13, alignItems: 'center' }}>
            <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: colors.plum, alignItems: 'center', justifyContent: 'center' }}><Icon name="daily" size={34} color={colors.cream} /></View>
            <AppText preset="title" style={{ color: colors.brown, textAlign: 'center' }}>Кроссворд дня</AppText>
            <AppText preset="body" style={{ color: colors.brown, textAlign: 'center' }}>Реши кроссворд дня и отметь сегодняшний день.</AppText>
            {firstEntryError ? <>
              <AppText preset="body" style={{ color: colors.plumDeep, textAlign: 'center' }}>Не удалось открыть проверенный кроссворд. Обычные уровни доступны без ожидания.</AppText>
              <WideAction label="Попробовать снова" onPress={openFirstDaily} />
            </> : <AppText preset="body" style={{ color: colors.plum }}>Открываем поле…</AppText>}
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>
    </View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppButton label="Назад" variant="glass" icon="back" onPress={goBack} style={{ paddingHorizontal: 14 }} />
          <CoinBadge value={coins} />
        </View>
        <ScrollView {...exposure.scrollProps} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 16 }}>
          <View style={{ gap: 5, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.glassStrong }}>
            <AppText preset="display" style={{ fontSize: 26 }}>Кроссворд дня</AppText>
            <AppText preset="body" style={{ color: colors.textMuted }}>
              {dailyEnabled ? 'Реши кроссворд дня и отметь сегодняшний день.'
                : RETENTION.featureFlags.daily
                  ? 'Кроссворд дня откроется после пяти уровней. Подарок за вход доступен отдельно.'
                  : 'Кроссворд дня сейчас недоступен. Полученные открытки и подарок за вход сохранены.'}
            </AppText>
          </View>

          <View onLayout={exposure.cardLayout('menu')}><GlassPanel tone="cream" style={{ gap: 13 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: colors.plum, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="daily" size={28} color={colors.cream} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText preset="title" style={{ color: colors.brown, fontSize: 18 }}>Сегодня · {displayDate(today)}</AppText>
                <AppText preset="body" style={{ color: colors.brown, fontSize: 13 }}>
                  {!dailyEnabled ? 'Режим пока недоступен' : doneToday ? 'Кроссворд решён' : todayInstance ? 'Начато — продолжить с сохранённого места' : 'Новый кроссворд ждёт вас'}
                </AppText>
              </View>
            </View>
            {!dailyEnabled ? <AppText preset="body" style={{ color: colors.brown }}>Продолжайте путешествие и загляните в альбом.</AppText> : doneToday ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><Icon name="check" size={21} color={colors.playGreenDark} /><AppText preset="label" style={{ color: colors.playGreenDark }}>Отметка за сегодня получена</AppText></View> : requiresCarryChoice ?
              <AppText preset="body" style={{ color: colors.plumDeep }}>Чтобы начать сегодня, выберите ниже один старый кроссворд для сохранения.</AppText> :
              <WideAction label={todayInstance ? 'Продолжить' : 'Играть кроссворд дня'} onPress={() => openPuzzle(today)} />}
            {error ? <AppText preset="body" style={{ color: colors.plumDeep }}>{error}</AppText> : null}
          </GlassPanel></View>

          {dailyEnabled ? <ReminderAction screen="daily" dailyIntroduced /> : null}

          {dailyEnabled && hasCarryConflict ? <GlassPanel tone="cream" style={{ gap: 11 }}>
            <AppText preset="title" style={{ color: colors.brown, fontSize: 17 }}>Незаконченные кроссворды</AppText>
            <AppText preset="body" style={{ color: colors.brown }}>Сохранить для продолжения можно один старый кроссворд. Вы можете сначала закончить любой из них или выбрать, какой оставить. Уже полученные награды не изменятся.</AppText>
            {carried.map((instance) => <View key={instance.dateKey} style={{ paddingTop: 9, gap: 8, borderTopWidth: 1, borderColor: colors.goldBorder }}>
              <AppText preset="label" style={{ color: colors.brown }}>За {displayDate(instance.dateKey)}</AppText>
              <WideAction label={`Играть за ${displayDate(instance.dateKey)}`} muted onPress={() => openPuzzle(instance.dateKey)} />
              <Pressable onPress={() => setReplaceDate(instance.dateKey)} accessibilityRole="button" accessibilityLabel={`Оставить кроссворд за ${displayDate(instance.dateKey)}`} style={{ minHeight: 44, justifyContent: 'center' }}>
                <AppText preset="label" style={{ color: colors.plum, textAlign: 'center', fontSize: 13 }}>Оставить этот для продолжения</AppText>
              </Pressable>
            </View>)}
          </GlassPanel> : dailyEnabled && pending ? <GlassPanel tone="cream" style={{ gap: 10 }}>
            <AppText preset="title" style={{ color: colors.brown, fontSize: 17 }}>Незаконченный кроссворд</AppText>
            <AppText preset="body" style={{ color: colors.brown }}>
              Кроссворд за {displayDate(pending.dateKey)} можно закончить. Для отметки за сегодня открой новый.
            </AppText>
            <WideAction label={`Продолжить за ${displayDate(pending.dateKey)}`} muted onPress={() => openPuzzle(pending.dateKey)} />
          </GlassPanel> : null}

          {dailyEnabled && replaceDate ? <GlassPanel tone="cream" style={{ gap: 11, borderWidth: 2, borderColor: colors.plum }}>
            <AppText preset="title" style={{ color: colors.brown, fontSize: 17 }}>Сохранить кроссворд за {displayDate(replaceDate)}?</AppText>
            <AppText preset="body" style={{ color: colors.brown }}>Прогресс остальных незаконченных старых кроссвордов будет удалён. Решённые даты, монеты и открытки останутся.</AppText>
            {error ? <AppText preset="body" style={{ color: colors.plumDeep }}>{error}</AppText> : null}
            <WideAction label="Подтвердить замену" onPress={confirmReplacement} />
            <WideAction label="Отмена" muted onPress={() => setReplaceDate(null)} />
          </GlassPanel> : null}

          <GlassPanel tone="cream" style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icon name="daily" size={22} color={colors.plum} /><AppText preset="title" style={{ color: colors.brown, fontSize: 18, flex: 1 }}>Календарь</AppText></View>
            <AppText preset="body" style={{ color: colors.brown, fontSize: 13 }}>Отмечены только решённые ежедневные кроссворды. Будущие даты откроются в свой день.</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
              {calendarDates.map((date) => <DateTile key={date} date={date} today={today} tileWidth={tileWidth} solvedDates={daily.solvedDates} pendingDates={[...carried.map((instance) => instance.dateKey), ...(todayInstance && !doneToday ? [today] : [])]} />)}
            </View>
          </GlassPanel>

          {week && daily.solvedDates.length > 0 ? <GlassPanel tone="cream" style={{ gap: 12 }}>
            <AppText preset="title" style={{ color: colors.brown, fontSize: 18 }}>Личная неделя · {week.activeCount} из 5</AppText>
            <View style={{ width: '100%', height: 9, backgroundColor: colors.creamDeep, borderRadius: radius.pill, overflow: 'hidden' }}><View style={{ width: `${Math.min(100, week.activeCount / 5 * 100)}%`, height: '100%', backgroundColor: colors.playGreen }} /></View>
            <AppText preset="body" style={{ color: colors.brown, fontSize: 13 }}>Сыграйте в любые пять дней из семи. Период: {displayDate(week.startDay)} — {displayDate(shiftDate(week.endDay, -1))}.</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 7 }}>
              {dateRange(week.startDay, 7).map((date) => {
                const active = week.activeDays.includes(date);
                return <View key={date} accessibilityLabel={`${displayDate(date)}: ${active ? 'активный день' : date > today ? 'впереди' : 'без отметки'}`}
                  style={{ width: tileWidth, minWidth: 54, minHeight: 68, padding: 7, borderRadius: radius.md, borderWidth: 1, borderColor: active ? colors.playGreen : colors.creamDeep, backgroundColor: active ? colors.playGreenDark : colors.creamDeep, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  <AppText preset="body" style={{ fontSize: 11, color: active ? colors.text : colors.brown }}>{displayWeekday(date)}</AppText>
                  <AppText preset="label" style={{ fontSize: 13, color: active ? colors.text : colors.brown }}>{displayDate(date)}</AppText>
                  <AppText preset="body" style={{ fontSize: 11, color: active ? colors.text : colors.brown }}>{active ? 'Зачёт' : '·'}</AppText>
                </View>;
              })}
            </View>
            <AppText preset="body" style={{ color: colors.brown, fontSize: 13 }}>День засчитывается за кроссворд дня или две впервые решённые головоломки. Награды: 2 дня — 10 монет, 4 — 50 монет, 5 — {week.bonusCoinsAtFive || week.bonusTicketAtFive ? '50 монет' : 'открытка'}.</AppText>
          </GlassPanel> : null}

          <GlassPanel tone="cream" style={{ gap: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><Icon name="collection" size={23} color={colors.plum} /><AppText preset="title" style={{ color: colors.brown, fontSize: 18, flex: 1 }}>Дневник открыток · том {tome.volume}</AppText></View>
            <AppText preset="body" style={{ color: colors.brown }}>Решено разных дат: {tome.total}. В этом томе: {tome.inVolume} из 22.</AppText>
            <View style={{ width: '100%', height: 9, backgroundColor: colors.creamDeep, borderRadius: radius.pill, overflow: 'hidden' }}><View style={{ width: `${Math.min(100, tome.inVolume / 22 * 100)}%`, height: '100%', backgroundColor: colors.playGreen }} /></View>
            <AppText preset="body" style={{ color: colors.plum, fontSize: 13 }}>
              {dailyCollection.nextPostcardAt === null ? 'Все доступные открытки собраны. Решения сохраняются для новых томов.' : tome.nextThreshold === null ? 'Все открытки этого тома собраны.' : `Следующая открытка — после ${tome.nextThreshold} кроссвордов тома.`}
            </AppText>
            <AppText preset="body" style={{ color: colors.brown, fontSize: 12 }}>Открыток в дневнике: {dailyCollection.ownedCount}</AppText>
            <Pressable onPress={() => { track('daily_album_action', { screen: 'daily' }); router.push('/collection' as never); }} accessibilityRole="button" accessibilityLabel="Открыть альбом" style={{ minHeight: 44, justifyContent: 'center' }}><AppText preset="label" style={{ color: colors.plum }}>Смотреть альбом ›</AppText></Pressable>
          </GlassPanel>

          {canClaim || visibleClaimedReward !== null ? <Animated.View onLayout={exposure.cardLayout('gift')} entering={reducedMotion ? undefined : FadeInDown.duration(260)}>
            <GlassPanel tone="cream" style={{ gap: 11, minHeight: 196, justifyContent: 'center' }}>
              {visibleClaimedReward !== null ? (
                <Animated.View
                  entering={reducedMotion ? undefined : FadeInDown.duration(240)}
                  accessible
                  accessibilityRole="summary"
                  accessibilityLabel={`Подарок получен, ${visibleClaimedReward} монет`}
                  accessibilityLiveRegion="polite"
                  style={{ alignItems: 'center', justifyContent: 'center', gap: 7 }}
                >
                  <Icon name="coin" size={39} color={colors.goldBorder} />
                  <AppText preset="title" style={{ color: colors.brown, fontSize: 19 }}>Подарок получен</AppText>
                  <AppText preset="display" style={{ color: colors.playGreenDark, fontSize: 29 }}>+{visibleClaimedReward} монет</AppText>
                </Animated.View>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <View style={{ width: 54, height: 54, borderRadius: 19, backgroundColor: colors.plum, borderWidth: 2, borderColor: colors.goldBorder, alignItems: 'center', justifyContent: 'center' }}><Icon name="chest" size={28} color={colors.cream} /></View>
                    <View style={{ flex: 1, gap: 2 }}><AppText preset="title" style={{ color: colors.brown, fontSize: 17 }}>Подарок за вход</AppText><AppText preset="label" style={{ color: colors.plum, fontSize: 12 }}>Сегодняшний бонус</AppText></View>
                  </View>
                  <AppText preset="body" style={{ color: colors.brown, fontSize: 13 }}>{pendingGift ? 'Подарок подготовлен. Завершите получение, чтобы отметить день.' : 'Дополнительный подарок, без условий для кроссворда и недели.'}</AppText>
                  {bonusError ? <AppText preset="body" style={{ color: colors.plumDeep, fontSize: 13 }}>{bonusError}</AppText> : null}
                  <AppButton label={pendingGift ? 'Завершить получение' : 'Забрать подарок'} icon="coin" onPress={claimBonus} style={{ alignSelf: 'stretch', paddingHorizontal: 12 }} />
                </>
              )}
            </GlassPanel>
          </Animated.View> : null}

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
