/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { dayKey } from '@/core/time';
import { ECONOMY } from '@/core/config/economy';
import { KEYS, storage } from '@/core/storage';
import { useCurrency } from '@/features/currency';
import { useWheel } from '../index';
import type { RewardConfirmation, RewardedState } from '@/features/monetization/types';
import WheelScreen from '@/app/wheel';
import { readNativeEarnedRewards } from '@/features/monetization/nativeRewardJournal';
import { useRewardRecovery } from '@/features/monetization/rewardRecovery';
import { createHelpFlow, getHelpFlow, helpFlowProperties, useHelpFlows } from '@/features/hints/help-flow';
import { useGame } from '@/features/game/store';
import { clearGameSnapshot } from '@/features/game/persistence';
import { loadGlobalLevel } from '@/features/levels';
import { isAnalyticsCollectionEnabled, track, trackOnce } from '@/features/analytics';

let mockState: RewardedState = 'ready';
let mockFailure: RewardedState | null = null;
const mockRequest = jest.fn();
const mockBack = jest.fn();
let mockParams: { helpFlowId?: string; source?: string; entryInteractionId?: string; modalId?: string } = {};
let mockNavigationState = { index: 1, routes: [{ name: 'index' }, { name: 'wheel' }] };
const mockRouter = { canGoBack: jest.fn(() => false), back: jest.fn(), replace: jest.fn() };
const mockNavigation = { getState: () => mockNavigationState };
jest.mock('@/core/nav', () => ({ useGoBack: () => mockBack }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | void) => require('react').useEffect(effect, [effect]),
  useLocalSearchParams: () => mockParams, useRouter: () => mockRouter, useNavigation: () => mockNavigation,
}));
jest.mock('@/features/analytics', () => ({ track: jest.fn(), trackOnce: jest.fn(() => true), isAnalyticsCollectionEnabled: jest.fn(() => false) }));
// Explicit assignment fixture for these pre-existing economics/navigation scenarios.
jest.mock('@/features/hints/help-experiment', () => ({
  useHelpExperimentState: () => 0, exposeHelpExperiment: jest.fn(),
  resolveHelpUxVariant: (flow: { uxVariant?: string } | null) => flow?.uxVariant === 'clarity' ? 'clarity' : 'control',
}));
jest.mock('@/features/retention-ui/analytics', () => ({ trackRetentionAction: jest.fn() }));
jest.mock('@/features/monetization', () => ({
  getAds: () => ({ getRewardedState: () => mockState, getRewardedFailure: () => mockFailure ?? mockState }),
  requestRewarded: (...args: unknown[]) => mockRequest(...args), useRewardedState: () => mockState,
}));
jest.mock('@/features/monetization/nativeRewardJournal', () => ({
  acknowledgeNativeReward: jest.fn(async () => {}), readNativeEarnedRewards: jest.fn(async () => []),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('react-native-svg', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View, Circle: View, G: View, Line: View, Path: View, Polygon: View, Text: View };
});
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true, default: { View }, useReducedMotion: () => true,
    useSharedValue: (initial: number) => {
      const ref = React.useRef({ value: initial, get() { return this.value; }, set(value: number) { this.value = value; } });
      return ref.current;
    }, useAnimatedStyle: () => ({}), cancelAnimation: () => {}, Easing: { bezier: () => {} },
  };
});
jest.mock('@/ui', () => ({
  ...require('@/ui/theme'), AppText: require('react-native').Text, GlassPanel: require('react-native').View,
  Icon: () => null, CoinBadge: () => null, WorldBackground: () => null,
  AppButton: (props: Record<string, unknown>) => require('react').createElement('Button', props),
}));

