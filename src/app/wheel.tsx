import { useGoBack } from '@/core/nav';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { cancelAnimation, Easing, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, G, Line, Path, Polygon, Text as SvgText } from 'react-native-svg';

import { ECONOMY } from '@/core/config/economy';
import { t } from '@/core/i18n';
import { track, trackOnce } from '@/features/analytics';
import { selectHelpContext } from '@/features/analytics/helpContext';
import { useCurrency } from '@/features/currency';
import { useGame } from '@/features/game/store';
import { canResumeHelpFlow, currentHelpQuote, getHelpFlow, helpFlowGameHref, helpFlowProperties,
  markHelpFlowReturned, useHelpFlows } from '@/features/hints/help-flow';
import { exposeHelpExperiment, resolveHelpUxVariant, useHelpExperimentState } from '@/features/hints/help-experiment';
import { isExposureWindowFocused } from '@/features/retention-ui/viewportExposure';
import { getAds, requestRewarded, useRewardedState, type RewardedObservation } from '@/features/monetization';
import { acknowledgeNativeReward } from '@/features/monetization/nativeRewardJournal';
import { recoverRewardedGrants, useRewardRecovery } from '@/features/monetization/rewardRecovery';
import { rewardedStateMessage } from '@/features/monetization/rewardedState';
import { newMonetizationId, trackRewardReceipt } from '@/features/monetization/adTelemetry';
import { useWheel, type PendingWheelSpin } from '@/features/wheel';
import { wheelStopAngle } from '@/features/wheel/motion';
import { trackRetentionAction } from '@/features/retention-ui/analytics';
import { AppButton, AppText, CoinBadge, colors, fonts, GlassPanel, Icon, WorldBackground } from '@/ui';

const SECTORS = ECONOMY.wheel.sectors;
const N = SECTORS.length;
const STEP = 360 / N;
const C = 150;
const R = 140;
const MIN_REWARD = Math.min(...SECTORS);
const MAX_REWARD = Math.max(...SECTORS);

function slice(start: number, end: number): string {
  const a0 = ((start - 90) * Math.PI) / 180;
  const a1 = ((end - 90) * Math.PI) / 180;
  const x0 = C + R * Math.cos(a0);
  const y0 = C + R * Math.sin(a0);
  const x1 = C + R * Math.cos(a1);
  const y1 = C + R * Math.sin(a1);
  return `M${C} ${C} L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`;
}

