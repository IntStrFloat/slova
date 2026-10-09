import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, FadeInDown, FadeOut, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/core/i18n';
import type { RouteCardProgress } from '@/features/collection/routeProgress';
import type { GiftProgress } from '@/features/progression/store';
import { ruCount } from '@/features/retention-ui/text';
import { AppButton, AppText, colors, Icon, radius, type IconName } from '@/ui';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

function CelebrationMedallion({
  coins,
  rewardPending,
  icon,
  compact,
  showProgress,
}: {
  coins: number;
  rewardPending: boolean;
  icon: IconName;
  compact: boolean;
  showProgress: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const reveal = useSharedValue(reducedMotion || rewardPending ? 1 : 0);
  const burst = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion || rewardPending) {
      reveal.set(1);
      burst.set(0);
      return;
    }
    reveal.set(0);
    burst.set(0);
    reveal.set(withDelay(80, withSpring(1, { duration: 400, dampingRatio: 0.8 })));
    burst.set(withDelay(170, withTiming(1, { duration: 680, easing: EASE_OUT })));
    return () => {
      cancelAnimation(reveal);
      cancelAnimation(burst);
    };
  }, [burst, reducedMotion, reveal, rewardPending]);
  const coreStyle = useAnimatedStyle(() => ({
    opacity: reveal.get(),
    transform: [{ scale: 0.92 + reveal.get() * 0.08 }],
  }));
  const burstStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.get(), [0, 0.22, 0.65, 1], [0, 0.82, 0.46, 0]),
    transform: [{ scale: 0.82 + burst.get() * 0.55 }],
  }));
  return (
    <View
      style={[styles.celebrationShell, compact && styles.compactShell, compact && showProgress && styles.progressShell]}
      accessible
      accessibilityLabel={rewardPending ? 'Сохраняем прогресс' : `Получено ${ruCount(coins, 'монета', 'монеты', 'монет')}`}
    >
      {!reducedMotion && !rewardPending ? (
        <Animated.View pointerEvents="none" style={[styles.celebrationHalo, burstStyle]}>
          <View style={[styles.sparkle, styles.sparkleTop]}><Icon name="star" size={15} color={colors.goldBorder} /></View>
          <View style={[styles.sparkle, styles.sparkleRight]}><Icon name="star" size={11} color={colors.cream} /></View>
          <View style={[styles.sparkle, styles.sparkleBottom]}><Icon name="star" size={13} color={colors.goldBorder} /></View>
        </Animated.View>
      ) : null}
      <Animated.View style={[styles.rewardMedallion, compact && styles.compactMedallion, compact && showProgress && styles.progressMedallion, coreStyle]}>
        <Icon name={icon} size={compact && showProgress ? 24 : compact ? 30 : 36} color={colors.goldBorder} />
        {rewardPending ? <AppText preset="label" style={styles.medallionPending}>Сохраняем</AppText>
          : <AppText preset="display" style={[styles.medallionValue, compact && showProgress && styles.progressMedallionValue]}>+{coins}</AppText>}
        <AppText preset="body" style={styles.medallionLabel}>{rewardPending ? 'прогресс' : 'монет'}</AppText>
      </Animated.View>
    </View>
  );
}