let tree: renderer.ReactTestRenderer;
beforeEach(() => {
  jest.useFakeTimers();
  storage.clearAll(); useWheel.getState().reset();
  useHelpFlows.setState({ flows: {} });
  useRewardRecovery.setState({ checking: false, readFailed: false, pendingIds: [], revision: 0 });
  useWheel.setState({ day: dayKey(), freeUsed: true });
  useCurrency.setState({ coins: 0, gems: 0, appliedRewards: {}, analyticsTransactions: [], operationTransactions: {} });
  jest.mocked(isAnalyticsCollectionEnabled).mockReturnValue(false);
  mockState = 'ready'; mockFailure = null; mockRequest.mockReset(); mockBack.mockReset();
  jest.mocked(require('@/features/retention-ui/analytics').trackRetentionAction).mockClear();
  mockParams = {}; mockNavigationState = { index: 1, routes: [{ name: 'index' }, { name: 'wheel' }] };
  mockRouter.canGoBack.mockReset().mockReturnValue(false); mockRouter.back.mockReset(); mockRouter.replace.mockReset();
  jest.mocked(readNativeEarnedRewards).mockResolvedValue([]);
});
afterEach(async () => { if (tree) await act(async () => { tree.unmount(); }); jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers(); });
async function mount() { await act(async () => { tree = renderer.create(<WheelScreen />); }); }
function adButton() { return tree.root.findAll((node) => typeof node.type === 'string' && node.props.icon === 'play')[0]; }
function textContent() { return tree.root.findAllByType(Text).map((node) => String(node.props.children)).join(' '); }
function helpFlow(variant: 'clarity' | 'control' = 'clarity') {
  const level = loadGlobalLevel(6)!;
  useGame.getState().start(level, 'normal');
  useCurrency.setState({ coins: 20 });
  const snapshot = useGame.getState().snapshot!;
  const flow = createHelpFlow({ id: 'help:screen:origin', attemptId: snapshot.attemptId, levelKey: 'campaign:6', levelId: 6,
    mode: 'campaign', contentVersion: snapshot.contentVersion, requestedHint: 'letter', displayedCost: 50,
    balance: 20, entrySource: 'no_coins', previouslyCompleted: false, initialLetterHintCount: snapshot.hintsUsed.length, uxVariant: variant });
  mockParams = { helpFlowId: flow.id };
  return flow;
}

test('loading/no-fill/busy leave a visible explanation, disabled ad action, and working return', async () => {
  mockState = 'loading'; await mount();
  expect(adButton().props.disabled).toBe(true);
  expect(tree.root.findAllByType(Text).some((node) => String(node.props.children).includes('Реклама загружается'))).toBe(true);
  for (const state of ['no_fill', 'fullscreen_busy', 'background'] as const) {
    mockState = state;
    act(() => tree.update(<WheelScreen />));
    expect(adButton().props.disabled).toBe(true);
  }
  act(() => tree.root.findAll((node) => typeof node.type === 'string' && node.props.icon === 'back')[0].props.onPress());
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockRequest).not.toHaveBeenCalled();
});

