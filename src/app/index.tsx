import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { latestLandmarkAt, totalCampaignLevels, worldById, worldForCampaignLevel } from '@/core/config/worlds';
import { getString, KEYS, setString } from '@/core/storage';
import { dayKey } from '@/core/time';
import { track, trackOnce } from '@/features/analytics';
import { selectHelpContext } from '@/features/analytics/helpContext';
import { trackObservedRetentionMilestones } from '@/features/analytics/retentionEvents';
import { useCurrency } from '@/features/currency';
import { useDailyBonus } from '@/features/dailybonus';
import { routeCardProgress } from '@/features/collection/routeProgress';
import { useCollection } from '@/features/collection/store';
import { useDailyPuzzle } from '@/features/dailypuzzle';
import { loadGameSnapshot, type GameSnapshot } from '@/features/game/persistence';
import { loadGlobalLevel, useLevels } from '@/features/levels';
import { canResumeHelpFlow, currentHelpQuote, getHelpFlow, helpFlowGameHref, helpFlowProperties,
  latestResumableHelpFlow, markHelpFlowReturned, useHelpFlows } from '@/features/hints/help-flow';
import { exposeHelpExperiment, useHelpExperimentState } from '@/features/hints/help-experiment';
import { AdBanner, MONETIZATION, useRewardedState } from '@/features/monetization';
import { newMonetizationId } from '@/features/monetization/adTelemetry';
import { SubscriptionOffer, useSubscriptionOffer } from '@/features/monetization/SubscriptionOffer';
import { assignIntroPackForCurrentProfile } from '@/features/onboarding/introPack';
import { giftProgress } from '@/features/progression/store';
import { getCollectibles, getEventStatus, getFeatureGates, getJourneyStatus, getQuestStatus, getWeeklyStatus, reconcileRewards, useRetention } from '@/features/retention';
import { homePlayLabel, nextHomePostcard, normalLevelProgress, pendingNormalResultLevel, shouldAutoOpenIntro } from '@/features/retention-ui/homeModel';
import { trackLoginGiftGrant } from '@/features/retention-ui/giftAnalytics';
import { trackRetentionAction } from '@/features/retention-ui/analytics';
import { startFocusedRefresh } from '@/features/retention-ui/foregroundRefresh';
import { ReminderAction } from '@/features/retention-ui/ReminderAction';
import { MarathonEntry } from '@/features/retention-ui/MarathonEntry';
import { ruCount } from '@/features/retention-ui/text';
import { useRetentionPolicyExposure } from '@/features/remote-config';
import { isExposureWindowFocused, useViewportExposure } from '@/features/retention-ui/viewportExposure';
import { AppText, CoinBadge, colors, GlassPanel, Icon, radius, WorldBackground, type IconName } from '@/ui';

const flatTitle = { textShadowColor: 'transparent', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 0 } as const;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function LinkChip({ label, visibleLabel = label, icon, onPress, badge = false, compact = false }: { label: string; visibleLabel?: string; icon: IconName; onPress: () => void; badge?: boolean; compact?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ minHeight: compact ? 48 : 52, flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingHorizontal: compact ? 10 : 14, paddingVertical: compact ? 7 : 10, borderRadius: radius.pill, backgroundColor: pressed ? colors.creamDeep : colors.cream,
        borderWidth: 1, borderBottomWidth: 3, borderColor: colors.goldBorder })}>
      <Icon name={icon} size={19} color={colors.brown} />
      <AppText preset="label" maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ color: colors.brown, fontSize: 14, flexShrink: 1, textAlign: 'center' }}>{visibleLabel}</AppText>
      {badge ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.playGreen }} /> : null}
    </Pressable>
  );
}

