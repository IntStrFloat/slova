import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';

import { ECONOMY } from '@/core/config/economy';
import { track, trackOnce } from '@/features/analytics';
import { selectHelpContext, type HelpAnalyticsContext } from '@/features/analytics/helpContext';
import { exposeHelpExperiment, resolveHelpUxVariant, useHelpExperimentState } from '@/features/hints/help-experiment';
import { isExposureWindowFocused, useViewportExposure } from '@/features/retention-ui/viewportExposure';
import { AppButton, AppText, colors, GlassPanel, Icon } from '@/ui';
import { newMonetizationId } from './adTelemetry';
import { rewardedStateMessage } from './rewardedState';
import type { RewardedState } from './types';
import { HintOfferModal } from './HintOfferModal';

export function NoCoinsModal({ focusedOffer, earned, ...props }: Parameters<typeof LegacyNoCoinsModal>[0] & {
  focusedOffer?: boolean;
  earned?: boolean;
}) {
  return focusedOffer ? <HintOfferModal {...props} requestedHint={props.requestedHint ?? 'letter'}
    rewardedEligible={props.rewardedEligible ?? props.canWatchAd} rewardedState={props.rewardedState ?? 'not_ready'}
    earned={earned} /> : <LegacyNoCoinsModal {...props} />;
}

type OptionAction = 'rewarded' | 'free_wheel' | 'wheel' | 'shop' | 'close' | 'apply_hint' | 'recover_reward';
type OptionCallback = (interactionId?: string, modalId?: string) => void | Promise<unknown>;
const ENTRY_IDS = ['free_wheel:available', 'free_wheel:blocked', 'wheel:available', 'wheel:blocked'];
type WheelEntry = { key: 'free_wheel' | 'wheel'; id: string; available: boolean; blockedReason?: string };

