import * as Haptics from 'expo-haptics';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { cancelAnimation, FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { RETENTION } from '@/core/config/retention';
import { ECONOMY } from '@/core/config/economy';
import { latestLandmarkAt, landmarkUnlockedAt } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import { useGoBack } from '@/core/nav';
import { KEYS, setString } from '@/core/storage';
import { dayKey } from '@/core/time';
import { cellKey, isLevelComplete } from '@/core/engine';
import type { HintType, SubmitResult } from '@/core/engine/types';
import { setYandexGameplayActive } from '@/core/platform/yandexGames';
import { getAnalyticsSession, track, trackGameplayAction, trackOnce } from '@/features/analytics';
import { puzzleIdentity, trackPuzzleEntry } from '@/features/analytics/puzzleLifecycle';
import { trackObservedRetentionMilestones } from '@/features/analytics/retentionEvents';
import { playSfx } from '@/features/audio';
import { useCollection } from '@/features/collection';
import { routeCardProgress } from '@/features/collection/routeProgress';
import { useCurrency } from '@/features/currency';
import { useSettings } from '@/features/settings';
import { useDailyPuzzle, type DailyPuzzleInstance } from '@/features/dailypuzzle';
import { hasIntroPackAssignment, useIntroGuide } from '@/features/onboarding';
import { recordIntroDemoHelpUsed } from '@/features/onboarding/introGuide';
import { firstUnsolvedIntroWord, isFreeIntroHelpLevel } from '@/features/onboarding/onboardingHelp';
import { trackReminderGameplay } from '@/features/notifications';
import { getFeatureGates, getWeeklyStatus, recordWord, reconcileRewards, useRetention, type RewardGrant } from '@/features/retention';
import {
  CrosswordGrid,
  LetterDisk,
  LevelComplete,
  LevelObjective,
  useGame,
} from '@/features/game';
import { calculateGameLayout, minimumLetterDiskSize, preferredLetterDiskSize } from '@/features/game/layout';
import { useGameplayClock } from '@/features/game/useGameplayClock';
import { reconcileAcceptedWords } from '@/features/game/bonusReplay';
import type { FeedbackKind } from '@/features/game/accessibility';
import { clueForUnsolved } from '@/features/game/editorialClues';
import { claimHelpNudge, dismissHelpNudge, isStalled } from '@/features/game/helpNudge';
import { hasClosedCell, replayPendingLetterHint, revealLetter } from '@/features/game/hintJournal';
import { loadGameSnapshot, restoreGame } from '@/features/game/persistence';
import { getSavedPuzzleRewards, settlePuzzleCompletion, type SettlementResult } from '@/features/game/settlement';
import { hintCost, purchaseSemanticClue, SEMANTIC_CLUE_COST } from '@/features/hints';
import { giftProgress } from '@/features/progression/store';
import { ruCount } from '@/features/retention-ui/text';
import { requestCampaignReview } from '@/features/review';
import { useLeaderboard } from '@/features/leaderboard';
import { DEFAULT_WORLD, loadGlobalLevel, useLevels, totalLevelCount } from '@/features/levels';
import {
  AdBanner,
  getAds,
  isRewardedReady,
  loadAdsMeta,
  MONETIZATION,
  NoCoinsModal,
  evaluateInterstitial,
  recordInterstitialShown,
  recordRewardedShown,
  recordVisibleGameplay,
  requestRewarded,
  saveAdsMeta,
  useEntitlements,
} from '@/features/monetization';
import { AppButton, AppText, CoinBadge, colors, GlassPanel, Icon, radius, shadowCard, WorldBackground, type IconName } from '@/ui';

const HINT_BUTTON_SIZE = 56;
const RADIAL_HINT_EXTRA = 0;

type SaveFailure = { message: string; action: 'word' | 'hint' | 'clue' | 'shuffle' | 'start' | 'replay' | 'completion' | 'finish'; word?: string };

const REWARD_SOURCE_LABEL: Record<string, string> = {
  quest: 'Задание дня',
  'quest-compensation': 'Задание дня',
  week: 'Личная неделя',
  event: 'Собери чемодан',
  marathon: 'Марафон слов',
  bonus: 'Бонусное слово',
  'bonus-bank': 'Копилка бонусных слов',
  'legacy-objective': 'Цель уровня',
  'legacy-milestone': 'Сундук маршрута',
};

function rewardBreakdown(effects: RewardGrant[], postcardShown: boolean) {
  const coins = new Map<string, number>();
  let postcards = 0;
  for (const effect of effects) {
    if (effect.kind === 'coins') {
      if (effect.source === 'campaign' || effect.source === 'daily') continue;
      const label = REWARD_SOURCE_LABEL[effect.source] ?? 'Дополнительная награда';
      coins.set(label, (coins.get(label) ?? 0) + (effect.amount ?? 0));
    } else if (effect.kind === 'collectible' && effect.collectibleId && !postcardShown) {
      postcards += 1;
    }
  }
  return [
    ...[...coins].map(([label, amount]) => ({ label, value: `+${amount}` })),
    ...(postcards > 0 ? [{ label: 'Открытки', value: `+${postcards}` }] : []),
  ];
}

function HintChip({
  icon,
  label,
  cost,
  onPress,
  style,
}: {
  icon: IconName;
  label: string;
  cost: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={cost === 0 ? `${label}, бесплатно` : `${label}, ${cost} монет`}
      style={({ pressed }) => [
        shadowCard,
        {
          width: HINT_BUTTON_SIZE,
          height: HINT_BUTTON_SIZE,
          backgroundColor: colors.plum,
          borderRadius: HINT_BUTTON_SIZE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          borderWidth: 1.5,
          borderColor: colors.goldBorder,
        },
        style,
        { transform: [{ scale: pressed ? 0.95 : 1 }] },
      ]}
    >
      <Icon name={icon} size={25} color={colors.cream} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {cost > 0 ? <Icon name="coin" size={10} color={colors.goldBorder} /> : null}
        <AppText preset="body" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}
          maxFontSizeMultiplier={cost === 0 ? 1.3 : undefined}
          style={{ maxWidth: HINT_BUTTON_SIZE - 8, fontSize: cost === 0 ? 9 : 11, color: colors.goldBorder }}>{cost === 0 ? 'Бесплатно' : cost}</AppText>
      </View>
    </Pressable>
  );
}