function PlayButton({ label, visibleLabel = label, icon, onPress, compact = false }: { label: string; visibleLabel?: string; icon: IconName; onPress: () => void; compact?: boolean }) {
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      onPressIn={() => { if (!reducedMotion) scale.set(withTiming(0.97, { duration: 110 })); }}
      onPressOut={() => { scale.set(withTiming(1, { duration: 140 })); }}
      style={[{ minHeight: compact ? 48 : 54, width: '100%', paddingHorizontal: compact ? 12 : 16, paddingVertical: compact ? 8 : 10,
        borderRadius: radius.pill, backgroundColor: colors.playGreenDark,
        borderWidth: 1, borderBottomWidth: 4, borderColor: colors.playGreen,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, animatedStyle]}>
      <Icon name={icon} size={23} color={colors.onGreen} />
      <AppText preset="label" maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ color: colors.onGreen, fontSize: compact ? 16 : 17, flexShrink: 1, textAlign: 'center' }}>{visibleLabel}</AppText>
    </AnimatedPressable>
  );
}

export default function Home() {
  useHelpExperimentState((state) => state.revision);
  useRetentionPolicyExposure('home');
  const router = useRouter();
  const { height, width, fontScale } = useWindowDimensions();
  const compact = height < 700 || width < 350;
  const [introAssigned] = useState(assignIntroPackForCurrentProfile);
  const [introSurface, setIntroSurface] = useState(() => getString(KEYS.introSurface));
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(() => loadGameSnapshot('normal'));
  const completed = useLevels((state) => state.completed.length);
  const currentLevel = useLevels((state) => state.currentLevel);
  const coins = useCurrency((state) => state.coins);
  useHelpFlows((state) => state.flows);
  const recoverableHelp = latestResumableHelpFlow();
  const helpQuote = recoverableHelp ? currentHelpQuote(recoverableHelp) : null;
  const returningToHelp = useRef(false);
  const rewardedState = useRewardedState();
  const contentRoot = useRef<View | null>(null);
  const wheelEntryNode = useRef<View | null>(null);
  const helpEntryNode = useRef<View | null>(null);
  const homeFocused = useRef(false);
  const helpExposureId = recoverableHelp ? `help_resume:${recoverableHelp.id}` : null;
  const previousHelpExposure = useRef<string | null>(null);
  const canClaimGift = useDailyBonus((state) => state.canClaim());
  const pendingGift = useDailyBonus((state) => state.pendingGift);
  const [giftClaim, setGiftClaim] = useState<{ date: string; amount: number } | null>(null);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [nowDay, setNowDay] = useState(() => dayKey());
  const daily = useDailyPuzzle();
  const retention = useRetention();
  const gates = getFeatureGates(retention);
  const week = getWeeklyStatus(retention, dayKey());
  const quests = gates.quests ? getQuestStatus(retention, dayKey()) : null;
  const event = gates.event ? getEventStatus(retention, Date.now()) : null;
  const cards = getCollectibles(retention);
  const newCount = cards.filter((card) => card.owned && !card.seen).length;
  const openedRouteCards = useCollection((state) => state.opened);
  const total = totalCampaignLevels();
  const pendingResultLevel = pendingNormalResultLevel(snapshot, loadGlobalLevel);
  const campaignComplete = currentLevel > total && pendingResultLevel === null;
  const displayLevel = Math.min(Math.max(pendingResultLevel ?? currentLevel, 1), total);
  const completedLevel = Math.min(total, Math.max(0, currentLevel - 1));
  const lastEarnedRouteCard = latestLandmarkAt(worldForCampaignLevel(Math.max(1, completedLevel)), completedLevel);
  const featuredRouteCard = lastEarnedRouteCard && openedRouteCards.includes(lastEarnedRouteCard.id)
    ? lastEarnedRouteCard : null;
  const nextRouteCard = routeCardProgress(completedLevel);
  const nextPostcard = nextHomePostcard(nextRouteCard, getJourneyStatus(retention), cards);
  const nextGift = giftProgress(completedLevel);
  const currentWorld = worldForCampaignLevel(displayLevel);
  const world = worldById(currentWorld);
  const normalLevel = loadGlobalLevel(displayLevel);
  const partial = normalLevelProgress(snapshot, displayLevel, normalLevel?.answers.length ?? null);
  const primaryLabel = campaignComplete && !gates.daily
    ? 'Открыть альбом'
    : homePlayLabel(displayLevel, partial.hasPartialProgress, campaignComplete, pendingResultLevel !== null);
  const compactPrimaryLabel = campaignComplete ? primaryLabel
    : pendingResultLevel !== null ? 'Результат' : partial.hasPartialProgress ? 'Продолжить' : 'Играть';
  const autoOpen = shouldAutoOpenIntro(introAssigned, completed, introSurface);
  const canOpenAlbum = !introAssigned || completed >= 5;
  const dailyDate = daily.effectiveDay();
  const dailyDone = daily.isDone(dailyDate);
  const visibleGift = giftClaim?.date === nowDay ? giftClaim.amount : null;
  const subscriptionOffer = useSubscriptionOffer(completed);
  const exposure = useViewportExposure((id, observation) => {
    if (id === 'wheel_entry') {
      track('feature_exposed', { ...selectHelpContext({ entry_source: 'home', balance: coins }),
        feature: 'wheel_entry', screen: 'home', element_id: 'wheel', is_available: true, rewarded_state: rewardedState, ...observation });
    } else if (id === helpExposureId && recoverableHelp) {
      exposeHelpExperiment(recoverableHelp.id, 'home_help_resume', Date.now(), {
        layoutReady: true, routeFocused: homeFocused.current, windowFocused: isExposureWindowFocused(), active: AppState.currentState === 'active' });
      track('feature_exposed', { ...selectHelpContext({ ...helpFlowProperties(recoverableHelp), entry_source: 'home_help_resume',
        balance: coins, displayed_cost: currentHelpQuote(recoverableHelp).price }),
      feature: 'help_resume', screen: 'home', element_id: 'resume_help', is_available: true, ...observation });
    } else if (id !== 'subscription') track('feature_exposed', { feature: id, screen: 'home', visibility_rule: 'half_1s_v2' });
    if (id === 'daily') track('daily_entry_seen', { dateKey: dailyDate, screen: 'home', source: 'home_card', solved: dailyDone });
    if (id === 'gift') track('daily_bonus_seen', { dateKey: nowDay, screen: 'home', claimable: canClaimGift });
    if (id === 'postcard' && featuredRouteCard) trackOnce('reward_presentation_seen', featuredRouteCard.id, { rewardId: featuredRouteCard.id, screen: 'home' });
    if (id === 'subscription') subscriptionOffer.trackShown();
  }, [
    'marathon',
    ...(gates.daily ? ['daily'] : []),
    ...(completed >= 5 && (canClaimGift || visibleGift !== null) ? ['gift'] : []),
    ...(featuredRouteCard ? ['postcard'] : []),
    ...(subscriptionOffer.visible ? ['subscription'] : []),
    ...(completed >= 15 ? ['wheel_entry'] : []),
    ...(helpExposureId ? [helpExposureId] : []),
  ], `${dailyDate}:${nowDay}`);
  const measureHomeEntries = useCallback(() => {
    exposure.invalidate('wheel_entry');
    if (previousHelpExposure.current) exposure.invalidate(previousHelpExposure.current);
    if (helpExposureId) exposure.invalidate(helpExposureId);
    previousHelpExposure.current = helpExposureId;
    if (!homeFocused.current || !contentRoot.current) return;
    exposure.measureLayout('wheel_entry', wheelEntryNode.current, contentRoot.current);
    if (helpExposureId) exposure.measureLayout(helpExposureId, helpEntryNode.current, contentRoot.current);
  }, [exposure, helpExposureId]);
  useLayoutEffect(() => { measureHomeEntries(); }, [measureHomeEntries, completed, fontScale, width]);

  useFocusEffect(useCallback(() => {
    homeFocused.current = true;
    returningToHelp.current = false;
    const surface = getString(KEYS.introSurface);
    setIntroSurface(surface);
    setSnapshot(loadGameSnapshot('normal'));
    const wins = useLevels.getState().completed.length;
    if (shouldAutoOpenIntro(introAssigned, wins, surface)) {
      router.replace('/game?source=intro_auto' as never);
      return;
    }
    exposure.focus();
    measureHomeEntries();
    const refresh = () => {
      const actionDay = useDailyPuzzle.getState().refreshDay();
      setNowDay(actionDay);
      setSnapshot(loadGameSnapshot('normal'));
      const result = useDailyBonus.getState().reconcilePending();
      setGiftError(result.error ? 'Не удалось сохранить подарок. Попробуйте ещё раз.' : null);
      trackLoginGiftGrant(result, useDailyBonus.getState().lastDay, 'home', 'focus_recovery');
      if (useLevels.getState().completed.length >= 5) {
        const progress = useRetention.getState();
        progress.ensureDay({ actionDay });
        reconcileRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount));
      }
      trackObservedRetentionMilestones(useRetention.getState());
    };
    const stopRefresh = startFocusedRefresh(refresh);
    const progress = useRetention.getState();
    track('home_viewed', { source: wins < 5 ? 'early' : wins === 5 ? 'planned' : 'return', levelId: useLevels.getState().currentLevel });
    trackObservedRetentionMilestones(progress);
    if (getFeatureGates(progress).daily) trackOnce('daily_eligible', 'first-eligible:v1');
    return () => { homeFocused.current = false; stopRefresh(); exposure.blur(); };
  }, [introAssigned, router, exposure, measureHomeEntries]));

  const play = () => {
    const mode = campaignComplete ? gates.daily ? 'daily' : 'album' : 'campaign';
    track('home_primary_action', { mode });
    if (campaignComplete) return router.push((gates.daily ? '/daily?source=home_primary' : '/collection') as never);
    if (introAssigned && completed < 5) setString(KEYS.introSurface, 'game');
    router.push('/game?source=home' as never);
  };

  const openDaily = () => {
    track('home_primary_action', { mode: 'daily' });
    track('daily_entry_clicked', { screen: 'home', source: 'home_card', dateKey: dailyDate });
    router.push('/daily?source=home_card' as never);
  };
  const returnToHelp = () => {
    if (returningToHelp.current) return;
    const flow = getHelpFlow(recoverableHelp?.id);
    if (!flow || !canResumeHelpFlow(flow) || !currentHelpQuote(flow).helpAvailable) return;
    returningToHelp.current = true;
    try { markHelpFlowReturned(flow.id); } catch { /* The original durable context is still sufficient for safe navigation. */ }
    const interactionId = newMonetizationId('hi');
    trackRetentionAction('home', 'resume_help', { ...selectHelpContext({ ...helpFlowProperties(flow), interaction_id: interactionId,
      entry_source: 'home_help_resume', displayed_cost: currentHelpQuote(flow).price, balance: useCurrency.getState().coins }), action: 'return' });
    const destination = helpFlowGameHref(flow);
    router.push({ ...destination, params: { ...destination.params, entryInteractionId: interactionId } } as never);
  };
  const claimGift = () => {
    trackRetentionAction('home', 'claim_gift');
    const result = useDailyBonus.getState().claim();
    if (result.error) { setGiftError('Не удалось сохранить подарок. Попробуйте ещё раз.'); return; }
    setGiftError(null);
    if (!result.reward) return;
    setGiftClaim({ date: nowDay, amount: result.reward });
    trackLoginGiftGrant(result, useDailyBonus.getState().lastDay, 'home', 'home_gift');
  };

  if (autoOpen) return null;

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world={currentWorld} image={latestLandmarkAt(currentWorld, completedLevel)?.image ?? world?.image} />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ minHeight: compact ? 48 : 60, paddingHorizontal: compact ? 12 : 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <CoinBadge value={coins} />
          {compact ? <AppText preset="display" maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ fontSize: 16, letterSpacing: 1, textAlign: 'center', flexShrink: 1 }}>СЛОВА</AppText> : null}
          <Pressable onPress={() => { trackRetentionAction('home', 'settings'); router.push('/settings' as never); }} accessibilityRole="button" accessibilityLabel="Настройки"
            style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: pressed ? colors.plumDeep : colors.glassStrong,
              borderWidth: 1, borderColor: colors.cream, alignItems: 'center', justifyContent: 'center' })}>
            <Icon name="settings" size={23} color={colors.cream} />
          </Pressable>
        </View>
        <ScrollView {...exposure.scrollProps} contentInsetAdjustmentBehavior="automatic" onContentSizeChange={measureHomeEntries}>
          <View ref={contentRoot} testID="home-content-root" collapsable={false} onLayout={measureHomeEntries}
            style={{ paddingHorizontal: compact ? 12 : 16, paddingTop: compact ? 6 : 0, paddingBottom: 26, gap: compact ? 6 : 12 }}>
          {!compact ? <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <AppText preset="display" style={{ fontSize: 32, letterSpacing: 3, textAlign: 'center' }}>СЛОВА</AppText>
          </View> : null}

          <GlassPanel tone="cream" style={{ padding: compact ? 8 : 14, gap: compact ? 4 : 7, borderBottomWidth: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                <Icon name="journey" size={18} color={colors.brown} />
                <AppText preset="label" maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ color: colors.brown, fontSize: 13, flexShrink: 1 }}>
                  {campaignComplete ? 'Маршрут пройден' : `Уровень ${displayLevel} · ${world?.title ?? 'Путешествие'}`}
                </AppText>
              </View>
              {introAssigned && completed < 5 ? (
                <View style={{ borderRadius: radius.pill, backgroundColor: colors.creamDeep, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <AppText preset="label" style={{ color: colors.brown, fontSize: 12 }}>{completed} / 5</AppText>
                </View>
              ) : null}
            </View>
            {partial.label ? <AppText preset="body" maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ color: colors.brown, fontSize: compact ? 12 : 14 }}>{partial.label}</AppText> : null}
            <PlayButton label={primaryLabel} visibleLabel={compact ? compactPrimaryLabel : primaryLabel} compact={compact} icon={campaignComplete ? gates.daily ? 'daily' : 'collection' : 'play'} onPress={play} />
            {!compact ? <AppText preset="body" style={{ color: colors.brown, fontSize: 13, textAlign: 'center', opacity: 0.76 }}>
              {campaignComplete
                ? gates.daily ? 'Возвращайтесь за новым кроссвордом дня.' : 'Полученные открытки остаются в альбоме.'
                : pendingResultLevel !== null ? 'Победа сохранена. Продолжайте с результата.'
                  : 'Составляйте слова и открывайте новые места.'}
            </AppText> : null}
          </GlassPanel>

          {recoverableHelp && helpQuote ? <View onLayout={measureHomeEntries}><GlassPanel tone="cream" style={{ padding: compact ? 8 : 14, gap: 7, borderBottomWidth: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="bulb" size={21} color={colors.brown} />
              <AppText preset="label" style={{ flex: 1, color: colors.brown }}>Выбранная помощь ждёт</AppText>
            </View>
            <AppText preset="body" style={{ color: colors.brown, fontSize: 13 }}>
              {recoverableHelp.mode === 'daily' ? `Кроссворд за ${recoverableHelp.dateKey}` : `Уровень ${recoverableHelp.levelId}`}.
              {' '}{helpQuote.price === 0 ? 'Помощь уже доступна бесплатно.' : `Вы выбирали ${helpQuote.hintName} за ${helpQuote.price} монет.`}
            </AppText>
            <View ref={helpEntryNode} testID="home-help-resume-entry" collapsable={false} onLayout={measureHomeEntries}>
              <LinkChip label="Вернуться к выбранной помощи" compact={compact} icon="back" onPress={returnToHelp} />
            </View>
          </GlassPanel></View> : null}

          <View onLayout={exposure.cardLayout('marathon')}><MarathonEntry /></View>

          {subscriptionOffer.visible ? <View testID="home-subscription-card" onLayout={exposure.cardLayout('subscription')}>
            <SubscriptionOffer offer={subscriptionOffer} />
          </View> : null}

          {gates.daily ? <View testID="home-daily-card" onLayout={exposure.cardLayout('daily')}>
            <GlassPanel tone="cream" style={{ padding: compact ? 8 : 14, gap: compact ? 4 : 6, borderBottomWidth: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="daily" size={22} color={colors.brown} /><AppText preset="title" maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ flex: 1, fontSize: compact ? 16 : 17, color: colors.brown, ...flatTitle }}>Кроссворд дня</AppText></View>
              {!compact ? <AppText preset="body" style={{ color: colors.brown, fontSize: 12 }}>
                {dailyDone ? 'Решено! Завтра — новый кроссворд.' : daily.instances[dailyDate] ? 'Прогресс сохранён — продолжайте.' : 'Новая головоломка каждый день.'}
              </AppText> : null}
              <LinkChip label={dailyDone ? 'Календарь кроссвордов' : 'Открыть кроссворд дня'} visibleLabel={compact ? dailyDone ? 'Решено · календарь' : daily.instances[dailyDate] ? 'Продолжить кроссворд' : 'Играть сегодня' : undefined} compact={compact} icon={dailyDone ? 'check' : 'play'} onPress={openDaily} />
            </GlassPanel>
          </View> : null}

          {completed >= 5 && (canClaimGift || visibleGift !== null) ? <View testID="home-gift-card" onLayout={exposure.cardLayout('gift')}>
            <GlassPanel tone="cream" style={{ padding: compact ? 6 : 12, gap: 5, borderBottomWidth: 3 }}>
              {visibleGift !== null ? <AppText preset="label" maxFontSizeMultiplier={compact ? 1.3 : undefined} accessibilityLiveRegion="polite" style={{ color: colors.playGreenDark, textAlign: 'center', fontSize: 14 }}>Подарок получен · +{visibleGift} монет</AppText> :
                <LinkChip label={pendingGift ? 'Завершить получение подарка' : 'Забрать ежедневный подарок'} visibleLabel={compact ? pendingGift ? 'Получить подарок' : 'Подарок дня' : undefined} compact={compact} icon="chest" onPress={claimGift} />}
              {giftError ? <AppText preset="body" accessibilityLiveRegion="assertive" style={{ color: colors.plumDeep, fontSize: 12 }}>{giftError}</AppText> : null}
            </GlassPanel>
          </View> : null}

          {nextPostcard ? <GlassPanel tone="cream" style={{ padding: compact ? 8 : 12, flexDirection: !compact && fontScale > 1.4 ? 'column' : 'row', alignItems: 'center', gap: compact ? 8 : 10, borderBottomWidth: 3 }}>
            {nextPostcard.image ? <Image source={nextPostcard.image} contentFit="cover" style={{ width: compact ? 32 : 42, height: compact ? 42 : 54, borderRadius: radius.sm, opacity: 0.8 }} /> : <Icon name="collection" size={compact ? 24 : 30} color={colors.plum} />}
            <View style={{ flex: 1, gap: 3, alignSelf: 'stretch' }}>
              <AppText preset="label" maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ color: colors.brown, fontSize: 13 }}>{compact ? 'Далее в альбоме' : 'Следующая открытка'} · {nextPostcard.title}</AppText>
              <AppText preset="body" maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ color: colors.brown, fontSize: 12 }}>{`Ещё ${ruCount(nextPostcard.remaining, 'уровень', 'уровня', 'уровней')}`}</AppText>
              <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.creamDeep, overflow: 'hidden' }}><View style={{ width: `${nextPostcard.fraction * 100}%`, height: '100%', backgroundColor: colors.playGreen }} /></View>
            </View>
          </GlassPanel> : null}

          {gates.daily ? <ReminderAction screen="home" completedLevels={completed} /> : null}

          {featuredRouteCard ? <View onLayout={exposure.cardLayout('postcard')}>
            <GlassPanel tone="cream" style={{ padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 3 }}>
              <Image source={featuredRouteCard.image} contentFit="cover" style={{ width: 82, height: 104, borderRadius: radius.sm }} accessibilityLabel={featuredRouteCard.title} />
              <View style={{ flex: 1, gap: 4 }}>
                <AppText preset="label" style={{ color: colors.brown, fontSize: 12, textTransform: 'uppercase' }}>
                  {completed === 5 ? 'Первая открытка в альбоме' : 'В вашем альбоме'}
                </AppText>
                <AppText preset="title" style={{ color: colors.brown, fontSize: 17, ...flatTitle }} numberOfLines={2}>{featuredRouteCard.title}</AppText>
                {completed === 5 ?
                  <AppText preset="body" style={{ color: colors.brown, fontSize: 12, opacity: 0.76 }}>Открытка получена</AppText> : null}
              </View>
            </GlassPanel>
          </View> : null}

          <GlassPanel tone="cream" style={{ gap: 12, borderBottomWidth: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="journey" color={colors.brown} size={23} />
              <AppText preset="title" style={{ flex: 1, fontSize: 18, color: colors.brown, ...flatTitle }}>Маршрут и альбом</AppText>
            </View>
            {!nextRouteCard ? <AppText preset="body" style={{ color: colors.brown }}>Все фоны маршрута открыты.</AppText> : null}
            {nextGift ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 5 }}>
              <Icon name="chest" size={22} color={colors.plum} />
              <AppText preset="body" style={{ flex: 1, color: colors.brown, fontSize: 13 }}>
                Подарок через {ruCount(nextGift.remaining, 'уровень', 'уровня', 'уровней')} · +{nextGift.amountCoins} монет
              </AppText>
            </View> : null}
            {introAssigned && completed < 5 ? <AppText preset="body" style={{ color: colors.brown, fontSize: 13 }}>Первый маршрут: {completed} из 5 уровней.</AppText> : null}
            {canOpenAlbum ? <LinkChip label={newCount > 0 ? `Альбом · новых: ${newCount}` : 'Открыть альбом'} icon="collection" badge={newCount > 0} onPress={() => { track('home_primary_action', { mode: 'album' }); router.push('/collection' as never); }} /> : null}
          </GlassPanel>

          {gates.week && gates.daily ? <LinkChip label={`Личная неделя · ${week?.activeCount ?? 0} из 5 дней`} icon="daily" onPress={openDaily} /> : null}
          {gates.week && !gates.daily ? <LinkChip label={`Личная неделя · ${week?.activeCount ?? 0} из 5 дней`} icon="daily" onPress={() => { track('home_primary_action', { mode: 'daily' }); router.push('/daily' as never); }} /> : null}
          {gates.quests && quests ? <LinkChip label={`Задания дня · ${quests.quests.filter((q) => q.completed).length} из ${quests.quests.length}`} icon="order" onPress={() => { track('home_secondary_action', { mode: 'quests' }); router.push('/quests' as never); }} /> : null}
          {gates.event ? <LinkChip label={event?.active ? `Собери чемодан · ${ruCount(event.points, 'очко', 'очка', 'очков')}` : 'Собери чемодан'} icon="events" onPress={() => { track('home_secondary_action', { mode: 'event' }); router.push('/journey-event' as never); }} /> : null}

          {completed >= 15 ? <View onLayout={measureHomeEntries} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <LinkChip label="Профиль" icon="profile" onPress={() => { trackRetentionAction('home', 'profile'); router.push('/profile' as never); }} />
            <View ref={wheelEntryNode} testID="home-wheel-entry" collapsable={false} onLayout={measureHomeEntries} style={{ flexGrow: 1 }}>
              <LinkChip label="Колесо" icon="wheel" onPress={() => {
                const interactionId = newMonetizationId('hi');
                trackRetentionAction('home', 'wheel', { entry_source: 'home', interaction_id: interactionId });
                router.push({ pathname: '/wheel', params: { source: 'home', entryInteractionId: interactionId } } as never);
              }} />
            </View>
            {MONETIZATION.iapEnabled ? <LinkChip label="Магазин" icon="shop" onPress={() => router.push('/shop' as never)} /> : null}
          </View> : null}
          </View>
        </ScrollView>
        {completed >= 6 ? <AdBanner /> : null}
      </SafeAreaView>
    </View>
  );
}