test('two taps before React rerenders start one ad; earned callback persists before dismissal', async () => {
  let dismiss!: (value: string) => void;
  let confirmation!: RewardConfirmation;
  mockRequest.mockImplementation((_placement, actualConfirmation: RewardConfirmation) => {
    confirmation = actualConfirmation;
    return new Promise((resolve) => { dismiss = resolve; });
  });
  await mount();
  const press = adButton().props.onPress;
  act(() => { press(); press(); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(useWheel.getState().pendingSpin).toBeNull();
  act(() => {
    confirmation.persistGrant(confirmation.rewardId);
    confirmation.persistGrant(confirmation.rewardId);
  });
  expect(useWheel.getState().pendingSpin?.effectId).toBe(confirmation.rewardId);
  expect(useWheel.getState().rewardedUsed).toBe(1);
  await act(async () => { dismiss('rewarded'); });
  act(() => { jest.advanceTimersByTime(200); });
  expect(useCurrency.getState().hasApplied(confirmation.rewardId)).toBe(true);
  expect(useWheel.getState().rewardedUsed).toBe(1);
});

test('the first live earned callback clock survives duplicate callbacks and a delayed dismissal without mutating the native offer', async () => {
  let dismiss!: (value: string) => void;
  let confirmation!: RewardConfirmation;
  mockRequest.mockImplementation((_placement, value: RewardConfirmation) => {
    confirmation = value;
    return new Promise((resolve) => { dismiss = resolve; });
  });
  await mount();
  act(() => { adButton().props.onPress(); });
  const offerAtMs = confirmation.receipt!.createdAtMs;
  const callbackAtMs = offerAtMs + 2_000;
  jest.setSystemTime(callbackAtMs);
  act(() => { expect(confirmation.persistGrant(confirmation.rewardId)).toBe(true); });
  expect(useWheel.getState().pendingSpin?.createdAtMs).toBe(callbackAtMs);
  jest.setSystemTime(callbackAtMs + 3_000);
  act(() => { expect(confirmation.persistGrant(confirmation.rewardId)).toBe(true); });
  await act(async () => { dismiss('rewarded'); });
  expect(useWheel.getState().pendingSpin?.createdAtMs).toBe(callbackAtMs);
  expect(useWheel.getState().rewardedUsed).toBe(1);
  expect(confirmation.receipt!.createdAtMs).toBe(offerAtMs);
  expect(confirmation.receipt!.earnedAtMs).toBeUndefined();
  expect(trackOnce).toHaveBeenCalledWith('wheel_spin_started', confirmation.rewardId,
    expect.objectContaining({ occurredAtMs: callbackAtMs, timeKnown: true }));
});

test('a failed pending-spin write keeps the first callback clock when the live callback retries', async () => {
  let dismiss!: (value: string) => void;
  let confirmation!: RewardConfirmation;
  mockRequest.mockImplementation((_placement, value: RewardConfirmation) => {
    confirmation = value;
    return new Promise((resolve) => { dismiss = resolve; });
  });
  await mount();
  act(() => { adButton().props.onPress(); });
  let failPending = true;
  const write = storage.set.bind(storage);
  jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.wheel && failPending) { failPending = false; throw new Error('pending write failed'); }
    return write(key, value);
  });
  const callbackAtMs = confirmation.receipt!.createdAtMs + 1_500;
  jest.setSystemTime(callbackAtMs);
  act(() => { expect(() => confirmation.persistGrant(confirmation.rewardId)).toThrow('pending write failed'); });
  expect(useWheel.getState().pendingSpin).toBeNull();
  jest.setSystemTime(callbackAtMs + 4_000);
  act(() => { expect(confirmation.persistGrant(confirmation.rewardId)).toBe(true); });
  await act(async () => { dismiss('rewarded'); });
  expect(useWheel.getState().pendingSpin?.createdAtMs).toBe(callbackAtMs);
  expect(confirmation.receipt!.earnedAtMs).toBeUndefined();
  expect(useWheel.getState().rewardedUsed).toBe(1);
});

test('a provider result without the actual earned callback cannot invent a live callback timestamp', async () => {
  mockRequest.mockResolvedValue('rewarded');
  await mount();
  await act(async () => { await adButton().props.onPress(); });
  expect(useWheel.getState().pendingSpin?.createdAtMs).toBeUndefined();
  const started = jest.mocked(trackOnce).mock.calls.filter(([name, key]) => name === 'wheel_spin_started'
    && key === useWheel.getState().pendingSpin?.effectId).at(-1);
  expect(started?.[2]).toEqual(expect.objectContaining({ timeKnown: false }));
  expect(started?.[2]).not.toHaveProperty('occurredAtMs', expect.any(Number));
});

test('dismissed ad without earned callback does not spin or claim a reward', async () => {
  mockRequest.mockResolvedValue('dismissed'); await mount();
  await act(async () => { await adButton().props.onPress(); });
  expect(useWheel.getState().pendingSpin).toBeNull();
  expect(useWheel.getState().rewardedUsed).toBe(0);
  expect(useCurrency.getState().coins).toBe(0);
  expect(useWheel.getState().preparedReward).toBeNull();
});

test('pre-show preparation failure never promises an earned pending reward', async () => {
  mockFailure = 'offer_save_failed'; mockRequest.mockResolvedValue('unavailable'); await mount();
  await act(async () => { await adButton().props.onPress(); });
  const text = tree.root.findAllByType(Text).map((node) => String(node.props.children)).join(' ');
  expect(text).toContain('Награда ещё не заработана');
  expect(text).not.toContain('повторный просмотр не нужен');
  expect(useWheel.getState().rewardedUsed).toBe(0);
  expect(useWheel.getState().pendingSpin).toBeNull();
});

test('daily allowance exhaustion is explained even when another ad is ready', async () => {
  useWheel.setState({ rewardedUsed: 5 }); await mount();
  expect(adButton().props.disabled).toBe(true);
  expect(tree.root.findAllByType(Text).some((node) => String(node.props.children).includes('На сегодня все вращения'))).toBe(true);
});