function BonusBankChip({ units, foundWords, onPress, style }: {
  units: number;
  foundWords: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const entrance = useSharedValue(0);
  const previousFoundWords = useRef(foundWords);
  useEffect(() => {
    entrance.set(reducedMotion ? 1 : withSpring(1, { duration: 420, dampingRatio: 0.8 }));
    return () => cancelAnimation(entrance);
  }, [entrance, reducedMotion]);
  useEffect(() => {
    if (foundWords > previousFoundWords.current && !reducedMotion) {
      entrance.set(0);
      entrance.set(withSpring(1, { duration: 420, dampingRatio: 0.8 }));
    }
    previousFoundWords.current = foundWords;
  }, [entrance, foundWords, reducedMotion]);
  const animatedStyle = useAnimatedStyle(() => {
    const progress = entrance.get();
    return {
      opacity: progress,
      transform: [
        { translateX: (progress - 1) * 72 },
        { translateY: (1 - progress) * 72 },
        { scale: 0.8 + progress * 0.2 },
      ],
    };
  });
  return (
    <Animated.View style={[style, animatedStyle]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Копилка бонусных слов, ${units} из ${ECONOMY.bonusBankThreshold}. Подробнее.`}
        style={({ pressed }) => [shadowCard, {
          width: HINT_BUTTON_SIZE,
          height: HINT_BUTTON_SIZE,
          backgroundColor: colors.plum,
          borderRadius: HINT_BUTTON_SIZE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          borderWidth: 1.5,
          borderColor: colors.goldBorder,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        }]}
      >
        <MaterialCommunityIcons name="piggy-bank" size={27} color={colors.cream} />
        <AppText preset="body" style={{ fontSize: 11, color: colors.goldBorder }}>{units}/{ECONOMY.bonusBankThreshold}</AppText>
      </Pressable>
    </Animated.View>
  );
}

function IconButton({ name, onPress }: { name: 'back'; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Меню уровня"
      hitSlop={10}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
          backgroundColor: colors.plum,
          borderWidth: 1.5,
          borderColor: colors.goldBorder,
        ...shadowCard,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Icon name={name} size={24} color={colors.text} />
    </Pressable>
  );
}

export default function GameScreen() {
  const router = useRouter();
  const goBack = useGoBack();
  const reducedMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const { mode, date, previewLevel, source } = useLocalSearchParams<{ mode?: string; date?: string; previewLevel?: string; source?: string }>();
  const isDaily = mode === 'daily';
  const requestedPreviewLevel = __DEV__ && !isDaily && typeof previewLevel === 'string' ? Number(previewLevel) : NaN;
  const previewLevelId = Number.isInteger(requestedPreviewLevel)
    && requestedPreviewLevel >= 1 && requestedPreviewLevel <= totalLevelCount()
    ? requestedPreviewLevel : null;

  const currentLevel = useLevels((s) => s.currentLevel);
  const start = useGame((s) => s.start);
  const submit = useGame((s) => s.submit);
  const doShuffle = useGame((s) => s.doShuffle);
  const completion = useGame((s) => s.completion);
  const liveLevelId = useGame((s) => s.level?.globalId ?? s.level?.id ?? null);
  const markRewardClaimed = useGame((s) => s.markRewardClaimed);
  const finish = useGame((s) => s.finish);
  const disk = useGame((s) => s.disk);
  const play = useGame((s) => s.play);
  const hintsUsed = useGame((s) => s.hintsUsed);
  const mistakes = useGame((s) => s.mistakes);
  const activeAttemptId = useGame((s) => s.snapshot?.attemptId);
  const coins = useCurrency((s) => s.coins);
  const bonusBankUnits = useRetention((s) => s.bonusBankUnits);
  const removeAds = useEntitlements((s) => s.removeAds);
  const haptics = useSettings((s) => s.haptics);
  const [pendingHint, setPendingHint] = useState<'bulb' | 'clue' | null>(null);
  const [bonusExpanded, setBonusExpanded] = useState(false);
  const [tapSelecting, setTapSelecting] = useState(false);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  const [idleSec, setIdleSec] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [clueOpen, setClueOpen] = useState(false);
  const [clueUsed, setClueUsed] = useState(false);
  const [helpAccent, setHelpAccent] = useState(false);
  const [shuffleQuietUntil, setShuffleQuietUntil] = useState(0);
  const [saveError, setSaveError] = useState<SaveFailure | null>(null);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [routeFocused, setRouteFocused] = useState(true);
  const [resultReadyFor, setResultReadyFor] = useState<string | null>(null);
  // Гарды от двойного начисления награды при быстром повторном тапе.
  const claiming = useRef(false);
  const settling = useRef(false);
  const hintBusy = useRef(false);
  const focused = useRef(true);
  const appActive = useRef(AppState.currentState === 'active');
  const enteredAttempt = useRef<string | null>(null);

  // Keep the result on its solved puzzle while durable progress advances.
  const [campaignLevelId, setCampaignLevelId] = useState(() => {
    if (previewLevelId !== null) return previewLevelId;
    const saved = loadGameSnapshot('normal');
    if (saved && (saved.completion.status === 'completion_pending' || saved.completion.status === 'reward_claimed')) {
      const solvedLevel = loadGlobalLevel(saved.globalLevel);
      const restored = solvedLevel && restoreGame(solvedLevel, 'normal', saved);
      if (restored && isLevelComplete(restored.play)) return saved.globalLevel;
    }
    return currentLevel;
  });
  const requestedDailyDate = isDaily ? date ?? useDailyPuzzle.getState().effectiveDay() : null;
  const pinnedBeforeUnlock = Boolean(requestedDailyDate && useDailyPuzzle.getState().instances[requestedDailyDate]);
  const dailyEntryAllowed = !isDaily || RETENTION.featureFlags.daily
    && (getFeatureGates(useRetention.getState()).daily || pinnedBeforeUnlock);
  const [dailyInstance, setDailyInstance] = useState<DailyPuzzleInstance | null>(() =>
    isDaily && dailyEntryAllowed ? useDailyPuzzle.getState().getOrStartDaily(date) : null,
  );
  useEffect(() => {
    if (!isDaily) return;
    if (!dailyEntryAllowed) {
      if (dailyInstance) queueMicrotask(() => setDailyInstance(null));
      return;
    }
    if (dailyInstance?.dateKey === requestedDailyDate) return;
    const next = useDailyPuzzle.getState().getOrStartDaily(requestedDailyDate ?? undefined);
    queueMicrotask(() => setDailyInstance(next));
  }, [dailyEntryAllowed, dailyInstance, isDaily, requestedDailyDate]);
  const selectedDailyDate = requestedDailyDate ?? useDailyPuzzle.getState().effectiveDay();
  const dailyUnavailable = isDaily && !RETENTION.featureFlags.daily;
  const dailyLocked = isDaily && !dailyEntryAllowed && !dailyUnavailable;
  const firstDaily = isDaily && useDailyPuzzle.getState().solvedDates.length === 0;
  const dailyAlreadyDone = !dailyUnavailable && isDaily && useDailyPuzzle.getState().isDone(selectedDailyDate)
    && !loadGameSnapshot('daily', undefined, selectedDailyDate);
  const introPlayer = hasIntroPackAssignment();
  const introCaption = introPlayer && !isDaily && campaignLevelId <= 5
    ? campaignLevelId === 1
      ? (play?.solvedWords.length ? 'Ещё одно слово — и первая победа!' : 'Соедини буквы пальцем, чтобы собрать слово.')
      : campaignLevelId === 2 ? 'Перемешивание помогает увидеть слова. Оно бесплатно.'
      : campaignLevelId === 3 ? 'Нужна помощь? Буква и наводка здесь бесплатны.'
      : campaignLevelId === 4 ? 'Бонусные слова наполняют копилку. Для победы заполни сетку.'
      : 'Собери кроссворд и получи первую открытку.'
    : null;

  const levelId = isDaily
    ? dailyInstance?.level.globalId ?? 0
    : campaignLevelId;
  const level = useMemo(
    () => isDaily ? !dailyEntryAllowed || dailyAlreadyDone || dailyInstance?.dateKey !== selectedDailyDate
      ? null : dailyInstance.level : loadGlobalLevel(campaignLevelId),
    [campaignLevelId, dailyAlreadyDone, dailyEntryAllowed, dailyInstance, isDaily, selectedDailyDate],
  );
  const globalLevelId = level?.globalId ?? level?.id ?? levelId;
  const freeIntroHelp = Boolean(level && isFreeIntroHelpLevel(level, isDaily ? 'daily' : 'normal'));
  const semanticClue = level && play ? clueForUnsolved(level, play.solvedWords) : null;
  // The scripted first gesture teaches input; later words never get a free
  // answer path from the replay control.
  const introDemoWord = level && play && play.solvedWords.length === 0
    ? firstUnsolvedIntroWord(level, play.solvedWords) : null;
  const needsManualWordsAfterReveal = Boolean(level && play && introPlayer && !isDaily
    && globalLevelId >= 1 && globalLevelId <= 5 && hintsUsed.length > 0
    && play.solvedWords.length < level.answers.length
    && level.grid.cells.every((cell) => play.filled[cellKey(cell)] === cell.ch));
  const [playAreaHeight, setPlayAreaHeight] = useState(() => Math.max(0, height - 136));
  const [dailyCaptionHeight, setDailyCaptionHeight] = useState(20);
  const [objectiveHeight, setObjectiveHeight] = useState(60);
  const showObjective = Boolean(level?.mechanic && level.mechanic !== 'classic');
  const preferredDiskSize = preferredLetterDiskSize(level?.letters.length ?? 8);
  const gameLayout = useMemo(
    () => calculateGameLayout({
      availableHeight: playAreaHeight,
      bonusHeight: 0,
      captionHeight: firstDaily || introCaption ? dailyCaptionHeight : 0,
      cols: level?.grid.cols ?? 1,
      hintHeight: RADIAL_HINT_EXTRA,
      objectiveHeight: showObjective ? objectiveHeight : 0,
      rows: level?.grid.rows ?? 1,
      width,
      minDiskSize: firstDaily || (introPlayer && globalLevelId <= 5)
        ? 225
        : minimumLetterDiskSize(level?.letters.length ?? 8, playAreaHeight),
      maxDiskSize: firstDaily
        ? Math.min(preferredDiskSize, playAreaHeight <= 600 ? 260 : 280)
        : introPlayer && globalLevelId <= 5
        ? Math.min(preferredDiskSize, playAreaHeight <= 600 ? 270 : 300)
        : preferredDiskSize,
    }),
    [dailyCaptionHeight, firstDaily, globalLevelId, introCaption, introPlayer, level, objectiveHeight, playAreaHeight, preferredDiskSize, showObjective, width],
  );
  const tinyHeight = playAreaHeight <= 600;
  const { horizontalInset } = gameLayout;
  const radialWidth = Math.min(
    Math.max(1, width - horizontalInset * 2),
    gameLayout.diskSize + HINT_BUTTON_SIZE,
  );
  const radialWheelLeft = (radialWidth - gameLayout.diskSize) / 2;

  const recordHeight = (
    event: LayoutChangeEvent,
    current: number,
    setCurrent: (next: number) => void,
    allowZero = false,
  ) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if ((next > 0 || allowZero) && next !== current) setCurrent(next);
  };

  useEffect(() => {
    if (level) {
      const existing = loadGameSnapshot(isDaily ? 'daily' : 'normal', level, dailyInstance?.dateKey);
      let started = false;
      try {
        start(level, isDaily ? 'daily' : 'normal', dailyInstance?.dateKey);
        started = true;
        replayPendingLetterHint(isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`);
        const saved = useGame.getState().snapshot;
        if (saved) reconcileAcceptedWords(level, isDaily ? 'daily' : 'normal', saved);
      } catch (error) {
        console.warn('[game] start deferred', error);
        queueMicrotask(() => setSaveError(started
          ? { message: 'Прогресс открыт, но часть наград ещё сохраняется. Повторите.', action: 'replay' }
          : { message: 'Не удалось открыть сохранение. Попробуйте ещё раз.', action: 'start' }));
        return;
      }
      const readySnapshot = useGame.getState().snapshot;
      if (readySnapshot && enteredAttempt.current !== readySnapshot.attemptId) {
        const entry = trackPuzzleEntry(level, readySnapshot, { restoredAttemptId: existing?.attemptId, entrySource: source ?? 'direct' });
        if (entry === 'started' && isDaily && dailyInstance) trackOnce('daily_started', dailyInstance.puzzleId, {
          ...puzzleIdentity(level, readySnapshot), dateKey: dailyInstance.dateKey,
          puzzleInstanceId: dailyInstance.puzzleId, variantId: dailyInstance.variantId,
          entrySource: source ?? 'direct', firstTime: true,
        });
        enteredAttempt.current = readySnapshot.attemptId;
      }
      queueMicrotask(() => {
        setPendingHint(null);
        setSettlement(null);
        setIdleSec(0);
        setAttempts(0);
        setClueOpen(false);
        setClueUsed(false);
        setHelpAccent(false);
        setShuffleQuietUntil(0);
        setLevelMenuOpen(false);
        setSaveError(null);
      });
      claiming.current = false;
      settling.current = false;
    }
  }, [level, start, isDaily, globalLevelId, dailyInstance, introPlayer, source]);

  const done = completion.status === 'completion_pending' || completion.status === 'reward_claimed';
  const transitionKey = isDaily ? `daily:${dailyInstance?.dateKey ?? selectedDailyDate}` : `campaign:${levelId}`;
  const showResult = done && resultReadyFor === transitionKey;
  const boardReady = !done && liveLevelId === globalLevelId;
  const flushGameplayTime = useGameplayClock(Boolean(boardReady && level && play && routeFocused
    && !levelMenuOpen && !clueOpen && !saveError && !pendingHint), activeAttemptId);
  useEffect(() => {
    const snapshot = useGame.getState().snapshot;
    if (!boardReady || !routeFocused || !level || !snapshot || !introPlayer || isDaily || globalLevelId !== 1) return;
    trackOnce('onboarding_field_ready', 'intro:first-field:v2', {
      ...puzzleIdentity(level, snapshot), onboardingVersion: level.contentVersion ?? 'intro-v2',
      occurredAtMs: Date.now(),
    });
  }, [boardReady, globalLevelId, introPlayer, isDaily, level, routeFocused]);
  const showGameplay = !showResult && (done || boardReady);
  useEffect(() => {
    if (!done) return;
    // Let the final crossword cells finish their reveal before covering them.
    const timer = setTimeout(() => setResultReadyFor(transitionKey), reducedMotion ? 100 : 380);
    return () => clearTimeout(timer);
  }, [done, reducedMotion, transitionKey]);
  const introGuide = useIntroGuide({
    active: boardReady && introPlayer && !isDaily && !done && routeFocused
      && !levelMenuOpen && !clueOpen && !saveError && !pendingHint && !tapSelecting,
    levelId: globalLevelId,
    solvedCount: play?.solvedWords.length ?? 0,
  });
  useEffect(() => {
    if (introGuide.demoActive && routeFocused && !done) {
      const snapshot = useGame.getState().snapshot;
      try {
        recordIntroDemoHelpUsed(1);
      } catch (error) {
        console.warn('[game] guide assistance measurement deferred', error);
      }
      trackOnce('tutorial_prompt_shown', 'intro:first-prompt:v2', {
        ...(snapshot && level ? puzzleIdentity(level, snapshot) : { levelId: 1 }),
        onboardingVersion: level?.contentVersion ?? 'intro-v2',
      });
    }
  }, [done, introGuide.demoActive, level, routeFocused]);
  const refreshGuidance = introGuide.refreshGuidance;
  const yandexGameplayActive = Boolean(level && play && !done);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    queueMicrotask(() => setRouteFocused(true));
    refreshGuidance();
    return () => {
      focused.current = false;
      queueMicrotask(() => setRouteFocused(false));
    };
  }, [refreshGuidance]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appActive.current = state === 'active';
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!levelMenuOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setLevelMenuOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [levelMenuOpen]);

  useEffect(() => {
    if (!level || !play || done || pendingHint || clueOpen || saveError || levelMenuOpen) return;
    const timer = setInterval(() => {
      if (!focused.current || !appActive.current) return;
      setIdleSec((seconds) => seconds + 5);
      saveAdsMeta(recordVisibleGameplay(loadAdsMeta(), 5));
    }, 5_000);
    return () => clearInterval(timer);
  }, [clueOpen, done, level, levelMenuOpen, pendingHint, play, saveError]);

  useEffect(() => {
    if (!level || !play || done || pendingHint || levelMenuOpen || tapSelecting || !semanticClue
      || clueUsed || helpAccent || idleSec < shuffleQuietUntil
      || !focused.current || !appActive.current
      || !isStalled(idleSec, attempts, introPlayer && !isDaily && globalLevelId <= 5 ? 'intro' : 'standard')) return;
    const puzzleKey = isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`;
    if (!claimHelpNudge(getAnalyticsSession().sessionId, puzzleKey)) return;
    queueMicrotask(() => setHelpAccent(true));
    const snapshot = useGame.getState().snapshot;
    track('help_offer_shown', {
      ...(snapshot ? puzzleIdentity(level, snapshot) : { levelId: globalLevelId }),
      trigger: attempts === 0 ? 'idle' : 'errors', activeTimeMs: snapshot?.activeTimeMs ?? 0,
    });
  }, [attempts, clueUsed, dailyInstance?.dateKey, done, globalLevelId, helpAccent,
    idleSec, introGuide.demoActive, introPlayer, isDaily, level, levelMenuOpen, pendingHint, play, semanticClue,
    shuffleQuietUntil, tapSelecting]);

  useEffect(() => {
    if (introPlayer && !isDaily && globalLevelId <= 5 && completion.status === 'playing') {
      setString(KEYS.introSurface, 'game');
    }
  }, [completion.status, globalLevelId, introPlayer, isDaily]);

  const settleCurrent = () => {
    if (settling.current || !level) return null;
    const game = useGame.getState();
    if (game.completion.status !== 'completion_pending' || !game.snapshot) return null;
    settling.current = true;
    try {
      const result = settlePuzzleCompletion(level, game.mode, game.snapshot, introPlayer);
      setSettlement(result);
      markRewardClaimed();
      setSaveError(null);
      track('level_reward_claimed', {
        levelId: globalLevelId,
        mode: isDaily ? 'daily' : 'campaign',
        completionId: game.completion.completionId,
      });
      return result;
    } catch (error) {
      console.warn('[game] completion settlement deferred', error);
      setSaveError({ message: 'Награда пока не сохранена. Повторите сохранение.', action: 'completion' });
      track('save_failed', { mode: isDaily ? 'daily' : 'campaign', reason: 'completion' });
      return null;
    } finally {
      settling.current = false;
    }
  };

  useEffect(() => {
    if (completion.status === 'completion_pending' && level) queueMicrotask(() => settleCurrent());
    // A completion is also settled synchronously in the input handler; this effect
    // replays a pending snapshot after a process restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completion.status, completion.completionId, level]);

  useEffect(() => {
    if (completion.status !== 'reward_claimed' || settlement || !level) return;
    const puzzleKey = isDaily ? dailyInstance?.dateKey : String(globalLevelId);
    if (!puzzleKey) return;
    const effects = getSavedPuzzleRewards(isDaily ? 'daily' : 'campaign', puzzleKey);
    queueMicrotask(() => setSettlement({
      puzzleKey,
      firstCompletion: false,
      effects,
      collectibleIds: effects.flatMap((effect) => effect.collectibleId ? [effect.collectibleId] : []),
    }));
  }, [completion.status, dailyInstance?.dateKey, globalLevelId, isDaily, level, settlement]);

  useEffect(() => {
    setYandexGameplayActive(yandexGameplayActive);
    return () => setYandexGameplayActive(false);
  }, [yandexGameplayActive]);

  if (!level || !play) {
    return (
      <View style={{ flex: 1 }}>
        <WorldBackground world={DEFAULT_WORLD} dim />
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <AppText preset="title" style={{ textAlign: 'center' }}>{saveError?.message ?? (dailyUnavailable ? 'Кроссворд дня временно недоступен' : dailyLocked ? 'Кроссворд дня откроется после 5 уровней' : dailyAlreadyDone ? 'Кроссворд за эту дату уже решён' : t('comingSoon'))}</AppText>
          {saveError?.action === 'start' && level ? (
            <AppButton label="Повторить открытие" onPress={() => {
              try {
                start(level, isDaily ? 'daily' : 'normal', dailyInstance?.dateKey);
                setSaveError(null);
              } catch {
                setSaveError({ message: 'Сохранение пока недоступно. Попробуйте позже.', action: 'start' });
              }
            }} />
          ) : null}
          <AppButton label={isDaily ? 'К календарю' : t('map')} variant="glass" icon="back" onPress={isDaily ? () => router.replace('/daily' as never) : goBack} />
        </SafeAreaView>
      </View>
    );
  }

  const onWord = (w: string): FeedbackKind => {
    let r: SubmitResult;
    try {
      flushGameplayTime();
      r = submit(w);
      setSaveError(null);
    } catch (error) {
      console.warn('[game] word save deferred', error);
      setSaveError({ message: 'Слово не сохранено. Повторите попытку.', action: 'word', word: w });
      track('save_failed', { mode: isDaily ? 'daily' : 'campaign', reason: 'word' });
      return 'save_error';
    }
    const snapshot = useGame.getState().snapshot;
    trackReminderGameplay('word_submitted');
    trackGameplayAction('word_submitted', {
      ...(snapshot ? puzzleIdentity(level, snapshot) : {}),
      len: w.length,
      levelId: globalLevelId,
      mode: isDaily ? 'daily' : 'campaign',
    });
    track('word_submit_outcome', {
      ...(snapshot ? puzzleIdentity(level, snapshot) : {}),
      kind: r.kind,
      reason: r.kind === 'invalid' ? r.reason : r.kind === 'blocked' ? r.reason : undefined,
      len: w.length,
      levelId: globalLevelId,
      mode: isDaily ? 'daily' : 'campaign',
      contentVersion: level.contentVersion ?? 'legacy',
      policyRevision: level.policyRevision ?? null,
    });
    if (r.kind === 'grid') {
      const answerIndex = level.answers.findIndex((answer) => answer.word === r.word);
      if (snapshot && answerIndex >= 0) track('target_word_accepted', {
        ...puzzleIdentity(level, snapshot), answerIndex,
        activeTimeMs: snapshot.activeTimeMs ?? 0,
        remaining: level.answers.length - (useGame.getState().play?.solvedWords.length ?? 0),
      });
      setIdleSec(0);
      setAttempts(0);
      setBonusExpanded(false);
      setTapSelecting(false);
      setClueOpen(false);
      setHelpAccent(false);
      if (introPlayer && globalLevelId === 1) {
        introGuide.markTargetAccepted();
        trackOnce('first_target_word_accepted', 'intro:first-target:v2', {
          ...(snapshot ? puzzleIdentity(level, snapshot) : { levelId: 1 }),
          activeTimeMs: snapshot?.activeTimeMs ?? 0, occurredAtMs: Date.now(),
        });
        trackOnce('tutorial_prompt_dismissed', 'intro-v1:word', { levelId: 1, reason: 'action_completed' });
      }
      if (helpAccent || hintsUsed.length > 0 || clueUsed || introGuide.guidance.demoHelpedLevelIds.includes(globalLevelId)) track('help_progressed', {
        ...(snapshot ? puzzleIdentity(level, snapshot) : { levelId: globalLevelId }),
        result: 'word_accepted', progress: useGame.getState().play?.solvedWords.length ?? 0,
      });
      playSfx(r.levelComplete ? 'win' : 'correct');
      if (haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (r.kind === 'bonus') {
      setIdleSec(0);
      setAttempts(0);
      setHelpAccent(false);
      setSaveError(null);
      if (introPlayer && globalLevelId === 1) introGuide.markValidInput();
      playSfx('bonus');
      if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (r.kind === 'invalid' || r.kind === 'blocked' || r.kind === 'constraint') {
      playSfx('error');
      if (haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    if (r.kind === 'invalid' || r.kind === 'blocked' || r.kind === 'constraint') {
      setAttempts((current) => current + 1);
    }
    if (r.kind === 'grid' || r.kind === 'bonus') {
      const puzzleKey = isDaily ? dailyInstance?.dateKey : String(globalLevelId);
      if (puzzleKey) {
        try {
          recordWord({
            mode: isDaily ? 'daily' : 'campaign',
            puzzleKey,
            puzzleDay: isDaily ? puzzleKey : undefined,
            actionDay: useGame.getState().wordDates[`${r.kind}:${r.word}`] ?? dayKey(),
            word: r.word,
            bonus: r.kind === 'bonus' && (level.rewardedBonus ?? level.bonusPool).includes(r.word),
            manual: true,
          });
          reconcileRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount));
          trackObservedRetentionMilestones(useRetention.getState());
        } catch (error) {
          console.warn('[game] word reward deferred', error);
          setSaveError({ message: 'Слово сохранено, но награда ещё не записана. Повторите сохранение.', action: 'replay' });
          track('save_failed', { mode: isDaily ? 'daily' : 'campaign', reason: 'word-reward' });
        }
      }
    }
    if (r.kind === 'grid' && r.levelComplete) settleCurrent();
    return r.kind;
  };

  const rewardedToday = new Set([
    ...Object.keys(useRetention.getState().rewardGrants).filter((id) => id.startsWith(`rewarded-hint:${dayKey()}:`)),
    ...Object.keys(useCurrency.getState().appliedRewards).filter((id) => id.startsWith(`rewarded-coins:${dayKey()}:`)),
  ]).size;

  const tryHint = (type: HintType) => {
    if (type !== 'bulb' || hintBusy.current || !hasClosedCell()) return;
    hintBusy.current = true;
    try {
      flushGameplayTime();
      const puzzleKey = isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`;
      const outcome = revealLetter(puzzleKey);
      if (outcome === 'insufficient') {
        setPendingHint(type);
        return;
      }
      if (outcome !== 'applied') return;
      setIdleSec(0);
      setAttempts(0);
      setHelpAccent(false);
      const snapshot = useGame.getState().snapshot;
      const helpProperties = {
        ...(snapshot && level ? puzzleIdentity(level, snapshot) : { levelId: globalLevelId }),
        type: 'letter', paidWith: freeIntroHelp ? 'free' : 'coins', cost: freeIntroHelp ? 0 : hintCost('bulb'),
      };
      track('hint_used', helpProperties);
      track('help_used', helpProperties);
      trackReminderGameplay('hint_used');
      trackGameplayAction('hint_used', { levelId: globalLevelId, mode: isDaily ? 'daily' : 'campaign' });
      if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (useGame.getState().completion.status === 'completion_pending') settleCurrent();
    } catch (error) {
      console.warn('[game] hint deferred', error);
      setSaveError({ message: 'Подсказку не удалось завершить. Проверьте поле и попробуйте ещё раз.', action: 'hint' });
      track('save_failed', { mode: isDaily ? 'daily' : 'campaign', reason: 'hint' });
    } finally {
      hintBusy.current = false;
    }
  };

  const showClue = () => {
    if (!semanticClue || !level || !play) return;
    if (clueOpen) {
      setClueOpen(false);
      return;
    }
    const word = level.answers.find((answer) => !play.solvedWords.includes(answer.word))?.word;
    if (!word) return;
    const puzzleKey = isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`;
    try {
      flushGameplayTime();
      if (purchaseSemanticClue(puzzleKey, level.fingerprint ?? level.contentVersion ?? '', word) === 'insufficient') {
        setPendingHint('clue');
        return;
      }
      setClueOpen(true);
      setClueUsed(true);
      setHelpAccent(false);
      dismissHelpNudge(puzzleKey);
      const snapshot = useGame.getState().snapshot;
      const helpProperties = {
        ...(snapshot ? puzzleIdentity(level, snapshot) : { levelId: globalLevelId }),
        type: 'semantic', paidWith: freeIntroHelp ? 'free' : 'coins', cost: freeIntroHelp ? 0 : SEMANTIC_CLUE_COST,
      };
      track('semantic_clue_opened', helpProperties);
      track('help_used', helpProperties);
      trackReminderGameplay('hint_used');
      introGuide.refreshGuidance();
      trackGameplayAction('hint_used', { levelId: globalLevelId, mode: isDaily ? 'daily' : 'campaign' });
    } catch (error) {
      console.warn('[game] clue save deferred', error);
      setSaveError({ message: 'Не удалось сохранить оплату наводки. Повторите.', action: 'clue' });
    }
  };

  const tryShuffle = () => {
    if (new Set(disk).size < 2) return;
    try {
      doShuffle();
      setSaveError(null);
      setHelpAccent(false);
      setShuffleQuietUntil(idleSec + 15);
      track('shuffle_used', { levelId: globalLevelId, paidWith: 'free', cost: 0 });
    } catch (error) {
      console.warn('[game] shuffle deferred', error);
      setSaveError({ message: 'Не удалось сохранить перемешивание. Повторите.', action: 'shuffle' });
    }
  };

  const onWatchAdForCoins = async () => {
    setPendingHint(null);
    if (rewardedToday >= 3) return;
    const instanceId = `rewarded-coins:${dayKey()}:${Date.now().toString(36)}`;
    const res = await requestRewarded('hint', {
      rewardId: instanceId,
      persistGrant: (id) => useCurrency.getState().addOnce(id, 'coins', ECONOMY.rewardedCoins)
        || useCurrency.getState().hasApplied(id),
    });
    if (res !== 'unavailable') saveAdsMeta(recordRewardedShown(loadAdsMeta()));
    if (res !== 'rewarded') return;
    try {
      useCurrency.getState().addOnce(instanceId, 'coins', ECONOMY.rewardedCoins);
    } catch (error) {
      console.warn('[game] rewarded coin save deferred', error);
      track('save_failed', { mode: isDaily ? 'daily' : 'campaign', reason: 'rewarded-coins' });
      return;
    }
    track('reward_granted', { rewardId: instanceId, amount: ECONOMY.rewardedCoins, source: 'rewarded' });
  };

  const finalize = async () => {
    const meta = loadAdsMeta();
    const ads = getAds();
    const analyticsSession = getAnalyticsSession();
    const decision = evaluateInterstitial(meta, {
      enabled: MONETIZATION.adsEnabled,
      removeAds,
      loaded: ads.isInterstitialReady(),
      nowMs: Date.now(),
      sessionId: analyticsSession.sessionId,
      isFirstAnalyticsSession: analyticsSession.isFirstSession,
      campaignLevelId: isDaily ? null : globalLevelId,
      userContinued: true,
      rewardsCommitted: useGame.getState().completion.status === 'reward_claimed',
      protectedTransition: globalLevelId === 5 && introPlayer
        || globalLevelId >= totalLevelCount()
        || Boolean(settlement?.collectibleIds.length),
    });
    if (!decision.allowed) {
      track('interstitial_skipped', { reason: decision.reason });
      return;
    }
    track('interstitial_eligible', { placement: 'level_complete', levelId: globalLevelId });
    const res = await ads.showInterstitial('level_complete');
    if (res === 'shown') {
      saveAdsMeta(recordInterstitialShown(meta, Date.now(), analyticsSession.sessionId));
      track('interstitial_shown', { placement: 'level_complete' });
    } else if (res === 'unavailable') {
      track('ad_failed', { placement: 'level_complete', kind: 'interstitial' });
    }
  };

  const rewardedBonusPool = level.rewardedBonus ?? level.bonusPool;
  const rewardedBonusFoundWords = play.foundBonus.filter((word) => rewardedBonusPool.includes(word));
  const rewardedBonusFound = rewardedBonusFoundWords.length;
  const clueText = semanticClue
    ? `${semanticClue.targetLength} ${semanticClue.targetLength < 5 ? 'буквы' : 'букв'} · ${semanticClue.clue}`
    : undefined;

  const onNext = async (destination: 'campaign' | 'daily' = 'campaign'): Promise<boolean> => {
    if (claiming.current) return false;
    claiming.current = true;
    if (useGame.getState().completion.status === 'completion_pending') settleCurrent();
    if (useGame.getState().completion.status !== 'reward_claimed') {
      claiming.current = false;
      return false;
    }
    try {
      const globalId = globalLevelId;
      if (isDaily) {
        finish();
        router.replace('/game?mode=normal' as never);
        return true;
      }
      if (destination === 'daily' && introPlayer && globalId === 5) {
        finish();
        setString(KEYS.introSurface, 'menu');
        router.replace('/daily?source=intro_completion' as never);
        return true;
      }
      void useLeaderboard.getState().syncProgress(useLevels.getState().completed.length);
      if (globalId >= totalLevelCount()) {
        finish();
        setString(KEYS.introSurface, 'menu');
        router.replace('/' as never);
        return true;
      }
      const reviewResult = await requestCampaignReview({
        levelId: globalId,
        completedCount: useLevels.getState().completed.length,
        firstCompletion: settlement?.firstCompletion === true,
        postcardMilestone: earnedCard !== null,
        daily: isDaily,
      });
      if (reviewResult === 'skipped') await finalize();
      else track('review_flow_finished', { levelId: globalId, result: reviewResult });
      finish();
      if (introPlayer && globalId === 5) setString(KEYS.introSurface, 'menu');
      setCampaignLevelId(globalId + 1);
      return true;
    } catch (error) {
      console.warn('[game] leaving result deferred', error);
      setSaveError({ message: 'Результат сохранён, но переход пока недоступен. Повторите действие.', action: 'finish' });
      claiming.current = false;
      return false;
    }
  };

  const onExit = () => {
    if (introPlayer && !isDaily && globalLevelId <= 5) {
      setString(KEYS.introSurface, 'menu');
      router.replace('/' as never);
      return;
    }
    goBack();
  };

  const onMenuFromResult = () => {
    if (useGame.getState().completion.status === 'completion_pending') settleCurrent();
    if (useGame.getState().completion.status !== 'reward_claimed') return;
    try {
      finish();
      if (introPlayer && !isDaily && globalLevelId <= 5) setString(KEYS.introSurface, 'menu');
      router.replace('/' as never);
    } catch (error) {
      console.warn('[game] leaving result deferred', error);
      setSaveError({ message: 'Результат сохранён, но выход пока недоступен. Повторите действие.', action: 'finish' });
      throw error;
    }
  };

  const weeklyDays = isDaily ? getWeeklyStatus(useRetention.getState(), dayKey())?.activeCount : null;

  const retrySave = () => {
    const failure = saveError;
    if (!failure) return;
    setSaveError(null);
    try {
      if (failure.action === 'word' && failure.word) onWord(failure.word);
      else if (failure.action === 'hint') tryHint('bulb');
      else if (failure.action === 'clue') showClue();
      else if (failure.action === 'shuffle') tryShuffle();
      else if (failure.action === 'replay') {
        replayPendingLetterHint(isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`);
        const saved = useGame.getState().snapshot;
        if (saved) reconcileAcceptedWords(level, isDaily ? 'daily' : 'normal', saved);
      }
      else if (failure.action === 'completion') settleCurrent();
      else if (failure.action === 'finish') claiming.current = false;
    } catch (error) {
      console.warn('[game] save retry deferred', error);
      setSaveError(failure);
    }
  };

  const campaignRewardReady = !isDaily && completion.status === 'reward_claimed';
  const milestoneCard = campaignRewardReady ? landmarkUnlockedAt(level.world, globalLevelId) : null;
  const earnedCard = milestoneCard && useCollection.getState().has(milestoneCard.id) ? milestoneCard : null;
  const cardProgress = campaignRewardReady ? routeCardProgress(globalLevelId) : null;
  const nextGiftProgress = campaignRewardReady ? giftProgress(globalLevelId) : null;
  const giftAwarded = settlement?.effects.some((effect) => effect.kind === 'coins' && effect.source === 'legacy-milestone') ?? false;
  const settledCoins = settlement?.effects.reduce(
    (amount, effect) => amount + (effect.kind === 'coins' && effect.source !== 'campaign' ? effect.amount ?? 0 : 0), 0,
  ) ?? 0;
  const awardedCoins = completion.status === 'reward_claimed' ? settledCoins : 0;

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world={level.world} image={latestLandmarkAt(level.world, done ? globalLevelId : globalLevelId - 1)?.image} dim />
      {showGameplay ? (
      <Animated.View
        key={transitionKey}
        entering={reducedMotion ? FadeIn.duration(120) : FadeIn.duration(300)}
        exiting={reducedMotion ? FadeOut.duration(100) : FadeOut.duration(150)}
        pointerEvents={done ? 'none' : 'auto'}
        style={{ flex: 1 }}
      >
        <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: horizontalInset, gap: 8 }}>
          <IconButton name="back" onPress={() => setLevelMenuOpen(true)} />
          <AppText
            preset="title"
            numberOfLines={2}
            style={{ flex: 1, textAlign: 'center', fontSize: width <= 370 ? 17 : 19 }}
          >
            {isDaily ? t('daily') : t('level', { n: globalLevelId })}
          </AppText>
          <CoinBadge value={coins} />
        </View>

        <View
          onLayout={(event) => recordHeight(event, playAreaHeight, setPlayAreaHeight)}
          style={{
            flex: 1,
            alignItems: 'center',
            gap: gameLayout.contentGap,
            paddingTop: gameLayout.paddingTop,
            paddingBottom: gameLayout.paddingBottom,
          }}
        >
          <ScrollView
            key={levelId}
            testID="game-board-scroll"
            style={{ flex: 1, width: '100%' }}
            contentContainerStyle={{
              flexGrow: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: gameLayout.contentGap,
              paddingHorizontal: horizontalInset,
            }}
          >
            {(firstDaily || introCaption) && !done ? (
              <AppText
                preset="body"
                onLayout={(event) => recordHeight(event, dailyCaptionHeight, setDailyCaptionHeight)}
                style={{ color: colors.cream, textAlign: 'center', fontSize: 14, lineHeight: 20, paddingHorizontal: 8 }}
              >
                {introCaption ?? 'Реши кроссворд дня и отметь сегодняшний день'}
              </AppText>
            ) : null}
            <ScrollView
              horizontal
              testID="game-grid-scroll"
              style={{ alignSelf: 'stretch', flexGrow: 0 }}
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
              scrollEnabled={gameLayout.grid.width > width - horizontalInset * 2}
            >
              <CrosswordGrid
                level={level}
                filled={play.filled}
                maxWidth={width - horizontalInset * 2}
                maxHeight={gameLayout.grid.height}
              />
            </ScrollView>
            {showObjective ? (
              <View
                onLayout={(event) => recordHeight(event, objectiveHeight, setObjectiveHeight, true)}
                style={{ width: Math.min(340, width - horizontalInset * 2), alignSelf: 'center' }}
              >
                <LevelObjective
                  level={level}
                  foundBonus={rewardedBonusFound}
                  hintsUsed={hintsUsed.length}
                  mistakes={mistakes}
                  solvedWords={play.solvedWords.length}
                  bankUnits={bonusBankUnits}
                  compact={tinyHeight}
                  clue={clueText}
                  clueOpen={clueOpen}
                  clueAccent={helpAccent}
                  cluePrice={freeIntroHelp ? 0 : SEMANTIC_CLUE_COST}
                  onCluePress={semanticClue ? showClue : undefined}
                />
              </View>
            ) : null}
            {needsManualWordsAfterReveal ? (
              <AppText preset="body" accessibilityLiveRegion="polite" style={{ color: colors.amber, textAlign: 'center', fontSize: 12, paddingHorizontal: 12 }}>
                Буквы открыты. Соедини их в слова, чтобы закончить уровень.
              </AppText>
            ) : null}
          </ScrollView>

          <View style={{ flexShrink: 0, alignItems: 'center', paddingHorizontal: horizontalInset }}>
            <View
              style={{ width: radialWidth, height: gameLayout.diskSize + RADIAL_HINT_EXTRA, position: 'relative' }}
            >
              {tapSelecting ? null : (
                <>
                  <HintChip
                    icon="bulb"
                    label="Буква"
                    cost={freeIntroHelp ? 0 : hintCost('bulb')}
                    onPress={() => tryHint('bulb')}
                    style={{ position: 'absolute', left: 0, top: 6, zIndex: 2 }}
                  />
                  {semanticClue && !showObjective && !firstDaily ? (
                    <HintChip
                      icon="wand"
                      label="Наводка"
                      cost={freeIntroHelp ? 0 : SEMANTIC_CLUE_COST}
                      onPress={showClue}
                      style={{ position: 'absolute', right: 0, top: 6, zIndex: 2, borderColor: helpAccent ? colors.amber : colors.goldBorder }}
                    />
                  ) : null}
                </>
              )}
              <View style={{ position: 'absolute', left: radialWheelLeft, top: 0 }}>
                <LetterDisk
                  key={`${isDaily ? 'daily' : 'normal'}:${levelId}`}
                  letters={disk}
                  onWord={onWord}
                  onShuffle={introPlayer && !isDaily && globalLevelId === 1 ? undefined : tryShuffle}
                  size={gameLayout.diskSize}
                  demoWord={introDemoWord ?? undefined}
                  demoLoop={introGuide.demoActive}
                  onUserInteraction={introGuide.onUserInteraction}
                  onUserInteractionEnd={introGuide.onInteractionEnd}
                  onTapSelectionChange={setTapSelecting}
                  interactionGuardMs={350}
                />
              </View>
              {bonusBankUnits > 0 || rewardedBonusFound > 0 ? (
                <BonusBankChip
                  units={bonusBankUnits}
                  foundWords={rewardedBonusFound}
                  onPress={() => setBonusExpanded((value) => !value)}
                  style={{ position: 'absolute', left: 0, bottom: 6, zIndex: 3, display: tapSelecting ? 'none' : 'flex' }}
                />
              ) : null}
              {bonusExpanded && !tapSelecting ? (
                <GlassPanel tone="cream" style={{ position: 'absolute', left: 0, bottom: HINT_BUTTON_SIZE + 16, zIndex: 4, width: Math.min(260, radialWidth - 8), padding: 12, gap: 6 }}>
                  <AppText preset="label" style={{ color: colors.brown, fontSize: 14 }}>Копилка · {bonusBankUnits}/{ECONOMY.bonusBankThreshold}</AppText>
                  <AppText preset="body" style={{ color: colors.brown, fontSize: 12 }}>
                    Ещё {ruCount(ECONOMY.bonusBankThreshold - bonusBankUnits, 'бонусное слово', 'бонусных слова', 'бонусных слов')} — и +{ECONOMY.bonusBankCoins} монет.
                  </AppText>
                  {rewardedBonusFoundWords.length > 0 ? (
                    <AppText preset="body" style={{ color: colors.brown, fontSize: 12 }}>
                      Найдено здесь: {rewardedBonusFoundWords.map((word) => word.toUpperCase()).join(', ')}
                    </AppText>
                  ) : null}
                </GlassPanel>
              ) : null}
            </View>
          </View>
        </View>

        {introPlayer && !isDaily && globalLevelId <= 5 ? null : <AdBanner />}
        </SafeAreaView>
      </Animated.View>
      ) : null}

      {levelMenuOpen && !done ? (
        <View accessibilityViewIsModal style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 6, justifyContent: 'center', paddingHorizontal: 24, backgroundColor: 'rgba(27, 12, 30, 0.72)' }}>
          <GlassPanel tone="cream" style={{ paddingHorizontal: 20, paddingVertical: 22, borderRadius: radius.md, gap: 12 }}>
            <AppText preset="title" style={{ color: colors.brown, textAlign: 'center', fontSize: 22 }}>Меню уровня</AppText>
            <AppButton label="Продолжить игру" onPress={() => setLevelMenuOpen(false)} style={{ alignSelf: 'stretch' }} />
            <AppButton label="Настройки" variant="glass" onPress={() => {
              setLevelMenuOpen(false);
              router.push('/settings' as never);
            }} style={{ alignSelf: 'stretch', backgroundColor: colors.plum, borderColor: colors.goldBorder }} />
            <AppButton label="В главное меню" variant="glass" onPress={() => {
              setLevelMenuOpen(false);
              onExit();
            }} style={{ alignSelf: 'stretch', backgroundColor: colors.plum, borderColor: colors.goldBorder }} />
          </GlassPanel>
        </View>
      ) : null}

      {clueOpen && clueText && !done ? (
        <View
          accessibilityViewIsModal
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 5, backgroundColor: 'rgba(27, 12, 30, 0.72)', justifyContent: 'center', paddingHorizontal: 24 }}
        >
          <GlassPanel tone="cream" style={{ paddingHorizontal: 22, paddingVertical: 24, borderRadius: radius.md, alignItems: 'center', gap: 14 }}>
            <Icon name="bulb" size={28} color={colors.brown} />
            <AppText preset="title" style={{ color: colors.brown, textAlign: 'center', fontSize: 21 }}>Смысловая наводка</AppText>
            <AppText preset="body" accessibilityLiveRegion="polite" style={{ textAlign: 'center', color: colors.brown, fontSize: 16 }}>
              {clueText}
            </AppText>
            <AppButton label="Вернуться к слову" variant="accent" onPress={() => setClueOpen(false)} style={{ alignSelf: 'stretch' }} />
          </GlassPanel>
        </View>
      ) : null}

      {saveError && !done ? (
        <View
          accessibilityViewIsModal
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 8, backgroundColor: 'rgba(27, 12, 30, 0.76)', justifyContent: 'center', paddingHorizontal: 24 }}
        >
          <GlassPanel tone="cream" style={{ paddingHorizontal: 20, paddingVertical: 22, borderRadius: radius.md, alignItems: 'center', gap: 14 }}>
            <AppText preset="title" style={{ color: colors.brown, textAlign: 'center', fontSize: 21 }}>Не удалось сохранить</AppText>
            <AppText preset="body" accessibilityLiveRegion="assertive" style={{ textAlign: 'center', color: colors.brown, fontSize: 14 }}>
              {saveError.message}
            </AppText>
            <AppButton label="Повторить" onPress={retrySave} style={{ alignSelf: 'stretch' }} />
            <AppButton label="Вернуться к игре" variant="accent" onPress={() => setSaveError(null)} style={{ alignSelf: 'stretch' }} />
          </GlassPanel>
        </View>
      ) : null}

      {showResult ? (
        <LevelComplete
          coins={awardedCoins}
          rewardPending={completion.status === 'completion_pending'}
          cardProgress={cardProgress}
          giftProgress={nextGiftProgress}
          journeyFinal={!isDaily && globalLevelId === totalLevelCount()}
          onNext={onNext}
          introComplete={introPlayer && !isDaily && globalLevelId === 5}
          onDaily={introPlayer && !isDaily && globalLevelId === 5 ? () => onNext('daily') : undefined}
          onMenu={onMenuFromResult}
          canDouble={false}
          title={completion.status === 'completion_pending'
            ? isDaily ? 'Кроссворд собран' : 'Уровень собран'
            : isDaily
            ? 'Кроссворд дня решён!'
            : introPlayer && globalLevelId === 1
            ? 'Первый кроссворд готов!'
            : undefined}
          subtitle={completion.status === 'completion_pending'
            ? 'Сохраняем прогресс перед продолжением.'
            : isDaily
            ? `День отмечен · ${weeklyDays ?? 1} из 5. Решайте в любые 5 дней из 7 для открытки.`
            : undefined}
          bonusLines={completion.status === 'reward_claimed'
            ? rewardBreakdown(settlement?.effects ?? [], Boolean(earnedCard))
            : []}
          saveError={saveError?.message}
          onRetrySave={saveError?.action === 'completion' ? retrySave : undefined}
          nextLabel={isDaily ? 'К обычным уровням' : introPlayer && globalLevelId === 5 ? 'Продолжить уровни' : undefined}
          heroIcon={giftAwarded ? 'chest' : earnedCard ? 'collection' : undefined}
          heroImage={earnedCard?.image}
          heroCaption={earnedCard?.title}
        />
      ) : null}
      {pendingHint && !done ? (
        <NoCoinsModal
          priceCoins={pendingHint === 'clue' ? SEMANTIC_CLUE_COST : hintCost('bulb')}
          currentCoins={coins}
          hintName={pendingHint === 'clue' ? 'наводку' : 'букву'}
          canWatchAd={!introPlayer || globalLevelId > 5 ? isRewardedReady() && rewardedToday < 3 : false}
          canShop={MONETIZATION.iapEnabled}
          onWatchAd={onWatchAdForCoins}
          onWheel={() => {
            setPendingHint(null);
            router.push('/wheel' as never);
          }}
          onShop={() => {
            setPendingHint(null);
            router.push('/shop' as never);
          }}
          onClose={() => setPendingHint(null)}
        />
      ) : null}
    </View>
  );
}