function ProgressRow({
  kind,
  image,
  title,
  completedInStep,
  stepLevels,
  remaining,
  reward,
  compact,
}: {
  kind: 'card' | 'gift';
  image?: number;
  title: string;
  completedInStep: number;
  stepLevels: number;
  remaining: number;
  reward?: string;
  compact: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const fraction = Math.min(1, Math.max(0, completedInStep / Math.max(1, stepLevels)));
  const previousFraction = Math.min(fraction, Math.max(0, (completedInStep - 1) / Math.max(1, stepLevels)));
  const fill = useSharedValue(reducedMotion ? fraction : previousFraction);
  useEffect(() => {
    fill.set(reducedMotion ? fraction : withDelay(350, withTiming(fraction, {
      duration: 650,
      easing: EASE_OUT,
    })));
  }, [fill, fraction, reducedMotion]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.get() * 100}%` as `${number}%` }));

  return (
    <View
      style={[styles.progressRow, compact && styles.progressRowCompact]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${kind === 'card' ? 'Следующий фон' : 'Следующий подарок'}: ${title}. Осталось ${ruCount(remaining, 'уровень', 'уровня', 'уровней')}. Прогресс ${completedInStep} из ${stepLevels}.`}
    >
      {image ? <Image source={image} contentFit="cover" style={[styles.progressArtwork, compact && styles.progressArtworkCompact]} /> :
        <View style={[styles.progressGiftIcon, compact && styles.progressArtworkCompact]}><Icon name="chest" size={compact ? 21 : 25} color={colors.cream} /></View>}
      <View style={styles.progressDetails}>
        <View style={styles.progressHeader}>
          <AppText preset="label" style={styles.progressHeading}>{kind === 'card' ? 'Следующий фон' : 'Следующий подарок'}</AppText>
          <AppText preset="label" style={styles.progressCount}>{completedInStep}/{stepLevels}</AppText>
        </View>
        <AppText preset="body" numberOfLines={1} style={styles.progressSubline}>{title}{reward ? ` · ${reward}` : ''}</AppText>
        <View style={[styles.progressTrack, compact && styles.progressTrackCompact]}><Animated.View style={[styles.progressFill, fillStyle]} /></View>
        <AppText preset="body" style={styles.progressRemaining}>Осталось {remaining} ур.</AppText>
      </View>
    </View>
  );
}