test('a recovered reward does not hide another earned receipt whose wallet write is still pending', async () => {
  jest.mocked(readNativeEarnedRewards).mockResolvedValue([
    { version: 1, kind: 'wheel', rewardId: 'wheel:test:first', offerDay: dayKey(), createdAtMs: Date.now(), amount: 10,
      sector: ECONOMY.wheel.sectors.indexOf(10) },
    { version: 1, kind: 'coins', rewardId: 'rewarded-coins:test:second', offerDay: dayKey(), createdAtMs: Date.now(), amount: 60 },
  ]);
  const write = storage.set.bind(storage);
  jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.currency && String(value).includes('rewarded-coins:test:second')) throw new Error('wallet save failed');
    return write(key, value);
  });
  await mount();
  expect(useCurrency.getState().coins).toBe(10);
  expect(adButton().props.disabled).toBe(true);
  expect(tree.root.findAll((node) => typeof node.type === 'string' && node.props.label === 'Восстановить награду')).toHaveLength(1);
  expect(tree.root.findAllByType(Text).some((node) => String(node.props.children).includes('Награда ожидает сохранения'))).toBe(true);
});

test.each([10, 100])('confirmed %icoin result explains actual sufficiency and returns to the saved origin without buying help', async (amount) => {
  const flow = helpFlow();
  const rewardId = `wheel:test:result:${amount}`;
  useCurrency.getState().addOnce(rewardId, 'coins', amount);
  useWheel.setState({ lastGrantedSpin: { effectId: rewardId, value: amount,
    sector: ECONOMY.wheel.sectors.indexOf(amount as 10 | 100), flowContext: helpFlowProperties(flow) } });
  await mount();
  expect(textContent()).toContain('Монеты нужны для букв и наводок');
  expect(textContent()).toContain(amount === 10 ? 'До буквы не хватает ещё 20' : 'Теперь монет хватает на букву');
  expect(useCurrency.getState().coins).toBe(20 + amount);
  expect(useGame.getState().snapshot!.hintsUsed).toHaveLength(0);
  const originReturn = tree.root.findAll((node) => typeof node.type === 'string' && node.props.label === 'Вернуться к слову')[0];
  act(() => originReturn.props.onPress());
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/game', params: { helpFlowId: flow.id, source: 'help_return' } });
  expect(getHelpFlow(flow.id)?.status).toBe('returned');
  expect(useGame.getState().snapshot!.attemptId).toBe(flow.attemptId);
  expect(useGame.getState().snapshot!.hintsUsed).toHaveLength(0);
});

test('an uncommitted pending spin does not become available balance or a sufficient-win message', async () => {
  const flow = helpFlow();
  useCurrency.getState().addOnce('wheel:test:previous', 'coins', 10);
  useWheel.setState({ lastGrantedSpin: { effectId: 'wheel:test:previous', value: 10,
    sector: ECONOMY.wheel.sectors.indexOf(10), flowContext: helpFlowProperties(flow) },
    pendingSpin: { effectId: 'wheel:test:pending', value: 100,
    sector: ECONOMY.wheel.sectors.indexOf(100), flowContext: helpFlowProperties(flow) } });
  await mount();
  expect(useCurrency.getState().coins).toBe(30);
  expect(textContent()).toContain('Не хватает 20');
  expect(textContent()).not.toContain('Получено 10 монет');
  expect(textContent()).not.toContain('Теперь монет хватает');
});

test('return reuses the actual preceding Game route only for the same live origin attempt', async () => {
  const flow = helpFlow();
  mockNavigationState = { index: 1, routes: [{ name: 'game' }, { name: 'wheel' }] };
  mockRouter.canGoBack.mockReturnValue(true);
  await mount();
  act(() => {
    const press = tree.root.findAll((node) => typeof node.type === 'string' && node.props.icon === 'back')[0].props.onPress;
    press(); press();
  });
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(getHelpFlow(flow.id)?.status).toBe('returned');
});

test('changed attempt is explained and cannot be presented as a return to the original word', async () => {
  const flow = helpFlow();
  clearGameSnapshot('normal'); useGame.getState().start(loadGlobalLevel(6)!, 'normal');
  expect(useGame.getState().snapshot!.attemptId).not.toBe(flow.attemptId);
  await mount();
  expect(textContent()).toContain('Исходная попытка уже изменилась или завершена');
  const back = tree.root.findAll((node) => typeof node.type === 'string' && node.props.icon === 'back')[0];
  expect(back.props.label).toBe('К карте');
  act(() => back.props.onPress());
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
  expect(useCurrency.getState().coins).toBe(20);
});