export default function Wheel() {
  useHelpExperimentState((state) => state.revision);
  const goBack = useGoBack();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ helpFlowId?: string; source?: string; entryInteractionId?: string; modalId?: string }>();
  const flowId = typeof params.helpFlowId === 'string' ? params.helpFlowId : undefined;
  const entrySource = typeof params.source === 'string' ? params.source : undefined;
  const entryInteractionId = typeof params.entryInteractionId === 'string' ? params.entryInteractionId : undefined;
  const entryModalId = typeof params.modalId === 'string' ? params.modalId : undefined;
  const flow = useHelpFlows((state) => flowId && Object.hasOwn(state.flows, flowId) ? state.flows[flowId] : null);
  useGame((state) => state.snapshot);
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const wheelSize = Math.min(300, width - 32, height < 700 ? 240 : height < 820 ? 260 : 300);
  const coins = useCurrency((s) => s.coins);
  const canFree = useWheel((s) => s.canFree());
  const rewardedLeft = useWheel((s) => s.rewardedLeft());
  const spin = useWheel((s) => s.spin);
  const pendingSpin = useWheel((s) => s.pendingSpin ?? null);
  const lastGrantedSpin = useWheel((s) => s.lastGrantedSpin ?? null);
  const initialFlowReward = !pendingSpin && flow && lastGrantedSpin?.flowContext?.origin_interaction_id === flow.id ? lastGrantedSpin : null;
  const quote = flow ? currentHelpQuote(flow) : null;
  const clarity = resolveHelpUxVariant(flow) === 'clarity';
  const originalAvailable = Boolean(flow && quote?.canResume);
  const rewardedState = useRewardedState();
  const rotation = useSharedValue(0);
  const [screenVisitId, setScreenVisitId] = useState(() => `wheel:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`);
  const [busy, setBusy] = useState(Boolean(pendingSpin));
  const [result, setResult] = useState<number | null>(initialFlowReward?.value ?? null);
  const [resultSector, setResultSector] = useState<number | null>(initialFlowReward?.sector ?? null);
  const [resultFlowId, setResultFlowId] = useState<string | null>(flow && initialFlowReward ? flow.id : null);
  const [shownResult, setShownResult] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [awaitingAd, setAwaitingAd] = useState(false);
  const spinLock = useRef(false);
  const [localRecoveryChecking, setRecovering] = useState(true);
  const rewardChecking = useRewardRecovery((state) => state.checking);
  const recovering = localRecoveryChecking || rewardChecking;
  const recoveryPending = useRewardRecovery((state) => state.readFailed || state.pendingIds.length > 0);
  const observedGrant = useRef(lastGrantedSpin?.effectId);
  const entryReadiness = useRef(rewardedState);
  const openedAt = useRef(Date.now());
  const reachedReady = useRef(rewardedState === 'ready');
  const rewardedEligibleAtEntry = useRef(rewardedLeft > 0 && !pendingSpin);
  const activeVisitId = useRef(screenVisitId);
  const visitClosed = useRef(false);
  const visited = useRef(false);
  const routeFocused = useRef(true);
  const actualLayout = useRef(false);
  const windowFocused = useRef(isExposureWindowFocused());
  const exposeVisible = useCallback(() => {
    if (flowId) exposeHelpExperiment(flowId, 'wheel', Date.now(), { layoutReady: actualLayout.current,
      routeFocused: routeFocused.current, windowFocused: windowFocused.current,
      active: AppState.currentState === 'active' });
  }, [flowId]);
  useEffect(() => {
    const blur = AppState.addEventListener('blur', () => { windowFocused.current = false; });
    const focus = AppState.addEventListener('focus', () => { windowFocused.current = true; exposeVisible(); });
    return () => { blur.remove(); focus.remove(); };
  }, [exposeVisible]);
  const returning = useRef(false);
  const actionContext = useCallback((interactionId?: string) => {
    const current = getHelpFlow(flowId);
    return selectHelpContext({ ...(current ? helpFlowProperties(current) : {}),
      entry_source: entrySource ?? current?.entrySource ?? 'direct',
      interaction_id: interactionId ?? entryInteractionId, modal_id: entryModalId,
      ...(current ? { displayed_cost: currentHelpQuote(current).price } : {}), balance: useCurrency.getState().coins });
  }, [entryInteractionId, entryModalId, entrySource, flowId]);
  const returnToOrigin = useCallback(() => {
    if (returning.current) return;
    const current = getHelpFlow(flowId);
    const canReturn = Boolean(current && canResumeHelpFlow(current));
    const returnInteractionId = newMonetizationId('wi');
    trackRetentionAction('wheel', canReturn ? 'return_to_word' : 'map', { ...actionContext(returnInteractionId),
      screen_visit_id: activeVisitId.current, action: canReturn ? 'return' : 'tap',
      ...(current && !canReturn ? { blocked_reason: 'attempt_changed' } : {}) });
    if (!current) {
      if (flowId) { returning.current = true; router.replace('/'); }
      else goBack();
      return;
    }
    if (!canReturn) { returning.current = true; router.replace('/'); return; }
    returning.current = true;
    try { markHelpFlowReturned(current.id); } catch { /* The already durable original context still permits safe return. */ }
    try {
      const state = navigation.getState();
      const previous = state ? state.routes[state.index - 1] : undefined;
      if (previous?.name === 'game' && useGame.getState().snapshot?.attemptId === current.attemptId && router.canGoBack()) router.back();
      else router.replace(helpFlowGameHref(current) as never);
    } catch {
      router.replace(helpFlowGameHref(current) as never);
    }
  }, [actionContext, flowId, goBack, navigation, router]);
  useFocusEffect(useCallback(() => {
    if (!flowId) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { returnToOrigin(); return true; });
    return () => subscription.remove();
  }, [flowId, returnToOrigin]));
  useEffect(() => useRewardRecovery.subscribe((state, previous) => {
    if (previous.checking && !state.checking && !state.readFailed && state.pendingIds.length === 0
      && useWheel.getState().lastGrantedSpin) setErrorMessage(null);
  }), []);
  const closeVisit = useCallback((reason: 'background' | 'blur') => {
    if (visitClosed.current) return;
    visitClosed.current = true;
    try { track('ui_action', { ...actionContext(), interaction_id: `${activeVisitId.current}:exit`, screen: 'wheel', screen_visit_id: activeVisitId.current,
      element_id: 'wheel', action: 'exit', outcome: reason, ready_at_entry: entryReadiness.current === 'ready',
      rewarded_eligible: rewardedEligibleAtEntry.current, left_before_ready: !reachedReady.current,
      wait_ms: Math.max(0, Date.now() - openedAt.current) }); } catch { /* Leaving the screen never depends on telemetry. */ }
  }, [actionContext]);
  const resumeVisit = useCallback(() => {
    if (!visitClosed.current) return;
    visitClosed.current = false;
    activeVisitId.current = `wheel:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    entryReadiness.current = getAds().getRewardedState?.() ?? (getAds().isRewardedReady() ? 'ready' : 'not_ready');
    openedAt.current = Date.now();
    reachedReady.current = entryReadiness.current === 'ready';
    rewardedEligibleAtEntry.current = useWheel.getState().rewardedLeft() > 0 && !useWheel.getState().pendingSpin;
    setScreenVisitId(activeVisitId.current);
  }, []);
  useFocusEffect(useCallback(() => {
    routeFocused.current = true;
    exposeVisible();
    returning.current = false;
    if (visited.current) resumeVisit();
    visited.current = true;
    return () => { routeFocused.current = false; closeVisit('blur'); };
  }, [closeVisit, resumeVisit, exposeVisible]));

  useEffect(() => {
    if (rewardedState !== 'ready' || reachedReady.current || visitClosed.current || !routeFocused.current) return;
    reachedReady.current = true;
    try { track('ui_action', { ...actionContext(), interaction_id: `${screenVisitId}:ready`, screen: 'wheel', screen_visit_id: screenVisitId,
      element_id: 'rewarded_spin', action: 'ready', outcome: 'ready', rewarded_state: 'ready',
      wait_ms: Math.max(0, Date.now() - openedAt.current), rewarded_eligible: rewardedEligibleAtEntry.current }); } catch { /* Optional readiness telemetry. */ }
  }, [actionContext, rewardedState, screenVisitId]);

  useEffect(() => {
    if (!lastGrantedSpin || observedGrant.current === lastGrantedSpin.effectId) return;
    observedGrant.current = lastGrantedSpin.effectId;
    setResult(lastGrantedSpin.value);
    setResultSector(lastGrantedSpin.sector);
    setResultFlowId(typeof lastGrantedSpin.flowContext?.origin_interaction_id === 'string' ? lastGrantedSpin.flowContext.origin_interaction_id : null);
    if (!spinLock.current) setBusy(false);
  }, [lastGrantedSpin]);

  const recover = useCallback(async (releaseUnconfirmed = false) => {
    try {
      const recovered = await recoverRewardedGrants({ releaseUnconfirmed });
      const wheelReward = recovered.granted.filter((receipt) => receipt.kind === 'wheel').at(-1);
      if (wheelReward) {
        setResult(wheelReward.amount);
        setResultSector(wheelReward.sector ?? null);
        setResultFlowId(typeof wheelReward.flowContext?.origin_interaction_id === 'string' ? wheelReward.flowContext.origin_interaction_id : null);
        if (!spinLock.current) setBusy(false);
      }
      setErrorMessage(recovered.pending.length ? rewardedStateMessage('pending') : null);
    } catch {
      setErrorMessage('Не удалось проверить сохранение награды. Повторите восстановление.');
    } finally { setRecovering(false); }
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) return recover(getAds().getRewardedState?.() !== 'fullscreen_busy');
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (spinLock.current || !routeFocused.current) return;
      if (state === 'active') { resumeVisit(); void recover(); exposeVisible(); }
      else closeVisit('background');
    });
    return () => { mounted = false; subscription.remove(); };
  }, [closeVisit, recover, resumeVisit, exposeVisible]);

  useEffect(() => {
    try { track('wheel_opened', { ...actionContext(), screen: 'wheel', screen_visit_id: screenVisitId, free_available: useWheel.getState().canFree(),
      rewarded_remaining: useWheel.getState().rewardedLeft(), pending_spin: Boolean(useWheel.getState().pendingSpin),
      rewarded_state: entryReadiness.current, ready_at_entry: entryReadiness.current === 'ready',
      rewarded_eligible: rewardedEligibleAtEntry.current,
      ...(entryReadiness.current !== 'ready' ? { blocked_reason: entryReadiness.current } : {}) }); } catch { /* Optional entry telemetry. */ }
  }, [actionContext, screenVisitId]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));

  useEffect(() => {
    if (result == null) return;
    const steps = 12;
    let current = 0;
    const start = setTimeout(() => setShownResult(0), 0);
    const timer = setInterval(() => {
      current += 1;
      setShownResult(Math.round((result * current) / steps));
      if (current >= steps) clearInterval(timer);
    }, 32);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [result]);

  const grant = useCallback((outcome: PendingWheelSpin) => {
    try {
      const wallet = useCurrency.getState();
      const applied = outcome.flowContext
        ? wallet.addOnce(outcome.effectId, 'coins', outcome.value, selectHelpContext(outcome.flowContext))
        : wallet.addOnce(outcome.effectId, 'coins', outcome.value);
      if (!applied && !wallet.hasApplied(outcome.effectId)) throw new Error('Wheel reward was not saved');
      const transaction = useCurrency.getState().getTransaction(outcome.effectId);
      if (outcome.viaRewarded) trackRewardReceipt({ kind: 'wheel', rewardId: outcome.effectId,
        flowContext: { ...selectHelpContext(outcome.flowContext), opportunity_id: outcome.opportunityId, request_id: outcome.requestId } },
      'grant_persisted', transaction);
      useWheel.getState().claimPending(outcome.effectId, transaction);
      void (outcome.viaRewarded ? acknowledgeNativeReward(outcome.effectId) : Promise.resolve())
        .catch(() => {}).then(() => recover());
      if (applied) try { trackOnce('coins_earned', outcome.effectId, { reason: 'wheel', amount: outcome.value }); } catch { /* The wallet is already committed. */ }
      setResult(outcome.value);
      setResultSector(outcome.sector);
      setResultFlowId(typeof outcome.flowContext?.origin_interaction_id === 'string' ? outcome.flowContext.origin_interaction_id : null);
    } catch (error) {
      try { trackOnce('reward_grant_failed', `${outcome.effectId}:failure`, { ...selectHelpContext(outcome.flowContext), rewardId: outcome.effectId,
        operation_id: outcome.effectId, attempt_no: 1, source: 'wheel', reason: 'save_failed', normalized_reason: 'save_failed', retryable: true }); } catch { /* Pending reward stays recoverable. */ }
      console.warn('[wheel] reward save deferred', error);
      setErrorMessage('Не удалось сохранить выигрыш. Повторите выдачу.');
    } finally {
      setBusy(false);
      spinLock.current = false;
    }
  }, [recover]);

  useEffect(() => {
    if (!pendingSpin) return;
    const target = wheelStopAngle(rotation.get(), pendingSpin.sector, N);
    if (reducedMotion) {
      rotation.set(target);
      const timer = setTimeout(() => grant(pendingSpin), 180);
      return () => clearTimeout(timer);
    }
    rotation.set(withTiming(target, {
      duration: 3_600,
      easing: Easing.bezier(0.77, 0, 0.175, 1),
    }, (finished) => {
      if (finished) scheduleOnRN(grant, pendingSpin);
    }));
    return () => cancelAnimation(rotation);
  }, [grant, pendingSpin, reducedMotion, rotation]);

  const doSpin = async (viaRewarded: boolean) => {
    if (spinLock.current || busy || pendingSpin || recovering || recoveryPending) return;
    if (viaRewarded && (rewardedState !== 'ready' || useWheel.getState().rewardedLeft() <= 0)) {
      setErrorMessage(rewardedStateMessage(useWheel.getState().rewardedLeft() <= 0 ? 'daily_limit' : rewardedState));
      return;
    }
    spinLock.current = true;
    const interactionId = newMonetizationId('wi');
    const flowContext = actionContext(interactionId);
    trackRetentionAction('wheel', viaRewarded ? 'rewarded_spin' : 'free_spin', flowContext);
    setBusy(true);
    setResult(null);
    setResultSector(null);
    setErrorMessage(null);
    let earned = false;
    let earnedCallbackAtMs: number | undefined;
    try {
      let observation: RewardedObservation | undefined;
      if (viaRewarded) {
        const receipt = useWheel.getState().prepareRewarded(flowContext);
        if (!receipt) { setBusy(false); spinLock.current = false; return; }
        setAwaitingAd(true);
        const adResult = await requestRewarded('wheel', { rewardId: receipt.rewardId, receipt,
          persistenceStage: 'earned_pending',
          persistGrant: () => {
            earned = true;
            earnedCallbackAtMs ??= Date.now();
            return useWheel.getState().confirmRewarded(receipt, observation, earnedCallbackAtMs);
          } },
        (actual) => { observation = actual; });
        setAwaitingAd(false);
        if (adResult !== 'rewarded') {
          useWheel.getState().releasePrepared(receipt.rewardId);
          setErrorMessage(rewardedStateMessage(adResult === 'dismissed' ? 'cancelled'
            : getAds().getRewardedFailure?.() ?? 'not_ready'));
          setBusy(false);
          spinLock.current = false;
          return;
        }
        earned = true;
        // Retry a callback write failure without requesting another ad.
        if (!useWheel.getState().confirmRewarded(receipt, observation, earnedCallbackAtMs)) throw new Error('Earned spin is pending');
        if (useWheel.getState().grantedSpins?.[receipt.rewardId]) { setBusy(false); spinLock.current = false; }
      } else if (!spin(false, undefined, flowContext)) {
        setBusy(false);
        spinLock.current = false;
      }
    } catch (error) {
      console.warn('[wheel] spin save deferred', error);
      setAwaitingAd(false);
      setErrorMessage(rewardedStateMessage(earned ? 'save_failed' : 'offer_save_failed'));
      if (earned) void recover();
      setBusy(false);
      spinLock.current = false;
    }
  };

  return (
    <View style={{ flex: 1 }} onLayout={(event) => {
      const { width: layoutWidth, height: layoutHeight } = event.nativeEvent.layout;
      actualLayout.current = Number.isFinite(layoutWidth) && layoutWidth > 0 && Number.isFinite(layoutHeight) && layoutHeight > 0;
      exposeVisible();
    }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={flowId && clarity ? originalAvailable ? 'Вернуться к слову' : 'К карте' : t('map')}
            variant="glass" icon="back" onPress={returnToOrigin}
            style={flowId && clarity ? { maxWidth: '70%', flexShrink: 1, paddingHorizontal: 14 } : undefined} />
          <CoinBadge value={coins} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
        >
          <AppText preset="display">{t('wheel')}</AppText>
          {clarity ? <AppText preset="body" style={{ color: colors.cream, textAlign: 'center', maxWidth: 360 }}>Монеты нужны для букв и наводок</AppText> : null}
          {flowId && clarity ? (
            <GlassPanel strong style={{ width: '100%', maxWidth: 360, padding: 14, gap: 8 }}>
              {!originalAvailable ? (
                <AppText preset="body">Исходная попытка уже изменилась или завершена. Монеты останутся на балансе. Можно вернуться к карте.</AppText>
              ) : quote && flow ? (
                <>
                  <AppText preset="body">
                    {quote.alreadyOwned ? 'Наводка уже открыта. Повторная оплата не нужна.' : quote.free ? 'Выбранная помощь доступна бесплатно.'
                      : !quote.helpAvailable ? 'В этом слове выбранная помощь больше недоступна.'
                      : result !== null && resultFlowId === flow.id ? quote.deficit > 0
                        ? `Получено ${result} монет. Баланс — ${coins}. До ${flow.requestedHint === 'letter' ? 'буквы' : 'наводки'} не хватает ещё ${quote.deficit}.`
                        : `Получено ${result} монет. Теперь монет хватает на ${quote.hintName}. Баланс — ${coins}.`
                      : `Для ${flow.requestedHint === 'letter' ? 'буквы' : 'наводки'} нужно ${quote.price} монет. У вас ${coins}.${quote.deficit > 0 ? ` Не хватает ${quote.deficit}.` : ' Монет достаточно.'}`}
                  </AppText>
                  <AppText preset="body" style={{ color: colors.textMuted, fontSize: 13 }}>Подсказка применяется в слове только по вашему нажатию, с показанной ценой.</AppText>
                  <AppButton label="Вернуться к слову" variant="accent" onPress={returnToOrigin} />
                </>
              ) : null}
            </GlassPanel>
          ) : null}

          <View style={{ width: wheelSize, height: wheelSize + 12, alignItems: 'center' }}>
            <Animated.View style={style}>
              <Svg width={wheelSize} height={wheelSize} viewBox="0 0 300 300">
                <G>
                  <Circle cx={C} cy={C} r={R + 8} fill={colors.glassStrong} />
                  {SECTORS.map((v, i) => (
                    <Path
                      key={i}
                      d={slice(i * STEP, (i + 1) * STEP)}
                      fill={resultSector === i ? colors.amber : i % 2 === 0 ? colors.green : colors.greenDark}
                      stroke={colors.glassBorder}
                      strokeWidth={resultSector === i ? 3 : 1.2}
                    />
                  ))}
                  {SECTORS.map((_, i) => {
                    const a = ((i * STEP - 90) * Math.PI) / 180;
                    return <Line key={`d${i}`} x1={C} y1={C} x2={C + R * Math.cos(a)} y2={C + R * Math.sin(a)} stroke={colors.glassBorder} strokeWidth={1} />;
                  })}
                  {SECTORS.map((v, i) => {
                    const mid = ((i * STEP + STEP / 2 - 90) * Math.PI) / 180;
                    return (
                      <SvgText
                        key={`t${i}`}
                        x={C + R * 0.66 * Math.cos(mid)}
                        y={C + R * 0.66 * Math.sin(mid) + 6}
                        fontSize={20}
                        fontFamily={fonts.tile}
                        fill={resultSector === i ? colors.onAmber : colors.text}
                        textAnchor="middle"
                      >
                        {v}
                      </SvgText>
                    );
                  })}
                  <Circle cx={C} cy={C} r={42} fill={colors.glassStrong} stroke={colors.gridHint} strokeWidth={2} />
                  <Circle cx={C} cy={C} r={18} fill={colors.amber} />
                </G>
              </Svg>
            </Animated.View>
            {/* Указатель — статичный оверлей поверх крутящегося диска (внутри своего <Svg>). */}
            <Svg width={wheelSize} height={20} viewBox="0 0 300 20" style={{ position: 'absolute', top: 0, zIndex: 2 }} pointerEvents="none">
              <Polygon points="150,20 136,0 164,0" fill={colors.shadow} opacity={0.32} />
              <Polygon points="150,18 138,0 162,0" fill={colors.amber} />
            </Svg>
          </View>

          {result !== null ? (
            <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(260)}>
              <GlassPanel strong style={{ paddingVertical: 10, paddingHorizontal: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="coin" size={22} color={colors.amber} />
                  <AppText preset="title">Выигрыш: {shownResult}</AppText>
                </View>
              </GlassPanel>
            </Animated.View>
          ) : null}

          {errorMessage ? <AppText preset="body" style={{ color: colors.cream, textAlign: 'center' }}>{errorMessage}</AppText> : null}
          {errorMessage && pendingSpin ? <AppButton label="Повторить выдачу" variant="accent" onPress={() => grant(pendingSpin)} /> : null}
          {(recoveryPending || rewardedState === 'save_failed') && !pendingSpin ? <AppButton label="Восстановить награду" variant="accent" disabled={recovering} onPress={() => { void recover(true); }} /> : null}

          <View style={{ width: '100%', maxWidth: 360, gap: 10 }}>
            {canFree || busy ? (
              <AppButton label={busy ? awaitingAd ? 'Открываем рекламу…' : 'Колесо вращается…' : 'Бесплатное вращение'} icon="wheel" large disabled={busy || recovering || recoveryPending} onPress={() => doSpin(false)} style={{ alignSelf: 'stretch' }} />
            ) : (
              <AppText preset="body" style={{ color: colors.cream, textAlign: 'center', fontSize: 13, paddingVertical: 6 }}>
                Следующее бесплатное вращение завтра
              </AppText>
            )}
            {clarity && canFree ? <AppText preset="body" style={{ color: colors.cream, textAlign: 'center', fontSize: 13 }}>Без рекламы. Случайный выигрыш {MIN_REWARD}–{MAX_REWARD} монет.</AppText> : null}
            <AppButton label={rewardedState === 'loading' ? 'Реклама загружается…' : `За рекламу (${rewardedLeft})`} variant="glass" icon="play" disabled={rewardedLeft <= 0 || busy || recovering || recoveryPending || rewardedState !== 'ready'} onPress={() => doSpin(true)} style={{ alignSelf: 'stretch' }} />
            {clarity ? <AppText preset="body" style={{ color: colors.cream, textAlign: 'center', fontSize: 13 }}>За просмотр рекламы — одно вращение. Случайный выигрыш {MIN_REWARD}–{MAX_REWARD} монет.</AppText> : null}
            {!busy && !pendingSpin && (rewardedState !== 'ready' || rewardedLeft <= 0) ? <AppText preset="body" style={{ color: colors.cream, textAlign: 'center', fontSize: 13 }}>{rewardedStateMessage(rewardedLeft <= 0 ? 'daily_limit' : rewardedState)}</AppText> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