export function LevelComplete({
  coins, onNext, onMenu, onDouble, canDouble = false, doubled = false,
  title, subtitle, bonusLines = [], nextLabel, journeyFinal = false,
  heroIcon, heroImage, heroCaption,
  cardProgress, giftProgress: nextGiftProgress,
  rewardPending = false, saveError, onRetrySave,
  introComplete = false, onDaily,
}: {
  coins: number;
  onNext: () => boolean | void | Promise<boolean | void>;
  onMenu?: () => void | Promise<void>;
  onDouble?: () => void | Promise<void>;
  canDouble?: boolean;
  doubled?: boolean;
  title?: string;
  subtitle?: string;
  bonusLines?: { label: string; value: string }[];
  nextLabel?: string;
  journeyFinal?: boolean;
  heroIcon?: IconName;
  heroImage?: number;
  heroCaption?: string;
  cardProgress?: RouteCardProgress | null;
  giftProgress?: GiftProgress | null;
  rewardPending?: boolean;
  saveError?: string;
  onRetrySave?: () => void;
  introComplete?: boolean;
  onDaily?: () => boolean | void | Promise<boolean | void>;
}) {
  const showDouble = canDouble && !doubled && onDouble && coins > 0 && !rewardPending;
  const [locked, setLocked] = useState(false);
  const [showCardReveal, setShowCardReveal] = useState(introComplete);
  const reducedMotion = useReducedMotion();
  const { height, width } = useWindowDimensions();
  const compact = height < 720;
  const compactIntro = compact && introComplete;
  const showProgress = !rewardPending && !showCardReveal && (cardProgress != null || nextGiftProgress != null);
  const rewardEntrance = reducedMotion ? FadeIn.duration(120) : FadeInDown.duration(260).delay(80);

  const nextOnce = async () => {
    if (locked) return;
    if (heroImage && !showCardReveal) {
      setShowCardReveal(true);
      return;
    }
    setLocked(true);
    try {
      const advanced = await onNext();
      if (advanced === false) setLocked(false);
    } catch {
      setLocked(false);
    }
  };
  const doubleOnce = async () => {
    if (locked || !onDouble) return;
    setLocked(true);
    try { await onDouble(); } finally { setLocked(false); }
  };
  const dailyOnce = async () => {
    if (locked || !onDaily) return;
    setLocked(true);
    try { if (await onDaily() === false) setLocked(false); } catch { setLocked(false); }
  };
  const menuOnce = async () => {
    if (locked || !onMenu) return;
    setLocked(true);
    try { await onMenu(); } catch { setLocked(false); }
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void menuOnce();
      return true;
    });
    return () => subscription.remove();
  });

  return (
      <Animated.View
        entering={reducedMotion ? FadeIn.duration(120) : FadeIn.duration(180)}
        exiting={reducedMotion ? FadeOut.duration(100) : FadeOut.duration(240)}
        style={styles.screen}
        accessibilityViewIsModal
        accessibilityLiveRegion="polite"
      >
        <LinearGradient colors={['rgba(31,18,42,0.55)', 'rgba(31,18,42,0.28)', 'rgba(31,18,42,0.52)']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <SafeAreaView style={styles.safe}>
          <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, compact && styles.compactContent, compact && showProgress && styles.progressContentCompact, compactIntro && { gap: 8, paddingTop: 6 }]} showsVerticalScrollIndicator={false}>
            <Animated.View entering={reducedMotion ? FadeIn.duration(120) : FadeInDown.duration(280).delay(100)} style={styles.heading}>
              {!compactIntro ? <><View style={styles.eyebrowLine} /><AppText preset="label" style={styles.eyebrow}>ПОЗДРАВЛЯЕМ</AppText></> : null}
              <AppText preset="display" maxFontSizeMultiplier={compactIntro ? 1.3 : undefined} style={[styles.title, width < 350 && styles.narrowTitle, compactIntro && { fontSize: 21, lineHeight: 28 }]}>{showCardReveal ? 'Новая открытка!' : title ?? t('levelComplete')}</AppText>
              {subtitle ? <AppText preset="body" style={styles.subtitle}>{subtitle}</AppText> : null}
            </Animated.View>

            <View style={[styles.rewardArea, compact && styles.compactRewardArea]}>
              {heroImage && showCardReveal ? (
                <Animated.View entering={rewardEntrance} style={styles.postcardReveal}>
                  <Image source={heroImage} contentFit="cover" style={[styles.postcardImage, compact && styles.compactPostcardImage, compact && showProgress && styles.progressPostcardImage, compactIntro && { width: 80, height: 106 }]} accessibilityLabel={heroCaption ?? 'Полученная открытка'} />
                  {heroCaption ? <AppText preset="label" maxFontSizeMultiplier={compactIntro ? 1.3 : undefined} style={[styles.postcardCaption, compactIntro && { fontSize: 12 }]} numberOfLines={2}>{heroCaption}</AppText> : null}
                </Animated.View>
              ) : coins > 0 || rewardPending ? (
                <CelebrationMedallion coins={coins} rewardPending={rewardPending} icon={heroIcon ?? (journeyFinal ? 'journey' : 'check')} compact={compact} showProgress={showProgress} />
              ) : null}
              {heroImage && showCardReveal && !rewardPending && coins > 0 ? (
                <View style={styles.coinPill}><Icon name="coin" size={20} color={colors.goldBorder} /><AppText preset="title" style={styles.coinPillText}>+{coins}</AppText></View>
              ) : null}
              {introComplete && !rewardPending ? <View style={[styles.returnReason, compactIntro && { padding: 8, gap: 4 }]}>
                <AppText preset="label" maxFontSizeMultiplier={compactIntro ? 1.3 : undefined} style={[styles.returnReasonTitle, compactIntro && { fontSize: 13 }]}>Первая открытка — ваша!</AppText>
                <AppText preset="body" maxFontSizeMultiplier={compactIntro ? 1.3 : undefined} style={[styles.returnReasonText, compactIntro && { fontSize: 12 }]}>{compactIntro ? 'Завтра — новый кроссворд и ежедневный подарок.' : 'Кроссворд дня уже открыт. Завтра вас ждёт новая головоломка и ежедневный подарок.'}</AppText>
              </View> : null}
              {showProgress ? (
                <View style={[styles.milestones, compact && styles.compactMilestones]}>
                  {cardProgress ? (
                    <ProgressRow
                      kind="card"
                      image={cardProgress.nextCardImage}
                      title={cardProgress.nextCardTitle}
                      completedInStep={cardProgress.completedInStep}
                      stepLevels={cardProgress.stepLevels}
                      remaining={cardProgress.remaining}
                      compact={compact}
                    />
                  ) : null}
                  {nextGiftProgress ? (
                    <ProgressRow
                      kind="gift"
                      title="Монеты на подсказки"
                      completedInStep={nextGiftProgress.completedInStep}
                      stepLevels={nextGiftProgress.stepLevels}
                      remaining={nextGiftProgress.remaining}
                      reward={`+${nextGiftProgress.amountCoins}`}
                      compact={compact}
                    />
                  ) : null}
                </View>
              ) : journeyFinal ? <AppText preset="body" style={styles.journeyComplete}>Все открытки и подарки маршрута собраны</AppText> : null}
              {bonusLines.length > 0 && !showProgress ? (
                <View style={styles.breakdown}>
                  {bonusLines.map((line) => (
                    <View key={line.label} style={styles.breakdownRow}>
                      <AppText preset="body" style={styles.breakdownLabel}>{line.label}</AppText>
                      <AppText preset="label" style={styles.breakdownValue}>{line.value}</AppText>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

          </ScrollView>

            <View style={styles.footer}>
              {saveError ? (
                <View style={styles.saveError}>
                  <AppText preset="body" accessibilityLiveRegion="assertive" style={styles.saveErrorText}>{saveError}</AppText>
                  {onRetrySave ? <AppButton label="Повторить сохранение" variant="glass" onPress={onRetrySave} style={styles.retryButton} /> : null}
                </View>
              ) : null}
              {rewardPending ? <AppText preset="body" accessibilityLiveRegion="polite" style={styles.pendingText}>
                {saveError ? 'Награда ожидает сохранения' : 'Сохраняем награду…'}
              </AppText> : null}
              {doubled ? <AppText preset="body" style={styles.doubledText}>{t('doubled')}</AppText> : null}
              {!rewardPending ? (
                <View style={styles.actions}>
                  <AppButton
                    label={heroImage && !showCardReveal ? 'Открыть' : introComplete ? 'Продолжить уровни' : nextLabel ?? t('next')}
                    icon={heroImage && !showCardReveal ? 'collection' : journeyFinal ? 'journey' : 'play'}
                    large disabled={locked} onPress={() => void nextOnce()} style={styles.nextButton}
                  />
                  {introComplete && onDaily ? <AppButton label="Открыть кроссворд дня" icon="daily" variant="glass" disabled={locked} onPress={() => void dailyOnce()} style={styles.secondaryButton} /> : null}
                  {showDouble ? <AppButton label={t('doubleReward')} icon="play" variant="accent" disabled={locked} onPress={() => void doubleOnce()} style={styles.secondaryButton} /> : null}
                  {onMenu ? (
                    <Pressable onPress={() => void menuOnce()} disabled={locked} accessibilityRole="button" accessibilityState={{ disabled: locked }} style={styles.menuButton}>
                      <Icon name="back" size={18} color={colors.text} /><AppText preset="label" style={styles.menuLabel}>В меню</AppText>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
        </SafeAreaView>
      </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 5 },
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between', gap: 20, paddingHorizontal: 20, paddingTop: 32, paddingBottom: 18 },
  compactContent: { gap: 12, paddingTop: 18, paddingBottom: 8 },
  progressContentCompact: { justifyContent: 'flex-start', gap: 8, paddingTop: 12, paddingBottom: 8 },
  heading: { alignItems: 'center', width: '100%', maxWidth: 450, gap: 9 },
  eyebrowLine: { width: 34, height: 3, borderRadius: radius.pill, backgroundColor: colors.goldBorder },
  eyebrow: { color: colors.cream, fontSize: 11, letterSpacing: 1.5, textAlign: 'center' },
  title: { color: colors.text, textAlign: 'center', fontSize: 27, lineHeight: 35 },
  narrowTitle: { fontSize: 23, lineHeight: 31 },
  subtitle: { color: colors.cream, textAlign: 'center', fontSize: 13, lineHeight: 20, maxWidth: 340 },
  rewardArea: { alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 380, gap: 12 },
  compactRewardArea: { gap: 8 },
  celebrationShell: { width: 154, height: 154, alignItems: 'center', justifyContent: 'center' },
  compactShell: { width: 120, height: 120 },
  progressShell: { width: 82, height: 82 },
  celebrationHalo: { position: 'absolute', top: -17, right: -17, bottom: -17, left: -17, borderRadius: 120, borderWidth: 2, borderColor: colors.goldBorder },
  sparkle: { position: 'absolute', width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  sparkleTop: { top: -12, left: 8 },
  sparkleRight: { top: 22, right: -12 },
  sparkleBottom: { bottom: -13, left: 20 },
  rewardMedallion: { width: 154, height: 154, borderRadius: 77, borderWidth: 2, borderColor: 'rgba(255,251,226,0.70)', backgroundColor: 'rgba(39,26,48,0.58)', alignItems: 'center', justifyContent: 'center', gap: 2, boxShadow: '0 10px 28px rgba(14,12,24,0.35)' },
  compactMedallion: { width: 120, height: 120, borderRadius: 60 },
  progressMedallion: { width: 82, height: 82, borderRadius: 41 },
  medallionValue: { color: colors.cream, fontSize: 28, lineHeight: 34 },
  progressMedallionValue: { fontSize: 23, lineHeight: 27 },
  medallionLabel: { color: colors.cream, fontSize: 12 },
  medallionPending: { color: colors.cream, fontSize: 13 },
  postcardReveal: { alignItems: 'center', gap: 7 },
  postcardImage: { width: 164, height: 218, borderRadius: radius.sm, borderWidth: 3, borderColor: colors.cream, boxShadow: '0 12px 26px rgba(5,7,12,0.5)' },
  compactPostcardImage: { width: 126, height: 166 },
  progressPostcardImage: { width: 90, height: 115 },
  postcardCaption: { color: colors.cream, fontSize: 13, textAlign: 'center', maxWidth: 250 },
  coinPill: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: 'rgba(28,20,36,0.78)', borderWidth: 1, borderColor: 'rgba(255,251,226,0.38)' },
  coinPillText: { color: colors.cream, fontSize: 17 },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.creamDeep, overflow: 'hidden' },
  progressTrackCompact: { height: 6 },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.playGreen },
  milestones: { width: '100%', gap: 7 },
  compactMilestones: { gap: 5 },
  progressRow: { width: '100%', minHeight: 75, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 8, borderRadius: radius.md, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.goldBorder },
  progressRowCompact: { minHeight: 62, gap: 7, padding: 6 },
  progressArtwork: { width: 40, height: 54, borderRadius: 7 },
  progressArtworkCompact: { width: 35, height: 47 },
  progressGiftIcon: { width: 40, height: 54, borderRadius: 8, backgroundColor: colors.plum, alignItems: 'center', justifyContent: 'center' },
  progressDetails: { flex: 1, gap: 2 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  progressHeading: { color: colors.brown, fontSize: 11, flexShrink: 1 },
  progressCount: { color: colors.playGreenDark, fontSize: 11 },
  progressSubline: { color: colors.brown, fontSize: 10 },
  progressRemaining: { color: colors.brown, fontSize: 10 },
  journeyComplete: { color: colors.cream, fontSize: 13, textAlign: 'center' },
  returnReason: { width: '100%', padding: 14, borderRadius: radius.md, backgroundColor: colors.cream, gap: 6 },
  returnReasonTitle: { color: colors.brown, fontSize: 16, textAlign: 'center' },
  returnReasonText: { color: colors.brown, fontSize: 13, textAlign: 'center' },
  breakdown: { width: '100%', borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.goldBorder, gap: 5 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 25 },
  breakdownLabel: { color: colors.brown, flex: 1, fontSize: 12 },
  breakdownValue: { color: colors.plumDeep, fontSize: 12 },
  footer: { width: '100%', maxWidth: 380, alignSelf: 'center', alignItems: 'center', gap: 9, paddingHorizontal: 20, paddingBottom: 10 },
  saveError: { width: '100%', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.goldBorder },
  saveErrorText: { color: colors.brown, textAlign: 'center', fontSize: 13 },
  retryButton: { alignSelf: 'stretch' },
  pendingText: { color: colors.cream, fontSize: 13, textAlign: 'center' },
  doubledText: { color: colors.cream, fontSize: 13 },
  actions: { width: '100%', alignItems: 'center', gap: 5 },
  nextButton: { alignSelf: 'stretch', backgroundColor: colors.playGreenDark, borderWidth: 2, borderColor: colors.playGreen },
  secondaryButton: { alignSelf: 'stretch' },
  menuButton: { minHeight: 48, minWidth: 130, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  menuLabel: { color: colors.text, fontSize: 13 },
});