test('control keeps the current explanation while retaining passive origin identity for measurement', async () => {
  helpFlow('control'); await mount();
  expect(textContent()).not.toContain('Монеты нужны для букв и наводок');
  expect(textContent()).not.toContain('Не хватает 30');
  expect(tree.root.findAll((node) => typeof node.type === 'string' && node.props.icon === 'back')[0].props.label).toBe('Карта');
});

test('optional return telemetry and status writes cannot trap a player whose original context is already durable', async () => {
  const flow = helpFlow(); await mount();
  const write = storage.set.bind(storage);
  jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.helpFlows) throw new Error('metadata unavailable');
    return write(key, value);
  });
  jest.mocked(track).mockImplementationOnce(() => { throw new Error('telemetry unavailable'); });
  act(() => tree.root.findAll((node) => typeof node.type === 'string' && node.props.icon === 'back')[0].props.onPress());
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/game', params: { helpFlowId: flow.id, source: 'help_return' } });
  expect(getHelpFlow(flow.id)?.attemptId).toBe(flow.attemptId);
  expect(useCurrency.getState().coins).toBe(20);
});

test('entry, spin action and committed wallet grant retain the origin while each tap gets its own ID', async () => {
  jest.mocked(isAnalyticsCollectionEnabled).mockReturnValue(true);
  const flow = helpFlow();
  mockParams = { helpFlowId: flow.id, source: 'no_coins', entryInteractionId: 'entry:tap', modalId: 'modal:source' };
  let confirmation!: RewardConfirmation;
  mockRequest.mockImplementation(async (_placement, value: RewardConfirmation, onObservation) => {
    onObservation({ opportunityId: 'ao:screen', requestId: 'ar:screen' });
    confirmation = value; value.persistGrant(value.rewardId); return 'rewarded';
  });
  const wallet = useCurrency.getState();
  const addOnce = jest.fn(wallet.addOnce);
  useCurrency.setState({ addOnce });
  try {
    await mount();
    expect(track).toHaveBeenCalledWith('wheel_opened', expect.objectContaining({ origin_interaction_id: flow.id,
      attemptId: flow.attemptId, interaction_id: 'entry:tap', modal_id: 'modal:source', entry_source: 'no_coins',
      displayed_cost: 50, balance: 20 }));
    await act(async () => { await adButton().props.onPress(); });
    const frozen = confirmation.receipt!.flowContext!;
    expect(frozen).toEqual(expect.objectContaining({ origin_interaction_id: flow.id, attemptId: flow.attemptId,
      modal_id: 'modal:source', entry_source: 'no_coins', displayed_cost: 50, balance: 20 }));
    expect(frozen.interaction_id).not.toBe('entry:tap');
    expect(require('@/features/retention-ui/analytics').trackRetentionAction).toHaveBeenCalledWith('wheel', 'rewarded_spin', frozen);
    await act(async () => { jest.advanceTimersByTime(200); });
    const receipt = confirmation.receipt!;
    expect(addOnce).toHaveBeenCalledWith(confirmation.rewardId, 'coins', receipt.amount, frozen);
    expect(useCurrency.getState().hasApplied(confirmation.rewardId)).toBe(true);
    const transaction = useCurrency.getState().getTransaction(confirmation.rewardId)!;
    expect(transaction).toEqual(expect.objectContaining({ rewardId: confirmation.rewardId, delta: receipt.amount,
      balanceBefore: 20, balanceAfter: 20 + receipt.amount }));
    expect(trackOnce).toHaveBeenCalledWith('ad_lifecycle', 'ar:screen:grant_persisted:0', expect.objectContaining({
      rewardId: confirmation.rewardId, transaction_id: transaction.id, occurredAtMs: transaction.occurredAtMs,
      timeKnown: true, origin_interaction_id: flow.id, interaction_id: frozen.interaction_id,
    }));
    expect(trackOnce).toHaveBeenCalledWith('wheel_spin_result', `${confirmation.rewardId}:granted`, expect.objectContaining({
      transaction_id: transaction.id, occurredAtMs: transaction.occurredAtMs, timeKnown: true, result_revision: 2,
    }));
  } finally { useCurrency.setState({ addOnce: wallet.addOnce }); }
});