/** Explicit options when a player asks for a letter without enough resources. */
function LegacyNoCoinsModal({
  priceCoins,
  currentCoins,
  hintName = 'букву',
  canWatchAd,
  onWatchAd,
  onWheel,
  onShop,
  onClose,
  canShop = false,
  requestedHint = 'letter',
  attemptId,
  originInteractionId,
  uxVariant: _legacyUxVariant,
  canFreeSpin = false,
  wheelRewardedRemaining = ECONOMY.wheel.maxRewardedSpins,
  wheelPending = false,
  rewardedEligible = canWatchAd,
  rewardedState = canWatchAd ? 'ready' : 'not_ready',
  onFreeWheel,
  onApplyHint,
  onRecoverReward,
  recoveryChecking = false,
  errorMessage,
  busy = false,
  helpContext,
  routeFocused = true,
}: {
  priceCoins: number;
  currentCoins: number;
  hintName?: string;
  canWatchAd: boolean;
  onWatchAd: OptionCallback;
  onWheel: OptionCallback;
  onShop: OptionCallback;
  onClose: OptionCallback;
  canShop?: boolean;
  requestedHint?: 'letter' | 'semantic';
  attemptId?: string;
  originInteractionId?: string;
  uxVariant?: 'control' | 'clarity';
  canFreeSpin?: boolean;
  wheelRewardedRemaining?: number;
  wheelPending?: boolean;
  rewardedEligible?: boolean;
  rewardedState?: RewardedState;
  onFreeWheel?: OptionCallback;
  onApplyHint?: OptionCallback;
  onRecoverReward?: OptionCallback;
  recoveryChecking?: boolean;
  errorMessage?: string | null;
  busy?: boolean;
  helpContext?: HelpAnalyticsContext;
  routeFocused?: boolean;
}) {
  const { height, width, fontScale } = useWindowDimensions();
  const [overlayHeight, setOverlayHeight] = useState(height);
  const [modalId] = useState(() => newMonetizationId('nc'));
  const selecting = useRef(false);
  useHelpExperimentState((state) => state.revision);
  const clarity = resolveHelpUxVariant(originInteractionId ?? null) === 'clarity';
  const deficit = Math.max(0, priceCoins - currentCoins);
  const canApply = deficit === 0 && Boolean(onApplyHint);
  const minReward = Math.min(...ECONOMY.wheel.sectors);
  const maxReward = Math.max(...ECONOMY.wheel.sectors);
  const wheelRendered = !clarity || deficit > 0;
  const freeRendered = clarity && deficit > 0 && canFreeSpin;
  const wheelEnabled = !busy && (!clarity || wheelPending || wheelRewardedRemaining > 0);
  const availableActions = [clarity && canApply && !busy ? 'apply_hint' : '',
    (!clarity || deficit > 0) && canWatchAd && !busy ? 'rewarded' : '',
    freeRendered && !busy ? 'free_wheel' : '', wheelRendered && wheelEnabled ? 'wheel' : '',
    canShop && (!clarity || deficit > 0) && !busy ? 'shop' : '',
    onRecoverReward && !recoveryChecking ? 'recover_reward' : '', 'close'].filter(Boolean).join(',');
  const context = { ...selectHelpContext({ ...helpContext, attemptId: attemptId ?? helpContext?.attemptId,
    origin_interaction_id: originInteractionId ?? helpContext?.origin_interaction_id,
    requested_hint: requestedHint, displayed_cost: priceCoins, balance: currentCoins,
    entry_source: helpContext?.entry_source ?? 'no_coins' }),
  modal_id: modalId, screen: 'game' };
  const entries: WheelEntry[] = [
    ...(freeRendered ? [{ key: 'free_wheel' as const, id: `free_wheel:${busy ? 'blocked' : 'available'}`, available: !busy, ...(busy ? { blockedReason: 'busy' } : {}) }] : []),
    ...(wheelRendered ? [{ key: 'wheel' as const, id: `wheel:${wheelEnabled ? 'available' : 'blocked'}`, available: wheelEnabled,
      ...(!wheelEnabled ? { blockedReason: busy ? 'busy' : 'daily_limit' } : {}) }] : []),
  ];
  const contentRoot = useRef<View | null>(null);
  const overlayRoot = useRef<View | null>(null);
  const entryNodes = useRef<{ free_wheel: View | null; wheel: View | null }>({ free_wheel: null, wheel: null });
  const windowState = useRef({ alive: true, shown: false, entryRecorded: false, layoutReady: false,
    layoutWidth: 0, layoutHeight: 0, closed: false, suspended: false, routeFocused,
    windowFocused: isExposureWindowFocused() && rewardedState !== 'background', measureEpoch: 0 });
  const latest = useRef({ context, entries, availableActions, rewardedState, rewardedEligible, clarity });
  const wait = useRef({ active: false, openedAt: 0, readyAtEntry: false, reachedReady: false, readyWaitMs: 0, eligible: false });
  const exposure = useViewportExposure((id, observation) => {
    const visible = windowState.current;
    const current = latest.current;
    const entry = current.entries.find((item) => item.id === id);
    if (!visible.alive || !visible.shown || visible.closed || visible.suspended || !visible.routeFocused || !visible.windowFocused || !entry) return;
    try { trackOnce('feature_exposed', `${modalId}:${id}`, { ...current.context, feature: 'wheel_entry', element_id: entry.key,
      is_available: entry.available, rewarded_state: current.rewardedState,
      ...(entry.blockedReason ? { blocked_reason: entry.blockedReason } : {}), ...observation }); } catch { /* Optional exposure telemetry. */ }
  }, ENTRY_IDS, `${modalId}:${context.origin_interaction_id ?? 'none'}`);
  const invalidateEntries = useCallback(() => {
    windowState.current.measureEpoch += 1;
    for (const id of ENTRY_IDS) exposure.invalidate(id);
  }, [exposure]);
  const measureEntries = useCallback(() => {
    invalidateEntries();
    const visible = windowState.current;
    const root = contentRoot.current;
    const overlay = overlayRoot.current;
    if (!root || !overlay || !visible.alive || !visible.shown || !visible.layoutReady
      || visible.closed || visible.suspended || !visible.routeFocused || !visible.windowFocused) return;
    const epoch = visible.measureEpoch;
    const measure = () => {
      if (windowState.current.measureEpoch !== epoch) return;
      for (const entry of latest.current.entries) exposure.measureLayout(entry.id, entryNodes.current[entry.key], root);
    };
    if (latest.current.clarity) measure();
    else overlay.measureInWindow((_overlayX, overlayY, _overlayWidth, measuredHeight) => {
      if (windowState.current.measureEpoch !== epoch) return;
      const visibleHeight = Math.min(measuredHeight, windowState.current.layoutHeight);
      if (!Number.isFinite(overlayY) || !Number.isFinite(visibleHeight) || visibleHeight <= 0) return;
      root.measureInWindow((_x, y, _width, contentHeight) => {
        if (windowState.current.measureEpoch !== epoch) return;
        const offset = Math.max(0, overlayY - y);
        exposure.setViewport(offset, Math.max(0, Math.min(contentHeight, overlayY + visibleHeight - y) - offset));
        measure();
      });
    });
  }, [exposure, invalidateEntries]);
  const finishWait = useCallback((reason: string) => {
    const current = wait.current;
    if (!current.active) return;
    current.active = false;
    try { track('ui_action', { ...latest.current.context, interaction_id: newMonetizationId('ncstate'),
      element_id: 'no_coins', action: 'exit', outcome: reason, ready_at_entry: current.readyAtEntry,
      rewarded_eligible: current.eligible, left_before_ready: !current.reachedReady,
      wait_ms: current.reachedReady ? current.readyWaitMs : Math.max(0, Date.now() - current.openedAt) }); } catch { /* Optional readiness telemetry. */ }
  }, []);
  const startVisibleVisit = useCallback((resume = false, resetExposure = true) => {
    const visible = windowState.current;
    if (!visible.alive || !visible.layoutReady || visible.closed || visible.suspended || !visible.routeFocused || !visible.windowFocused
      || AppState.currentState !== 'active' && AppState.currentState !== null) return;
    const firstVisibleLayout = !visible.shown;
    visible.shown = true;
    if (originInteractionId) exposeHelpExperiment(originInteractionId, 'no_coins', Date.now(), {
      layoutReady: visible.layoutReady, routeFocused: visible.routeFocused, windowFocused: visible.windowFocused,
      active: AppState.currentState === 'active' });
    if (!visible.entryRecorded) {
      visible.entryRecorded = true;
      try { trackOnce('no_coins_shown', modalId, { ...latest.current.context, cost: latest.current.context.displayed_cost,
        available_actions: latest.current.availableActions, rewarded_state: latest.current.rewardedState,
        ready_at_entry: latest.current.rewardedState === 'ready', rewarded_eligible: latest.current.rewardedEligible }); } catch { /* Optional entry telemetry. */ }
    }
    const ready = latest.current.rewardedState === 'ready';
    if (!wait.current.active) {
      wait.current = { active: true, openedAt: Date.now(), readyAtEntry: ready, reachedReady: ready, readyWaitMs: 0, eligible: latest.current.rewardedEligible };
      if (resume) try { track('ui_action', { ...latest.current.context, interaction_id: newMonetizationId('ncstate'),
        element_id: 'no_coins', action: 'resume', outcome: 'opened', rewarded_state: latest.current.rewardedState,
        ready_at_entry: ready, rewarded_eligible: latest.current.rewardedEligible, wait_ms: 0 }); } catch { /* Optional telemetry. */ }
    }
    if (resetExposure || firstVisibleLayout) exposure.focus();
    measureEntries();
  }, [exposure, measureEntries, modalId, originInteractionId]);
  const onOverlayLayout = (event: LayoutChangeEvent) => {
    const visible = windowState.current;
    if (!visible.alive || !visible.routeFocused || visible.closed) return;
    const layout = event.nativeEvent.layout;
    const positive = Number.isFinite(layout.width) && Number.isFinite(layout.height) && layout.width > 0 && layout.height > 0;
    const changed = visible.layoutWidth !== layout.width || visible.layoutHeight !== layout.height;
    visible.layoutReady = positive;
    visible.layoutWidth = layout.width; visible.layoutHeight = layout.height;
    if (!positive) { visible.shown = false; finishWait('layout_hidden'); exposure.blur(); invalidateEntries(); return; }
    setOverlayHeight((previous) => previous === layout.height ? previous : layout.height);
    if (!visible.shown) startVisibleVisit(visible.entryRecorded);
    else if (changed) measureEntries();
  };
  useLayoutEffect(() => {
    latest.current = { context, entries, availableActions, rewardedState, rewardedEligible, clarity };
    windowState.current.routeFocused = routeFocused;
    if (!routeFocused) {
      windowState.current.shown = false;
      windowState.current.layoutReady = false;
      windowState.current.layoutWidth = 0; windowState.current.layoutHeight = 0;
      finishWait('blur'); exposure.blur(); invalidateEntries();
    }
    if (wait.current.active && rewardedState === 'ready' && !wait.current.reachedReady) {
      wait.current.reachedReady = true;
      wait.current.readyWaitMs = Math.max(0, Date.now() - wait.current.openedAt);
      try { track('ui_action', { ...context, interaction_id: newMonetizationId('ncstate'), element_id: 'no_coins',
        action: 'ready', outcome: 'ready', rewarded_state: 'ready', wait_ms: wait.current.readyWaitMs,
        rewarded_eligible: wait.current.eligible }); } catch { /* Optional telemetry. */ }
    }
  });
  const layoutSignature = [clarity, priceCoins, currentCoins, hintName, canWatchAd, canFreeSpin, wheelPending,
    wheelRewardedRemaining, canShop, busy, errorMessage, recoveryChecking, Boolean(onApplyHint), Boolean(onRecoverReward),
    rewardedState, height, overlayHeight, width, fontScale, routeFocused, context.origin_interaction_id].join('|');
  useLayoutEffect(() => { measureEntries(); }, [layoutSignature, measureEntries]);
  useEffect(() => {
    const visible = windowState.current;
    visible.alive = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') startVisibleVisit(true);
      else { finishWait('background'); exposure.blur(); invalidateEntries(); }
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      visible.windowFocused = false;
      finishWait('window_blur'); invalidateEntries();
    }) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => {
      visible.windowFocused = true;
      startVisibleVisit(true, false);
    }) : null;
    return () => {
      visible.alive = false; visible.shown = false;
      finishWait('unmount'); exposure.blur(); invalidateEntries(); subscription.remove(); blur?.remove(); focus?.remove();
    };
  }, [exposure, finishWait, invalidateEntries, startVisibleVisit]);
  const select = useCallback((action: OptionAction, callback: OptionCallback) => {
    if (windowState.current.closed || selecting.current || !latest.current.availableActions.split(',').includes(action)) return;
    selecting.current = true;
    const interactionId = newMonetizationId('ni');
    exposure.blur(); invalidateEntries(); windowState.current.suspended = true;
    if (action === 'close') { windowState.current.closed = true; finishWait('close'); }
    try { track('no_coins_action', { ...latest.current.context, cost: latest.current.context.displayed_cost,
      available_actions: latest.current.availableActions, interaction_id: interactionId, action, outcome: 'selected' }); } catch { /* Keep the selected action available. */ }
    const settled = () => {
      selecting.current = false; windowState.current.suspended = false;
      if (windowState.current.alive && !windowState.current.closed) startVisibleVisit();
    };
    try { void Promise.resolve(callback(interactionId, modalId)).then(settled, settled); }
    catch (error) { settled(); throw error; }
  }, [exposure, finishWait, invalidateEntries, modalId, startVisibleVisit]);
  const close = useCallback(() => select('close', onClose), [onClose, select]);
  useEffect(() => {
    if (!routeFocused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!windowState.current.alive || !windowState.current.routeFocused) return false;
      close();
      return true;
    });
    return () => subscription.remove();
  }, [close, routeFocused]);
  const card = (
    <Pressable onPress={(event) => event.stopPropagation()} style={clarity ? { width: '100%' } : undefined}>
      <GlassPanel strong style={[styles.card, clarity && styles.clarityCard]}>
        <Icon name="bulb" size={48} color={colors.amber} />
        <AppText preset="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {clarity && canApply ? 'Монет хватает на помощь' : 'Нужна подсказка?'}
        </AppText>
        <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>
          {clarity
            ? `Для ${requestedHint === 'letter' ? 'буквы' : 'наводки'} нужно ${priceCoins} монет. У вас ${currentCoins}.${deficit > 0 ? ` Не хватает ${deficit}.` : ''}`
            : `Чтобы открыть ${hintName}, нужно ${priceCoins} монет. Сейчас у вас ${currentCoins}.`}
        </AppText>
        {errorMessage ? <AppText preset="body" accessibilityRole="alert" style={{ color: colors.cream, textAlign: 'center' }}>{errorMessage}</AppText> : null}
        <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 4 }}>
          {onRecoverReward ? <AppButton label="Повторить проверку награды" variant="glass" disabled={recoveryChecking}
            onPress={() => select('recover_reward', onRecoverReward)} /> : null}
          {clarity && canApply && onApplyHint ? (
            <AppButton label={priceCoins > 0 ? `Открыть ${hintName} → ${priceCoins} монет` : `Открыть ${hintName} бесплатно`}
              icon="bulb" variant="accent" disabled={busy} onPress={() => select('apply_hint', onApplyHint)} />
          ) : null}
          {(!clarity || deficit > 0) && (canWatchAd || clarity && rewardedEligible) ? (
            <View style={{ gap: 4 }}>
              <AppButton label={`Посмотреть рекламу → +${ECONOMY.rewardedCoins} монет`} icon="play" variant="accent"
                disabled={busy || !canWatchAd} onPress={() => select('rewarded', onWatchAd)} />
              {clarity ? <AppText preset="body" style={styles.detail}>
                {canWatchAd ? `Гарантированно +${ECONOMY.rewardedCoins} монет за просмотр видео` : rewardedStateMessage(rewardedState)}
              </AppText> : null}
            </View>
          ) : null}
          {clarity && deficit > 0 && canFreeSpin ? (
            <View style={{ gap: 4 }}>
              <View testID="no-coins-free-wheel-entry" collapsable={false}
                ref={(node) => { entryNodes.current.free_wheel = node; }} onLayout={measureEntries}>
                <AppButton label="Бесплатное вращение" icon="wheel" variant="glass" disabled={busy}
                  onPress={() => select('free_wheel', onFreeWheel ?? onWheel)} />
              </View>
              <AppText preset="body" style={styles.detail}>Без рекламы: случайный выигрыш {minReward}–{maxReward} монет</AppText>
            </View>
          ) : null}
          {!clarity || deficit > 0 ? (
            <View style={{ gap: 4 }}>
              <View testID="no-coins-wheel-entry" collapsable={false}
                ref={(node) => { entryNodes.current.wheel = node; }} onLayout={measureEntries}>
                <AppButton label={clarity ? wheelPending ? 'Забрать выигрыш колеса' : 'Колесо за видео' : 'Колесо монет'} icon="wheel" variant="glass"
                  disabled={busy || clarity && !wheelPending && wheelRewardedRemaining <= 0}
                  onPress={() => select('wheel', onWheel)} />
              </View>
              {clarity ? <AppText preset="body" style={styles.detail}>{wheelPending
                ? 'Выигрыш ожидает сохранения. Повторная реклама не нужна.'
                : wheelRewardedRemaining <= 0 ? 'На сегодня вращения за видео закончились.'
                : `Нужна реклама: случайный выигрыш ${minReward}–${maxReward} монет. Его может не хватить на помощь.`}</AppText> : null}
            </View>
          ) : null}
          {canShop && (!clarity || deficit > 0) ? <AppButton label="Магазин" icon="shop" variant="glass" disabled={busy} onPress={() => select('shop', onShop)} /> : null}
          <AppButton label={clarity ? 'Вернуться к слову' : 'Вернуться к игре'} variant="glass" onPress={close} />
        </View>
      </GlassPanel>
    </Pressable>
  );
  if (!routeFocused) return null;
  return (
    <View ref={overlayRoot} testID="no-coins-overlay" collapsable={false} style={styles.overlay}
      accessibilityViewIsModal importantForAccessibility="yes" onAccessibilityEscape={close} onLayout={onOverlayLayout}>
      <Pressable style={styles.scrim} onPress={close}>
        {clarity ? <ScrollView {...exposure.scrollProps} testID="no-coins-viewport"
          onLayout={(event) => { exposure.scrollProps.onLayout(event); measureEntries(); }} onContentSizeChange={measureEntries}
          style={{ maxHeight: Math.max(1, overlayHeight - 64), width: '100%', maxWidth: 420 }} contentContainerStyle={{ flexGrow: 1 }}>
          <View ref={contentRoot} testID="no-coins-content-root" collapsable={false} onLayout={measureEntries} style={{ width: '100%' }}>{card}</View>
        </ScrollView> : <View ref={contentRoot} testID="no-coins-content-root" collapsable={false} onLayout={measureEntries}>{card}</View>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 20, elevation: 20 },
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { alignItems: 'center', gap: 12, paddingVertical: 28, paddingHorizontal: 28, minWidth: 280 },
  clarityCard: { minWidth: 0, width: '100%', padding: 20 },
  detail: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
