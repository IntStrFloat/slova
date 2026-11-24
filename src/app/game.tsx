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
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

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
import { selectHelpContext, type HelpAnalyticsContext } from '@/features/analytics/helpContext';
import { newMonetizationId } from '@/features/monetization/adTelemetry';
import { PostAdSubscriptionOffer } from '@/features/monetization/PostAdSubscriptionOffer';
import { usePostAdSubscriptionOffer, type SubscriptionPromptResult } from '@/features/monetization/usePostAdSubscriptionOffer';
import { puzzleIdentity, trackPuzzleCheckpoint, trackPuzzleEntry, trackPuzzleExited } from '@/features/analytics/puzzleLifecycle';
import { flushSessionSummary, noteSessionAction } from '@/features/analytics/sessionTelemetry';
import { trackObservedRetentionMilestones } from '@/features/analytics/retentionEvents';
import { playSfx } from '@/features/audio';
import { useCollection } from '@/features/collection';
import { routeCardProgress } from '@/features/collection/routeProgress';
import { useCurrency } from '@/features/currency';
import { useSettings } from '@/features/settings';
import { useDailyPuzzle, getDailyPriorCompletion, type DailyPuzzleInstance } from '@/features/dailypuzzle';
import { getCampaignPriorCompletion } from '@/features/levels/store';
import { prepareHelpRequestDecision, resolveHelpUxVariant, useHelpExperimentState } from '@/features/hints/help-experiment';
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
import { CompactBonusObjective } from '@/features/game/CompactBonusObjective';
import { HintNudge } from '@/features/game/HintNudge';
import { LevelStartNote } from '@/features/game/LevelStartNote';
import { applyRewardedHint, getEarnedRewardedHintFlow, hasEarnedRewardedHint, prepareRewardedHint,
  persistRewardedHint, rewardedHintCountForDay, useRewardedHints } from '@/features/hints/rewarded-hint';
import { reconcileAcceptedWords } from '@/features/game/bonusReplay';
import type { FeedbackKind } from '@/features/game/accessibility';
import { clueForUnsolved } from '@/features/game/editorialClues';
import { claimHelpNudge, dismissHelpNudge, isStalled } from '@/features/game/helpNudge';
import { hasClosedCell, replayPendingLetterHint, revealLetter, type AppliedHintPayment } from '@/features/game/hintJournal';
import { hasCurrentMeasurementEpoch, loadGameSnapshot, restoreGame, type GameSnapshot } from '@/features/game/persistence';
import { getSavedPuzzleRewards, settlePuzzleCompletion, type SettlementResult } from '@/features/game/settlement';
import { hintCost, isSemanticClueUnlocked, purchaseSemanticClue, SEMANTIC_CLUE_COST } from '@/features/hints';
import { trackAppliedHelp } from '@/features/hints/help-telemetry';
import { canResumeHelpFlow, closeHelpFlow, createHelpFlow, currentHelpQuote, getHelpFlow, helpFlowProperties,
  latestResumableHelpFlow, markHelpFlowApplied, markHelpFlowReturned, useHelpFlows, type HelpFlow, type RequestedHint } from '@/features/hints/help-flow';
import { useWheel } from '@/features/wheel';
import { recoverRewardedGrants, useRewardRecovery } from '@/features/monetization/rewardRecovery';
import { rewardedStateMessage } from '@/features/monetization/rewardedState';
import { giftProgress } from '@/features/progression/store';
import { ruCount } from '@/features/retention-ui/text';
import { requestCampaignReview } from '@/features/review';
import { UpdateAction, hasUpdateAttemptForResult, isSavedUpdateSafePoint } from '@/features/updates';
import { getFullscreenSnapshot } from '@/core/fullscreen';
import { hasActiveForm } from '../../modules/rustore-review';
import { applyRemoteConfigAtSafePoint, evaluateConfiguredInterstitial, shouldPreloadConfiguredInterstitial, syncRemotePolicyContext } from '@/features/remote-config';
import { useLeaderboard } from '@/features/leaderboard';
import { DEFAULT_WORLD, loadGlobalLevel, useLevels, totalLevelCount } from '@/features/levels';
import {
  AdBanner,
  getAds,
  useRewardedState,
  loadAdsMeta,
  MONETIZATION,
  NoCoinsModal,
  recordInterstitialShown,
  recordInterstitialPolicySkip,
  requestRewarded,
  saveAdsMeta,
  useEntitlements,
} from '@/features/monetization';
import { beginGameplayAdSession } from '@/features/monetization/gameplaySession';
import { useAdGameplayClock } from '@/features/monetization/useAdGameplayClock';
import { AppButton, AppText, CoinBadge, colors, GlassPanel, Icon, radius, shadowCard, WorldBackground, type IconName } from '@/ui';

const HINT_BUTTON_SIZE = 56;
const RADIAL_HINT_EXTRA = 0;
const MIN_BOARD_VIEWPORT = 96;

type SaveFailure = { message: string; action: 'word' | 'hint' | 'clue' | 'shuffle' | 'start' | 'replay' | 'completion' | 'finish'; word?: string; helpFlowId?: string };

function matchingHelpSnapshot(flow: HelpFlow): GameSnapshot | null {
  const mode = flow.mode === 'daily' ? 'daily' : 'normal';
  const saved = loadGameSnapshot(mode, undefined, flow.dateKey);
  if (!saved || saved.attemptId !== flow.attemptId || saved.globalLevel !== flow.levelId
    || saved.contentVersion !== flow.contentVersion) return null;
  const level = flow.mode === 'daily' ? useDailyPuzzle.getState().instances[flow.dateKey!]?.level
    : loadGlobalLevel(flow.levelId);
  return level && restoreGame(level, mode, saved, flow.dateKey) ? saved : null;
}

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
  useHelpExperimentState((state) => state.revision);
  const router = useRouter();
  const subscriptionOffer = usePostAdSubscriptionOffer();
  const goBack = useGoBack();
  const reducedMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const { mode, date, previewLevel, source, helpFlowId } = useLocalSearchParams<{
    mode?: string; date?: string; previewLevel?: string; source?: string; helpFlowId?: string;
  }>();
  const incomingHelpFlowId = typeof helpFlowId === 'string' ? helpFlowId : undefined;
  const incomingHelpFlow = useHelpFlows((state) => incomingHelpFlowId && Object.hasOwn(state.flows, incomingHelpFlowId)
    ? state.flows[incomingHelpFlowId] : null);
  const [acceptedHelpOrigin, setAcceptedHelpOrigin] = useState<string | null>(null);
  const [pinnedDailyHelpDate, setPinnedDailyHelpDate] = useState<string | null>(() =>
    incomingHelpFlow?.mode === 'daily' ? incomingHelpFlow.dateKey ?? null : null);
  const requestIsActive = incomingHelpFlow?.status === 'requested' || incomingHelpFlow?.status === 'returned';
  const originalHelpSnapshot = incomingHelpFlow && requestIsActive ? matchingHelpSnapshot(incomingHelpFlow) : null;
  const isDaily = mode === 'daily';
  const helpReturnBlocked = Boolean(incomingHelpFlow && requestIsActive
    && acceptedHelpOrigin !== incomingHelpFlow.id
    && (!originalHelpSnapshot || (incomingHelpFlow.mode === 'daily') !== isDaily));
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
  const rewardedState = useRewardedState();
  const rewardedReady = rewardedState === 'ready';
  const recoveryBusy = useRewardRecovery((state) => state.checking || state.readFailed || state.pendingIds.length > 0);
  const canFreeWheel = useWheel((state) => state.canFree());
  const wheelRewardedRemaining = useWheel((state) => state.rewardedLeft());
  const wheelPending = useWheel((state) => Boolean(state.pendingSpin));
  const haptics = useSettings((s) => s.haptics);
  const [pendingHint, setPendingHint] = useState<'bulb' | 'clue' | null>(null);
  const [pendingHelpFlowId, setPendingHelpFlowId] = useState<string | null>(null);
  const [helpPathError, setHelpPathError] = useState<string | null>(null);
  const pendingHelpFlow = useHelpFlows((state) => pendingHelpFlowId && Object.hasOwn(state.flows, pendingHelpFlowId)
    ? state.flows[pendingHelpFlowId] : null);
  const [rewardedWatching, setRewardedWatching] = useState(false);
  const [bonusExpanded, setBonusExpanded] = useState(false);
  const [tapSelecting, setTapSelecting] = useState(false);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  const [idleSec, setIdleSec] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [clueOpen, setClueOpen] = useState(false);
  const [clueUsed, setClueUsed] = useState(false);
  const [helpAccent, setHelpAccent] = useState(false);
  const [hintNudgeVisible, setHintNudgeVisible] = useState(false);
  const [startNoteAttempt, setStartNoteAttempt] = useState<string | null>(null);
  const [shuffleQuietUntil, setShuffleQuietUntil] = useState(0);
  const [saveError, setSaveError] = useState<SaveFailure | null>(null);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [routeFocused, setRouteFocused] = useState(true);
  const [resultReadyFor, setResultReadyFor] = useState<string | null>(null);
  // Гарды от двойного начисления награды при быстром повторном тапе.
  const claiming = useRef(false);
  const settling = useRef(false);
  const hintBusy = useRef(false);
  const rewardedBusy = useRef(false);
  const appliedHelpFlows = useRef(new Set<string>());
  const closedHelpFlows = useRef(new Set<string>());
  const helpFlowRef = useRef(incomingHelpFlowId);
  const focused = useRef(true);
  const appActive = useRef(AppState.currentState === 'active');
  const enteredAttempt = useRef<string | null>(null);
  const interactionSequence = useRef(0);
  const nextInteractionId = () => newMonetizationId('game');
  const rewardedHintRevision = useRewardedHints((state) => state.revision);
  const recoveryRevision = useRewardRecovery((state) => state.revision);
  useEffect(() => { helpFlowRef.current = incomingHelpFlowId; }, [incomingHelpFlowId]);
  const resumeSelectedHelp = useCallback(() => {
    const snapshot = useGame.getState().snapshot;
    if (!focused.current || !snapshot) return;
    let flow = getHelpFlow(helpFlowRef.current);
    if (!flow || flow.attemptId !== snapshot.attemptId) {
      flow = latestResumableHelpFlow(snapshot.attemptId);
    }
    if (!flow || (resolveHelpUxVariant(flow) !== 'clarity' && !hasEarnedRewardedHint(flow.id)) || flow.status === 'closed' || flow.status === 'applied'
      || closedHelpFlows.current.has(flow.id) || appliedHelpFlows.current.has(flow.id) || snapshot.attemptId !== flow.attemptId
      || !currentHelpQuote(flow).helpAvailable) return;
    helpFlowRef.current = flow.id;
    setAcceptedHelpOrigin(flow.id);
    setPendingHelpFlowId(flow.id);
    setPendingHint(flow.requestedHint === 'semantic' ? 'clue' : 'bulb');
  }, []);

  // Keep the result on its solved puzzle while durable progress advances.
  const [campaignLevelId, setCampaignLevelId] = useState(() => {
    if (previewLevelId !== null) return previewLevelId;
    if (incomingHelpFlow?.mode === 'campaign' && requestIsActive && originalHelpSnapshot) return incomingHelpFlow.levelId;
    const saved = loadGameSnapshot('normal');
    if (saved && (saved.completion.status === 'completion_pending' || saved.completion.status === 'reward_claimed')) {
      const solvedLevel = loadGlobalLevel(saved.globalLevel);
      const restored = solvedLevel && restoreGame(solvedLevel, 'normal', saved);
      if (restored && isLevelComplete(restored.play)) return saved.globalLevel;
    }
    return currentLevel;
  });
  const requestedDailyDate = isDaily ? incomingHelpFlow?.mode === 'daily' && requestIsActive
    ? incomingHelpFlow.dateKey! : date ?? pinnedDailyHelpDate ?? useDailyPuzzle.getState().effectiveDay() : null;
  const pinnedBeforeUnlock = Boolean(requestedDailyDate && useDailyPuzzle.getState().instances[requestedDailyDate]);
  const dailyEntryAllowed = !isDaily || RETENTION.featureFlags.daily
    && (getFeatureGates(useRetention.getState()).daily || pinnedBeforeUnlock);
  const [dailyInstance, setDailyInstance] = useState<DailyPuzzleInstance | null>(() =>
    isDaily && dailyEntryAllowed && !helpReturnBlocked ? useDailyPuzzle.getState().getOrStartDaily(requestedDailyDate ?? undefined) : null,
  );
  useEffect(() => {
    if (!isDaily || helpReturnBlocked) return;
    if (!dailyEntryAllowed) {
      if (dailyInstance) queueMicrotask(() => setDailyInstance(null));
      return;
    }
    if (dailyInstance?.dateKey === requestedDailyDate) return;
    const next = useDailyPuzzle.getState().getOrStartDaily(requestedDailyDate ?? undefined);
    queueMicrotask(() => setDailyInstance(next));
  }, [dailyEntryAllowed, dailyInstance, helpReturnBlocked, isDaily, requestedDailyDate]);
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
  const semanticWord = level && play ? level.answers.find((answer) => !play.solvedWords.includes(answer.word))?.word : undefined;
  const semanticOwned = Boolean(level && semanticWord && isSemanticClueUnlocked(
    isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`,
    level.fingerprint ?? level.contentVersion ?? '', semanticWord));
  const semanticDisplayedPrice = freeIntroHelp || semanticOwned ? 0 : SEMANTIC_CLUE_COST;
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
  const minimumPlayAreaHeight = gameLayout.diskSize + RADIAL_HINT_EXTRA
    + gameLayout.paddingTop + gameLayout.paddingBottom + gameLayout.contentGap + MIN_BOARD_VIEWPORT;
  const scrollPlayArea = playAreaHeight < minimumPlayAreaHeight;
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
    if (helpReturnBlocked) return;
    if (level) {
      const existing = loadGameSnapshot(isDaily ? 'daily' : 'normal', level, dailyInstance?.dateKey);
      let started = false;
      try {
        if (!existing) applyRemoteConfigAtSafePoint();
        start(level, isDaily ? 'daily' : 'normal', dailyInstance?.dateKey);
        syncRemotePolicyContext();
        started = true;
        replayPendingLetterHint(isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`, (payment) => {
          const applied = useGame.getState().snapshot;
          if (applied) trackAppliedHelp(level, applied, payment, { kind: 'letter', recovery: true });
        });
        const saved = useGame.getState().snapshot;
        if (saved) reconcileAcceptedWords(level, isDaily ? 'daily' : 'normal', saved);
      } catch (error) {
        console.warn('[game] start deferred', error);
        track('puzzle_blocked', {
          operation_id: nextInteractionId(), mode: isDaily ? 'daily' : 'campaign',
          levelKey: isDaily ? `daily:${dailyInstance?.dateKey ?? 'unknown'}` : `campaign:${globalLevelId}`,
          reason: started ? 'restore_replay_failed' : 'save_open_failed', retryable: true,
          restore_state: existing ? 'restored' : 'fresh',
        });
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
        const origin = getHelpFlow(helpFlowRef.current);
        if (origin && readySnapshot?.attemptId === origin.attemptId) setAcceptedHelpOrigin(origin.id);
        setPendingHint(null);
        setPendingHelpFlowId(null);
        setHelpPathError(null);
        setSettlement(null);
        setIdleSec(0);
        setAttempts(0);
        setClueOpen(false);
        setClueUsed(false);
        setHelpAccent(false);
        setStartNoteAttempt(!existing && !isDaily && globalLevelId > 5 ? readySnapshot?.attemptId ?? null : null);
        setShuffleQuietUntil(0);
        setLevelMenuOpen(false);
        setSaveError(null);
        resumeSelectedHelp();
      });
      claiming.current = false;
      settling.current = false;
    }
  }, [level, start, isDaily, globalLevelId, dailyInstance, helpReturnBlocked, introPlayer, resumeSelectedHelp, source]);

  const done = completion.status === 'completion_pending' || completion.status === 'reward_claimed';
  const transitionKey = isDaily ? `daily:${dailyInstance?.dateKey ?? selectedDailyDate}` : `campaign:${levelId}`;
  const showResult = done && resultReadyFor === transitionKey;
  const boardReady = !helpReturnBlocked && !done && liveLevelId === globalLevelId;
  const gameplayVisible = Boolean(boardReady && level && play && routeFocused
    && !levelMenuOpen && !clueOpen && !saveError && !pendingHint && !rewardedWatching);
  useEffect(() => {
    if (!startNoteAttempt) return;
    const timer = setTimeout(() => setStartNoteAttempt(null), 3_200);
    return () => clearTimeout(timer);
  }, [startNoteAttempt]);
  useEffect(() => {
    if (pendingHint || clueOpen || levelMenuOpen || rewardedWatching || (play?.solvedWords.length ?? 0) > 0) queueMicrotask(() => setStartNoteAttempt(null));
  }, [pendingHint, clueOpen, levelMenuOpen, rewardedWatching, play?.solvedWords.length]);
  useEffect(() => {
    if (boardReady && level && play) beginGameplayAdSession();
  }, [boardReady, level, play]);
  const pauseReason = rewardedWatching ? 'ad' : pendingHint ? 'no_coins' : clueOpen ? 'clue'
    : levelMenuOpen ? 'menu' : saveError ? 'save_error' : !routeFocused ? 'route_hidden' : 'not_visible';
  const prepareInterstitial = useCallback(() => {
    const ads = getAds();
    if (!ads.setInterstitialPreloadAllowed) return;
    let allowed = false;
    try {
      const gameplaySession = beginGameplayAdSession();
      allowed = routeFocused && (gameplayVisible || showResult) && shouldPreloadConfiguredInterstitial(loadAdsMeta(), {
        enabled: MONETIZATION.adsEnabled, removeAds, loaded: true, nowMs: Date.now(),
        isFirstGameplaySession: gameplaySession.isFirstGameplaySession,
        campaignLevelId: isDaily ? null : globalLevelId,
        userContinued: false, rewardsCommitted: false,
        protectedTransition: globalLevelId === 5 && introPlayer || globalLevelId >= totalLevelCount()
          || Boolean(settlement?.collectibleIds.length),
      });
    } catch { /* Missing optional counters cannot create speculative requests. */ }
    ads.setInterstitialPreloadAllowed(allowed);
  }, [routeFocused, gameplayVisible, showResult, removeAds, isDaily, globalLevelId, introPlayer, settlement]);
  useEffect(() => {
    prepareInterstitial();
    return () => getAds().setInterstitialPreloadAllowed?.(false);
  }, [prepareInterstitial]);
  const flushPuzzleGameplayTime = useGameplayClock(gameplayVisible, activeAttemptId, pauseReason);
  const flushAdGameplayTime = useAdGameplayClock(gameplayVisible, activeAttemptId, prepareInterstitial);
  const flushGameplayTime = useCallback(() => {
    flushPuzzleGameplayTime();
    flushAdGameplayTime();
  }, [flushPuzzleGameplayTime, flushAdGameplayTime]);
  const recordPuzzleExit = useCallback((reason: string) => {
    flushGameplayTime();
    const game = useGame.getState();
    if (!game.level || !game.snapshot || game.snapshot.completion.status !== 'playing') return;
    trackPuzzleCheckpoint(game.level, game.snapshot, reason);
    trackPuzzleExited(game.level, game.snapshot,
      `exit_${Date.now().toString(36)}_${interactionSequence.current++}`, reason, game.lastResult?.kind);
    flushSessionSummary(reason);
  }, [flushGameplayTime]);
  useEffect(() => {
    if (level || saveError) return;
    const reason = dailyUnavailable ? 'daily_disabled' : dailyLocked ? 'daily_locked'
      : dailyAlreadyDone ? 'already_completed' : 'content_unavailable';
    trackOnce('puzzle_blocked', `blocked:${isDaily ? selectedDailyDate : globalLevelId}:${reason}`, {
      operation_id: `blocked_${isDaily ? selectedDailyDate : globalLevelId}_${reason}`,
      mode: isDaily ? 'daily' : 'campaign', reason, retryable: reason === 'content_unavailable',
      levelKey: isDaily ? `daily:${selectedDailyDate}` : `campaign:${globalLevelId}`, restore_state: 'unavailable',
    });
  }, [dailyAlreadyDone, dailyLocked, dailyUnavailable, globalLevelId, isDaily, level, saveError, selectedDailyDate]);
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
  const yandexGameplayActive = Boolean(level && play && !done && !helpReturnBlocked);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    queueMicrotask(() => setRouteFocused(true));
    refreshGuidance();
    queueMicrotask(resumeSelectedHelp);
    return () => {
      focused.current = false;
      queueMicrotask(() => setRouteFocused(false));
    };
  }, [refreshGuidance, resumeSelectedHelp]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appActive.current = state === 'active';
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!routeFocused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (rewardedBusy.current) return true;
      if (levelMenuOpen) {
        setLevelMenuOpen(false);
        return true;
      }
      if (!pendingHint && !clueOpen && !saveError) recordPuzzleExit('hardware_back');
      return false;
    });
    return () => subscription.remove();
  }, [clueOpen, levelMenuOpen, pendingHint, recordPuzzleExit, routeFocused, saveError]);

  useEffect(() => {
    if (!level || !play || done || pendingHint || clueOpen || saveError || levelMenuOpen || rewardedWatching) return;
    const timer = setInterval(() => {
      if (!focused.current || !appActive.current || getFullscreenSnapshot().owner !== null || hasActiveForm()) return;
      setIdleSec((seconds) => seconds + 5);
    }, 5_000);
    return () => clearInterval(timer);
  }, [clueOpen, done, level, levelMenuOpen, pendingHint, play, saveError, rewardedWatching]);

  useEffect(() => {
    if (!level || !play || done || pendingHint || levelMenuOpen || tapSelecting || !hasClosedCell()
      || clueUsed || helpAccent || idleSec < shuffleQuietUntil
      || !focused.current || !appActive.current
      || !isStalled(idleSec, attempts, introPlayer && !isDaily && globalLevelId <= 5 ? 'intro' : 'standard')) return;
    const puzzleKey = isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`;
    if (!claimHelpNudge(getAnalyticsSession().sessionId, puzzleKey)) return;
    queueMicrotask(() => {
      setHelpAccent(true);
      if (!(introPlayer && !isDaily && globalLevelId <= 5)) setHintNudgeVisible(true);
    });
    const snapshot = useGame.getState().snapshot;
    track('help_offer_shown', {
      ...(snapshot ? puzzleIdentity(level, snapshot) : { levelId: globalLevelId }),
      trigger: attempts === 0 ? 'idle' : 'errors',
      ...(snapshot && hasCurrentMeasurementEpoch(snapshot) ? { activeTimeMs: snapshot.activeTimeMs ?? 0 } : {}),
    });
  }, [attempts, clueUsed, dailyInstance?.dateKey, done, globalLevelId, helpAccent,
    idleSec, introGuide.demoActive, introPlayer, isDaily, level, levelMenuOpen, pendingHint, play, semanticClue,
    shuffleQuietUntil, tapSelecting]);

  useEffect(() => {
    if (!hintNudgeVisible) return;
    const timer = setTimeout(() => setHintNudgeVisible(false), 7_000);
    return () => clearTimeout(timer);
  }, [hintNudgeVisible]);

  useEffect(() => { queueMicrotask(() => setHintNudgeVisible(false)); }, [activeAttemptId, play?.solvedWords.length, pendingHint, clueOpen]);

  useEffect(() => {
    if (!routeFocused || rewardedWatching || recoveryBusy || !level || !play || done) return;
    const earnedFlow = getEarnedRewardedHintFlow(activeAttemptId);
    if (earnedFlow) queueMicrotask(() => applyEarnedSelectedHint(earnedFlow));
    // The persisted revision/active attempt trigger recovery, not callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAttemptId, done, level, play, recoveryBusy, recoveryRevision, rewardedHintRevision, rewardedWatching, routeFocused]);

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

  if (helpReturnBlocked) {
    return <View style={{ flex: 1 }}><WorldBackground world={DEFAULT_WORLD} dim />
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <AppText preset="title" style={{ textAlign: 'center' }}>Исходная попытка недоступна</AppText>
        <AppText preset="body" style={{ textAlign: 'center' }}>Слово уже изменено или начато заново. Полученная награда сохранена для исходной головоломки.</AppText>
        <AppButton label="Карта" onPress={() => router.replace('/')} />
      </SafeAreaView></View>;
  }

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
    if (rewardedBusy.current) return 'blocked';
    const submissionId = nextInteractionId();
    let r: SubmitResult;
    try {
      flushGameplayTime();
      noteSessionAction('word_submitted');
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
      reason: r.kind === 'invalid' || r.kind === 'blocked' || r.kind === 'constraint' ? r.reason : undefined,
      len: w.length,
      levelId: globalLevelId,
      mode: isDaily ? 'daily' : 'campaign',
      contentVersion: level.contentVersion ?? 'legacy',
      ...(level.policyRevision != null ? { policyRevision: level.policyRevision } : {}),
      submission_id: submissionId,
      manual: true,
      bonus_reward_eligible: r.kind === 'bonus' ? r.rewarded : false,
    });
    if (r.kind === 'grid') {
      const answerIndex = level.answers.findIndex((answer) => answer.word === r.word);
      if (snapshot && answerIndex >= 0) track('target_word_accepted', {
        ...puzzleIdentity(level, snapshot), answerIndex,
        ...(hasCurrentMeasurementEpoch(snapshot) ? { activeTimeMs: snapshot.activeTimeMs ?? 0 } : {}),
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
          ...(snapshot && hasCurrentMeasurementEpoch(snapshot) ? { activeTimeMs: snapshot.activeTimeMs ?? 0 } : {}),
          occurredAtMs: Date.now(),
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
            occurredAtMs: Date.now(),
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
  ]).size + rewardedHintCountForDay();

  const prepareHelpRequest = (requestedHint: RequestedHint, cost: number, interactionId: string, existingId?: string, requestedAtMs = Date.now()): HelpFlow | null => {
    const game = useGame.getState();
    if (!level || !game.snapshot || game.snapshot.completion.status !== 'playing' || game.snapshot.globalLevel !== globalLevelId
      || game.snapshot.mode !== (isDaily ? 'daily' : 'normal')) return null;
    const continuationId = existingId ?? helpFlowRef.current;
    if (continuationId) {
      const existing = getHelpFlow(continuationId);
      if (existing && existing.attemptId === game.snapshot.attemptId && existing.requestedHint === requestedHint
        && existing.status !== 'closed' && existing.status !== 'applied' && !appliedHelpFlows.current.has(continuationId)
        && !closedHelpFlows.current.has(continuationId) && currentHelpQuote(existing).helpAvailable) return existing;
      if (existingId) return null;
    }
    if (cost === 0) return null;
    const identity = puzzleIdentity(level, game.snapshot);
    try {
      const flow = createHelpFlow({ id: interactionId, attemptId: game.snapshot.attemptId,
        levelKey: identity.levelKey, levelId: globalLevelId, mode: isDaily ? 'daily' : 'campaign',
        ...(isDaily ? { dateKey: dailyInstance?.dateKey ?? selectedDailyDate } : {}),
        contentVersion: game.snapshot.contentVersion, contentFingerprint: identity.content_fingerprint,
        requestedHint, displayedCost: cost, balance: useCurrency.getState().coins, entrySource: 'game_help',
        createdAtMs: requestedAtMs,
        initialLetterHintCount: game.snapshot.hintsUsed.length,
        previouslyCompleted: isDaily ? getDailyPriorCompletion(dailyInstance?.dateKey ?? selectedDailyDate)
          : getCampaignPriorCompletion(globalLevelId) });
      if (flow.mode === 'daily') setPinnedDailyHelpDate(flow.dateKey!);
      return flow;
    } catch {
      setHelpPathError('Не удалось сохранить выбранную помощь. Попробуйте ещё раз.');
      return null;
    }
  };

  const pinHelpRequest = (flow: HelpFlow) => {
    helpFlowRef.current = flow.id;
    setAcceptedHelpOrigin(flow.id);
    if (flow.mode === 'daily') setPinnedDailyHelpDate(flow.dateKey!);
    try { router.setParams({ helpFlowId: flow.id, ...(flow.mode === 'daily' ? { date: flow.dateKey } : {}) }); } catch { /* The durable flow and mounted date remain canonical. */ }
  };

  const detachHelpRoute = (flowId?: string) => {
    const id = flowId ?? helpFlowRef.current ?? incomingHelpFlowId;
    if (!id) return;
    setAcceptedHelpOrigin(id);
    helpFlowRef.current = undefined;
    try { router.setParams({ helpFlowId: undefined }); } catch { /* A completed/closed request cannot lock this mounted game. */ }
  };

  const finishHelpRequest = (flow: HelpFlow | null) => {
    if (!flow) return;
    // The game snapshot/payment are canonical even if optional UI metadata fails.
    appliedHelpFlows.current.add(flow.id);
    try { markHelpFlowApplied(flow.id); } catch { /* Counter/owned-clue quote prevents a second purchase. */ }
    detachHelpRoute(flow.id);
    setPendingHint(null);
    setPendingHelpFlowId(null);
    setHelpPathError(null);
  };

  const helpActionContext = (flow: HelpFlow | null, kind: RequestedHint, cost: number,
    interactionId: string, modalId?: string): HelpAnalyticsContext => selectHelpContext({
    ...puzzleIdentity(level, useGame.getState().snapshot!), ...(flow ? helpFlowProperties(flow) : {}),
    interaction_id: interactionId, modal_id: modalId, requested_hint: kind,
    displayed_cost: cost, balance: useCurrency.getState().coins, entry_source: modalId ? 'no_coins' : 'game_help',
  });

  const tryHint = (type: HintType, requestedFlowId?: string, actionInteractionId?: string, modalId?: string) => {
    if (type !== 'bulb' || hintBusy.current || rewardedBusy.current) return;
    const current = useGame.getState().snapshot;
    if (!current || current.globalLevel !== globalLevelId || current.mode !== (isDaily ? 'daily' : 'normal')
      || current.completion.status !== 'playing' || helpReturnBlocked) return;
    const interactionId = actionInteractionId ?? nextInteractionId();
    const displayedCost = freeIntroHelp ? 0 : hintCost('bulb');
    const requestedAtMs = Date.now();
    const available = hasClosedCell();
    const flow = available ? prepareHelpRequest('letter', displayedCost, interactionId, requestedFlowId, requestedAtMs) : null;
    if (requestedFlowId && !flow) return;
    const context = helpActionContext(flow, 'letter', displayedCost, interactionId, modalId);
    const hintRequest = { ...context, occurredAtMs: requestedAtMs, hint_type: 'letter', already_owned: false, is_available: available,
      rewarded_state: rewardedState, rewarded_eligible: (!introPlayer || globalLevelId > 5) && rewardedToday < 3 };
    noteSessionAction('hint_requested');
    let requestRecorded = false;
    const recordRequest = () => { if (!requestRecorded) { track('hint_requested', hintRequest); requestRecorded = true; } };
    if (!available) {
      recordRequest();
      track('hint_rejected', { ...hintRequest, reason: 'unavailable' });
      return;
    }
    hintBusy.current = true;
    try {
      flushGameplayTime();
      const puzzleKey = isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`;
      let payment: AppliedHintPayment | undefined;
      const outcome = revealLetter(puzzleKey, context, (applied) => { payment = applied; });
      if (outcome === 'insufficient') {
        const decision = flow ? prepareHelpRequestDecision({ flow, requestedAtMs, interactionId, isAvailable: available,
          alreadyOwned: false, free: freeIntroHelp, previouslyCompleted: flow.previouslyCompleted }) : null;
        if (!decision?.captured) {
          track('hint_requested', { ...hintRequest, ...decision?.firstRequestProperties });
          track('hint_rejected', { ...hintRequest, ...decision?.firstRequestProperties, reason: 'insufficient_coins' });
        }
        requestRecorded = true;
        setPendingHelpFlowId(flow?.id ?? null);
        setPendingHint(type);
        return;
      }
      recordRequest();
      if (outcome !== 'applied') {
        track('hint_rejected', { ...hintRequest, reason: 'unavailable' });
        return;
      }
      setIdleSec(0);
      setAttempts(0);
      setHelpAccent(false);
      finishHelpRequest(flow);
      const snapshot = useGame.getState().snapshot;
      if (snapshot && payment) trackAppliedHelp(level, snapshot, payment, { kind: 'letter', displayedCost });
      trackReminderGameplay('hint_used');
      trackGameplayAction('hint_used', { levelId: globalLevelId, mode: isDaily ? 'daily' : 'campaign' });
      if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (useGame.getState().completion.status === 'completion_pending') settleCurrent();
    } catch (error) {
      recordRequest();
      console.warn('[game] hint deferred', error);
      setSaveError({ message: 'Подсказку не удалось завершить. Проверьте поле и попробуйте ещё раз.', action: 'hint', helpFlowId: flow?.id });
      track('save_failed', { mode: isDaily ? 'daily' : 'campaign', reason: 'hint' });
      track('hint_rejected', { ...hintRequest, reason: 'save_failed' });
    } finally {
      hintBusy.current = false;
    }
  };

  const showClue = (requestedFlowId?: string, actionInteractionId?: string, modalId?: string) => {
    if (rewardedBusy.current) return;
    if (!semanticClue || !level || !play) return;
    const current = useGame.getState().snapshot;
    if (!current || current.globalLevel !== globalLevelId || current.mode !== (isDaily ? 'daily' : 'normal')
      || current.completion.status !== 'playing' || helpReturnBlocked) return;
    if (clueOpen) {
      setClueOpen(false);
      return;
    }
    const word = level.answers.find((answer) => !play.solvedWords.includes(answer.word))?.word;
    if (!word) return;
    const puzzleKey = isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`;
    const revision = level.fingerprint ?? level.contentVersion ?? '';
    const alreadyOwned = isSemanticClueUnlocked(puzzleKey, revision, word);
    const chargedAmount = freeIntroHelp || alreadyOwned ? 0 : SEMANTIC_CLUE_COST;
    const interactionId = actionInteractionId ?? nextInteractionId();
    const requestedAtMs = Date.now();
    const flow = prepareHelpRequest('semantic', chargedAmount, interactionId, requestedFlowId, requestedAtMs);
    if (requestedFlowId && !flow) return;
    const context = helpActionContext(flow, 'semantic', chargedAmount, interactionId, modalId);
    const hintRequest = { ...context, occurredAtMs: requestedAtMs, hint_type: 'semantic', already_owned: alreadyOwned, is_available: true,
      rewarded_state: rewardedState, rewarded_eligible: (!introPlayer || globalLevelId > 5) && rewardedToday < 3 };
    noteSessionAction('hint_requested');
    let requestRecorded = false;
    const recordRequest = () => { if (!requestRecorded) { track('hint_requested', hintRequest); requestRecorded = true; } };
    try {
      flushGameplayTime();
      let payment: AppliedHintPayment | undefined;
      if (purchaseSemanticClue(puzzleKey, revision, word, context, (applied) => { payment = applied; }) === 'insufficient') {
        const decision = flow ? prepareHelpRequestDecision({ flow, requestedAtMs, interactionId, isAvailable: true,
          alreadyOwned, free: freeIntroHelp, previouslyCompleted: flow.previouslyCompleted }) : null;
        if (!decision?.captured) {
          track('hint_requested', { ...hintRequest, ...decision?.firstRequestProperties });
          track('hint_rejected', { ...hintRequest, ...decision?.firstRequestProperties, reason: 'insufficient_coins' });
        }
        requestRecorded = true;
        setPendingHelpFlowId(flow?.id ?? null);
        setPendingHint('clue');
        return;
      }
      recordRequest();
      setClueOpen(true);
      setClueUsed(true);
      setHelpAccent(false);
      finishHelpRequest(flow);
      dismissHelpNudge(puzzleKey);
      const snapshot = useGame.getState().snapshot;
      if (snapshot && payment) trackAppliedHelp(level, snapshot, payment, {
        kind: 'semantic', displayedCost: chargedAmount, alreadyOwned,
      });
      trackReminderGameplay('hint_used');
      introGuide.refreshGuidance();
      trackGameplayAction('hint_used', { levelId: globalLevelId, mode: isDaily ? 'daily' : 'campaign' });
    } catch (error) {
      recordRequest();
      console.warn('[game] clue save deferred', error);
      track('hint_rejected', { ...hintRequest, reason: 'save_failed' });
      setSaveError({ message: 'Не удалось сохранить оплату наводки. Повторите.', action: 'clue', helpFlowId: flow?.id });
    }
  };

  const tryShuffle = () => {
    if (rewardedBusy.current) return;
    if (new Set(disk).size < 2) return;
    try {
      noteSessionAction('shuffle_used');
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

  function applyEarnedSelectedHint(flow: HelpFlow) {
    if (!level || useGame.getState().snapshot?.attemptId !== flow.attemptId) return;
    try {
      let payment: AppliedHintPayment | undefined;
      const outcome = applyRewardedHint(flow.id, (value) => { payment = value; });
      if (outcome !== 'applied') {
        setPendingHelpFlowId(flow.id);
        setPendingHint(flow.requestedHint === 'semantic' ? 'clue' : 'bulb');
        setHelpPathError('Подсказка заработана. Повторите её открытие — реклама больше не нужна.');
        return;
      }
      if (flow.requestedHint === 'semantic') { setClueOpen(true); setClueUsed(true); }
      setIdleSec(0); setAttempts(0); setHelpAccent(false); setHintNudgeVisible(false);
      finishHelpRequest(flow);
      const snapshot = useGame.getState().snapshot;
      if (snapshot && payment) trackAppliedHelp(level, snapshot, payment, {
        kind: flow.requestedHint, displayedCost: 0,
      });
      trackReminderGameplay('hint_used');
      if (haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (useGame.getState().completion.status === 'completion_pending') settleCurrent();
    } catch {
      setPendingHelpFlowId(flow.id);
      setPendingHint(flow.requestedHint === 'semantic' ? 'clue' : 'bulb');
      setHelpPathError('Подсказка заработана и ожидает сохранения. Повторный просмотр не нужен.');
    }
  }

  const onWatchAdForHint = async (actionInteractionId?: string, modalId?: string) => {
    if (rewardedToday >= 3 || rewardedBusy.current || !rewardedReady || recoveryBusy) return;
    const flow = getHelpFlow(pendingHelpFlowId ?? undefined);
    if (!flow || !canResumeHelpFlow(flow) || useGame.getState().snapshot?.attemptId !== flow.attemptId) {
      setHelpPathError('Не удалось подтвердить выбранную помощь. Вернитесь к слову и выберите её заново.');
      return;
    }
    if (hasEarnedRewardedHint(flow.id)) { applyEarnedSelectedHint(flow); return; }
    pinHelpRequest(flow);
    const quote = currentHelpQuote(flow);
    if (quote.deficit <= 0) {
      if (flow.requestedHint === 'semantic') showClue(flow.id, actionInteractionId, modalId);
      else tryHint('bulb', flow.id, actionInteractionId, modalId);
      return;
    }
    const context = helpActionContext(flow, flow.requestedHint, quote.price,
      actionInteractionId ?? nextInteractionId(), modalId);
    flushGameplayTime();
    rewardedBusy.current = true;
    setRewardedWatching(true);
    setPendingHint(null);
    const instanceId = `rewarded-hint:${dayKey()}:${Date.now().toString(36)}`;
    let res;
    try {
      const receipt = prepareRewardedHint(flow, instanceId, context);
      if (!receipt) throw new Error('Selected hint could not be prepared');
      res = await requestRewarded('hint', {
        rewardId: receipt.rewardId,
        receipt,
        persistGrant: (id) => id === receipt.rewardId && persistRewardedHint(receipt),
      });
    } catch {
      setPendingHelpFlowId(flow.id);
      setPendingHint(flow.requestedHint === 'semantic' ? 'clue' : 'bulb');
      setHelpPathError('Не удалось подготовить подсказку. Попробуйте ещё раз.');
      return;
    } finally {
      rewardedBusy.current = false;
      setRewardedWatching(false);
    }
    if (res !== 'rewarded') {
      if (flow && useGame.getState().snapshot?.attemptId === flow.attemptId) {
        setPendingHelpFlowId(flow.id);
        setPendingHint(flow.requestedHint === 'semantic' ? 'clue' : 'bulb');
        setHelpPathError(res === 'dismissed' ? 'Просмотр закрыт без награды.' : rewardedStateMessage(getAds().getRewardedFailure?.() ?? 'not_ready'));
      }
      return;
    }
    void recoverRewardedGrants().catch(() => {});
    applyEarnedSelectedHint(flow);
  };

  const openHelpWheel = (free: boolean, actionInteractionId?: string, modalId?: string) => {
    const flow = getHelpFlow(pendingHelpFlowId ?? undefined);
    if (!flow || !canResumeHelpFlow(flow) || useGame.getState().snapshot?.attemptId !== flow.attemptId) {
      setHelpPathError('Исходная попытка недоступна. Выберите помощь заново.');
      return;
    }
    try {
      flushGameplayTime();
      pinHelpRequest(flow);
      const interactionId = actionInteractionId ?? nextInteractionId();
      const context = helpActionContext(flow, flow.requestedHint, currentHelpQuote(flow).price, interactionId, modalId);
      if (free && !useWheel.getState().spin(false, undefined, context)) {
        setHelpPathError('Бесплатное вращение сейчас недоступно. Можно открыть колесо или вернуться к слову.');
        return;
      }
      setPendingHint(null);
      router.push({ pathname: '/wheel', params: { helpFlowId: flow.id, source: 'no_coins',
        entryInteractionId: interactionId, ...(modalId ? { modalId } : {}) } });
    } catch {
      setHelpPathError('Не удалось открыть колесо. Выбранная помощь сохранена. Попробуйте ещё раз.');
      setPendingHint(flow.requestedHint === 'semantic' ? 'clue' : 'bulb');
    }
  };

  const applyPendingHelp = (interactionId?: string, modalId?: string) => {
    const flow = getHelpFlow(pendingHelpFlowId ?? undefined);
    if (flow && hasEarnedRewardedHint(flow.id)) { applyEarnedSelectedHint(flow); return; }
    if (!flow || appliedHelpFlows.current.has(flow.id) || closedHelpFlows.current.has(flow.id)
      || useGame.getState().snapshot?.attemptId !== flow.attemptId
      || !currentHelpQuote(flow).helpAvailable) {
      setHelpPathError('Выбранная помощь уже применена или попытка изменилась. Продолжите игру.');
      return;
    }
    const quote = currentHelpQuote(flow);
    if (quote.deficit > 0) return;
    if (flow.requestedHint === 'semantic') showClue(flow.id, interactionId, modalId);
    else tryHint('bulb', flow.id, interactionId, modalId);
  };

  const closePendingHelp = () => {
    const flow = getHelpFlow(pendingHelpFlowId ?? undefined);
    if (flow) {
      closedHelpFlows.current.add(flow.id);
      try { closeHelpFlow(flow.id); } catch { /* Closing the UI never depends on metadata storage. */ }
      detachHelpRoute(flow.id);
    }
    setPendingHint(null);
    setPendingHelpFlowId(null);
    setHelpPathError(null);
  };

  const recoverSelectedReward = async () => {
    if (useRewardRecovery.getState().checking) return;
    try {
      const result = await recoverRewardedGrants();
      setHelpPathError(result.pending.length ? 'Награда ожидает сохранения. Повторный просмотр не нужен.' : null);
    } catch {
      setHelpPathError(rewardedStateMessage('reward_check_failed'));
    }
  };

  const finalize = async (): Promise<SubscriptionPromptResult> => {
    // A restored result may be the first screen of this visit: reset its interval
    // before taking the policy snapshot, just as opening a playable board does.
    const gameplaySession = beginGameplayAdSession();
    const meta = loadAdsMeta();
    const ads = getAds();
    const decision = evaluateConfiguredInterstitial(meta, {
      enabled: MONETIZATION.adsEnabled,
      removeAds,
      loaded: ads.isInterstitialReady(),
      nowMs: Date.now(),
      isFirstGameplaySession: gameplaySession.isFirstGameplaySession,
      campaignLevelId: isDaily ? null : globalLevelId,
      userContinued: true,
      rewardsCommitted: useGame.getState().completion.status === 'reward_claimed',
      protectedTransition: globalLevelId === 5 && introPlayer
        || globalLevelId >= totalLevelCount()
        || Boolean(settlement?.collectibleIds.length),
    });
    if (!decision.allowed) {
      recordInterstitialPolicySkip(decision.reason);
      return 'continue';
    }
    const res = await ads.showInterstitial('level_complete');
    if (res === 'shown') {
      saveAdsMeta(recordInterstitialShown(loadAdsMeta(), Date.now()));
      return subscriptionOffer.afterInterstitial(useLevels.getState().completed.length);
    } else if (res === 'unavailable') {
      track('ad_failed', { placement: 'level_complete', kind: 'interstitial' });
    }
    return 'continue';
  };

  const rewardedBonusPool = level.rewardedBonus ?? level.bonusPool;
  const rewardedBonusFoundWords = play.foundBonus.filter((word) => rewardedBonusPool.includes(word));
  const rewardedBonusFound = rewardedBonusFoundWords.length;
  const clueText = semanticClue
    ? `${semanticClue.targetLength} ${semanticClue.targetLength < 5 ? 'буквы' : 'букв'} · ${semanticClue.clue}`
    : undefined;

  const onNext = async (destination: 'campaign' | 'daily' = 'campaign'): Promise<boolean> => {
    if (claiming.current || getFullscreenSnapshot().owner !== null || hasActiveForm()) return false;
    claiming.current = true;
    if (useGame.getState().completion.status === 'completion_pending') settleCurrent();
    if (useGame.getState().completion.status !== 'reward_claimed') {
      claiming.current = false;
      return false;
    }
    try {
      detachHelpRoute();
      const globalId = globalLevelId;
      if (isDaily) {
        finish();
        applyRemoteConfigAtSafePoint();
        router.replace('/game?mode=normal' as never);
        return true;
      }
      if (destination === 'daily' && introPlayer && globalId === 5) {
        finish();
        applyRemoteConfigAtSafePoint();
        setString(KEYS.introSurface, 'menu');
        router.replace('/daily?source=intro_completion' as never);
        return true;
      }
      void useLeaderboard.getState().syncProgress(useLevels.getState().completed.length);
      if (globalId >= totalLevelCount()) {
        finish();
        applyRemoteConfigAtSafePoint();
        setString(KEYS.introSurface, 'menu');
        router.replace('/' as never);
        return true;
      }
      const updateAttempted = hasUpdateAttemptForResult(useGame.getState().snapshot?.attemptId);
      const reviewResult = updateAttempted ? 'unavailable' : await requestCampaignReview({
        levelId: globalId,
        completedCount: useLevels.getState().completed.length,
        firstCompletion: settlement?.firstCompletion === true,
        postcardMilestone: earnedCard !== null,
        daily: isDaily,
      }, () => {
        const recovery = useRewardRecovery.getState();
        return focused.current && appActive.current
          && useGame.getState().completion.status === 'reward_claimed'
          && !recovery.checking && !recovery.readFailed && recovery.pendingIds.length === 0
          && !useWheel.getState().pendingSpin && !useWheel.getState().preparedReward;
      });
      const offerResult = reviewResult === 'skipped' ? await finalize() : 'continue';
      if (offerResult === 'aborted' || !focused.current || !appActive.current) {
        claiming.current = false;
        return false;
      }
      finish();
      applyRemoteConfigAtSafePoint();
      if (introPlayer && globalId === 5) setString(KEYS.introSurface, 'menu');
      setCampaignLevelId(globalId + 1);
      if (offerResult === 'subscribe') router.push('/shop?source=post_ad' as never);
      return true;
    } catch (error) {
      console.warn('[game] leaving result deferred', error);
      setSaveError({ message: 'Результат сохранён, но переход пока недоступен. Повторите действие.', action: 'finish' });
      claiming.current = false;
      return false;
    }
  };

  const onExit = () => {
    if (rewardedBusy.current) return;
    recordPuzzleExit('menu_home');
    if (introPlayer && !isDaily && globalLevelId <= 5) {
      setString(KEYS.introSurface, 'menu');
      router.replace('/' as never);
      return;
    }
    goBack();
  };

  const onMenuFromResult = (): boolean => {
    if (getFullscreenSnapshot().owner !== null || hasActiveForm()) return false;
    if (useGame.getState().completion.status === 'completion_pending') settleCurrent();
    if (useGame.getState().completion.status !== 'reward_claimed') return false;
    try {
      detachHelpRoute();
      finish();
      if (introPlayer && !isDaily && globalLevelId <= 5) setString(KEYS.introSurface, 'menu');
      router.replace('/' as never);
      return true;
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
      else if (failure.action === 'hint') tryHint('bulb', failure.helpFlowId);
      else if (failure.action === 'clue') showClue(failure.helpFlowId);
      else if (failure.action === 'shuffle') tryShuffle();
      else if (failure.action === 'replay') {
        replayPendingLetterHint(isDaily ? `daily:${dailyInstance?.dateKey ?? ''}` : `campaign:${globalLevelId}`, (payment) => {
          const applied = useGame.getState().snapshot;
          if (applied) trackAppliedHelp(level, applied, payment, { kind: 'letter', recovery: true });
        });
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
  const pendingHelpQuote = pendingHelpFlow ? currentHelpQuote(pendingHelpFlow) : null;
  const pendingHelpMatches = Boolean(pendingHelpFlow && pendingHelpFlow.attemptId === activeAttemptId && pendingHelpQuote?.canResume);

  return (
    <View style={{ flex: 1 }}>
      <View testID="game-content" style={{ flex: 1 }} importantForAccessibility={pendingHint && !done && routeFocused ? 'no-hide-descendants' : 'auto'}>
      <WorldBackground world={level.world} image={latestLandmarkAt(level.world, done ? globalLevelId : globalLevelId - 1)?.image} dim />
      {showGameplay ? (
      <View
        key={transitionKey}
        pointerEvents={done || rewardedWatching ? 'none' : 'auto'}
        style={{ flex: 1 }}
      >
        <SafeAreaView style={{ flex: 1 }}>
        <View pointerEvents="none" style={{ position: 'absolute', top: 88, left: horizontalInset,
          right: horizontalInset, zIndex: 8, alignItems: 'center' }}>
          <LevelStartNote level={level} visible={startNoteAttempt === activeAttemptId && gameplayVisible
            && !isDaily && globalLevelId > 5} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: horizontalInset, gap: 8 }}>
          <IconButton name="back" onPress={() => { if (!rewardedBusy.current) setLevelMenuOpen(true); }} />
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
          testID="game-play-area"
          onLayout={(event) => recordHeight(event, playAreaHeight, setPlayAreaHeight)}
          style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          <ScrollView
            testID="game-play-scroll"
            style={{ flex: 1, width: '100%' }}
            scrollEnabled={scrollPlayArea}
            nestedScrollEnabled
            contentContainerStyle={{
              height: scrollPlayArea ? minimumPlayAreaHeight : playAreaHeight,
              alignItems: 'center',
              gap: gameLayout.contentGap,
              paddingTop: gameLayout.paddingTop,
              paddingBottom: gameLayout.paddingBottom,
            }}
          >
          <ScrollView
            key={levelId}
            testID="game-board-scroll"
            nestedScrollEnabled
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
                {level.mechanic === 'bonus_chest' ? <CompactBonusObjective
                  level={level} foundBonus={rewardedBonusFound} bankUnits={bonusBankUnits}
                  clue={clueText} clueOpen={clueOpen} clueAccent={helpAccent}
                  cluePrice={semanticDisplayedPrice} onCluePress={semanticClue ? () => showClue() : undefined}
                /> : <LevelObjective
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
                  cluePrice={semanticDisplayedPrice}
                  onCluePress={semanticClue ? () => showClue() : undefined}
                />}
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
                  <HintNudge visible={hintNudgeVisible && helpAccent && routeFocused && !done && !pendingHint
                    && !clueOpen && !levelMenuOpen && !rewardedWatching && !saveError && !introCaption}
                    onPress={() => { setHintNudgeVisible(false); tryHint('bulb'); }}
                    style={{ position: 'absolute', left: 0, bottom: gameLayout.diskSize + 4, zIndex: 5 }} />
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
                      cost={semanticDisplayedPrice}
                      onPress={() => showClue()}
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
          </ScrollView>
        </View>

        {introPlayer && !isDaily && globalLevelId <= 5 ? null : <AdBanner />}
        </SafeAreaView>
      </View>
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

      <PostAdSubscriptionOffer plan={subscriptionOffer.prompt} onShown={subscriptionOffer.onShown}
        onLater={subscriptionOffer.onLater} onSubscribe={subscriptionOffer.onSubscribe} />

      {showResult ? (
        <LevelComplete
          coins={awardedCoins}
          rewardPending={completion.status === 'completion_pending'}
          cardProgress={cardProgress}
          giftProgress={nextGiftProgress}
          journeyFinal={!isDaily && globalLevelId === totalLevelCount()}
          onNext={onNext}
          secondaryAction={activeAttemptId ? <UpdateAction attemptId={activeAttemptId} isSafePoint={() => isSavedUpdateSafePoint(
            focused.current && appActive.current && !claiming.current && !settling.current && !saveError
              && useGame.getState().snapshot?.attemptId === activeAttemptId,
          )} /> : null}
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
      </View>
      {pendingHint && !done ? (
        <NoCoinsModal
          focusedOffer
          earned={hasEarnedRewardedHint(pendingHelpFlowId)}
          requestedHint={pendingHint === 'clue' ? 'semantic' : 'letter'}
          attemptId={activeAttemptId}
          originInteractionId={pendingHelpFlow?.id}
          helpContext={pendingHelpFlow ? selectHelpContext({ ...helpFlowProperties(pendingHelpFlow), entry_source: 'no_coins' }) : undefined}
          routeFocused={routeFocused}
          uxVariant={resolveHelpUxVariant(pendingHelpFlow)}
          priceCoins={pendingHelpQuote?.price ?? (pendingHint === 'clue' ? semanticDisplayedPrice : freeIntroHelp ? 0 : hintCost('bulb'))}
          currentCoins={coins}
          hintName={pendingHint === 'clue' ? 'наводку' : 'букву'}
          canWatchAd={pendingHelpMatches && !recoveryBusy && (!introPlayer || globalLevelId > 5) && rewardedReady && rewardedToday < 3}
          rewardedEligible={(!introPlayer || globalLevelId > 5) && rewardedToday < 3}
          rewardedState={rewardedState}
          canFreeSpin={pendingHelpMatches && canFreeWheel}
          wheelRewardedRemaining={wheelRewardedRemaining}
          wheelPending={wheelPending}
          busy={rewardedWatching || recoveryBusy}
          errorMessage={helpPathError ?? (pendingHelpFlow && !pendingHelpQuote?.helpAvailable
            ? 'Выбранная помощь уже применена или недоступна. Продолжите слово и при необходимости выберите помощь заново.' : null)}
          onRecoverReward={recoveryBusy ? () => { void recoverSelectedReward(); } : undefined}
          recoveryChecking={useRewardRecovery.getState().checking}
          canShop={MONETIZATION.iapEnabled}
          onWatchAd={onWatchAdForHint}
          onFreeWheel={(interactionId, modalId) => openHelpWheel(true, interactionId, modalId)}
          onWheel={(interactionId, modalId) => openHelpWheel(false, interactionId, modalId)}
          onApplyHint={pendingHelpMatches && (pendingHelpQuote?.helpAvailable || hasEarnedRewardedHint(pendingHelpFlowId)) ? applyPendingHelp : undefined}
          onShop={() => {
            if (pendingHelpFlow) {
              pinHelpRequest(pendingHelpFlow);
              try { markHelpFlowReturned(pendingHelpFlow.id); } catch { /* Navigation keeps the saved origin. */ }
            }
            setPendingHint(null);
            router.push('/shop' as never);
          }}
          onClose={closePendingHelp}
        />
      ) : null}
    </View>
  );
}
