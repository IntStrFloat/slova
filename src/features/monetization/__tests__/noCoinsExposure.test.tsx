/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AppState, BackHandler, Modal, Platform, StyleSheet } from 'react-native';

import { track, trackOnce } from '@/features/analytics';
import { validateEventProperties } from '@/features/analytics/schema';
import { NoCoinsModal } from '../NoCoinsModal';

jest.mock('@/features/analytics', () => ({ track: jest.fn(), trackOnce: jest.fn() }));
let mockAssignedVariant: 'control' | 'clarity' = 'clarity';
jest.mock('@/features/hints/help-experiment', () => ({
  useHelpExperimentState: () => 0, resolveHelpUxVariant: () => mockAssignedVariant, exposeHelpExperiment: jest.fn(),
}));
jest.mock('@/ui', () => ({
  ...require('@/ui/theme'), AppText: require('react-native').Text, GlassPanel: require('react-native').View,
  Icon: () => null,
  AppButton: (props: Record<string, unknown>) => require('react').createElement('Button', props),
}));

type Props = React.ComponentProps<typeof NoCoinsModal>;
type MeasuredNode = { measureLayout: (root: unknown, callback: (x: number, y: number, width: number, height: number) => void) => void;
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };
const nodes = new Map<string, MeasuredNode>();
const states = new Map<string, Set<(state?: string) => void>>();
const backHandlers = new Set<() => boolean | null | undefined>();
const measurements: (() => void)[] = [];
let deferMeasurements = false;
let controlWindowY = 0;
let wheelY = 700;
let tree: renderer.ReactTestRenderer | undefined;
const onWheel = jest.fn();
const onFree = jest.fn();
const onClose = jest.fn();
const defaultProps: Props = {
  priceCoins: 50, currentCoins: 20, requestedHint: 'letter', uxVariant: 'clarity', canWatchAd: false,
  rewardedState: 'loading', rewardedEligible: true, canFreeSpin: true, onWatchAd: jest.fn(), onWheel,
  onFreeWheel: onFree, onShop: jest.fn(), onClose, originInteractionId: 'origin:first', attemptId: 'attempt:original',
  helpContext: { levelKey: 'campaign:6', levelId: 6, mode: 'campaign', contentVersion: 'v1',
    content_fingerprint: 'fp_0123456789abcdef', entry_source: 'no_coins', interaction_id: 'request:first' },
};
function installMeasurements() {
  for (const id of ['no-coins-overlay', 'no-coins-content-root', 'no-coins-free-wheel-entry', 'no-coins-wheel-entry']) {
    const instance = tree!.root.findAllByProps({ testID: id })[0]?.instance as MeasuredNode | undefined;
    if (!instance) continue;
    instance.measureLayout = (root, callback) => {
      expect(root).toBe(nodes.get('no-coins-content-root'));
      const y = id === 'no-coins-free-wheel-entry' ? 50 : wheelY;
      const complete = () => callback(0, y, 300, 40);
      if (deferMeasurements) measurements.push(complete); else complete();
    };
    instance.measureInWindow = (callback) => id === 'no-coins-overlay'
      ? callback(0, 0, 360, 800) : callback(0, controlWindowY, 300, 1_200);
    nodes.set(id, instance);
  }
}
async function mount(props: Partial<Props> = {}) {
  mockAssignedVariant = props.uxVariant ?? 'clarity';
  await act(async () => { tree = renderer.create(<NoCoinsModal {...defaultProps} {...props} />); });
  installMeasurements();
}
function viewport() { return tree!.root.findByProps({ testID: 'no-coins-viewport' }); }
function layoutViewport(height = 200) { viewport().props.onLayout({ nativeEvent: { layout: { height } } }); }
function show(width = 360, height = 800) {
  tree!.root.findByProps({ testID: 'no-coins-overlay' }).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
}
function exposureCalls() { return jest.mocked(trackOnce).mock.calls.filter(([name]) => name === 'feature_exposed'); }
function advance(ms: number) { act(() => { jest.advanceTimersByTime(ms); }); }
function state(value: string) {
  nativeEvent('change', value);
}
function nativeEvent(event: string, value?: string) {
  act(() => {
    if (event === 'change') AppState.currentState = value as typeof AppState.currentState;
    for (const callback of states.get(event) ?? []) callback(value);
  });
}
function actualEvents() {
  return [...jest.mocked(track).mock.calls.map(([name, properties]) => ({ name, properties })),
    ...jest.mocked(trackOnce).mock.calls.map(([name, _key, properties]) => ({ name, properties }))];
}
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); AppState.currentState = 'active';
  jest.replaceProperty(Platform, 'OS', 'android');
  nodes.clear(); states.clear(); backHandlers.clear(); measurements.length = 0; deferMeasurements = false; controlWindowY = 0; wheelY = 700;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback: any) => {
    if (!states.has(event)) states.set(event, new Set());
    states.get(event)!.add(callback); return { remove: () => states.get(event)?.delete(callback) };
  });
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, callback) => {
    backHandlers.add(callback); return { remove: () => backHandlers.delete(callback) };
  });
});
afterEach(() => {
  if (tree) act(() => tree!.unmount()); tree = undefined;
  // Validate the component's actual emitted payloads against the production contract.
  // A permissive track mock alone cannot prove that the fields survive delivery.
  const failures = actualEvents().map(({ name, properties }) => ({ name, ...validateEventProperties(name, properties) }))
    .filter(({ valid, rejected }) => !valid || rejected !== 0);
  expect(failures).toEqual([]);
  jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers();
});

test('actual overlay layout and nested action bounds determine continuous dwell; below-fold wheel waits for scroll', async () => {
  await mount();
  act(() => { layoutViewport(); }); advance(2_000);
  expect(exposureCalls()).toHaveLength(0);
  act(show); advance(999); expect(exposureCalls()).toHaveLength(0);
  advance(1);
  expect(exposureCalls()).toHaveLength(1);
  expect(exposureCalls()[0][2]).toEqual(expect.objectContaining({ feature: 'wheel_entry', element_id: 'free_wheel',
    origin_interaction_id: 'origin:first', attemptId: 'attempt:original', levelKey: 'campaign:6', displayed_cost: 50,
    balance: 20, entry_source: 'no_coins', rewarded_state: 'loading', is_available: true,
    visibility_ms: 1_000, visible_fraction: 1, visibility_rule: 'half_1s_v2' }));
  act(() => { viewport().props.onScroll({ nativeEvent: { contentOffset: { y: 600 }, layoutMeasurement: { height: 200 } } }); });
  advance(999); expect(exposureCalls()).toHaveLength(1);
  advance(1); expect(exposureCalls()).toHaveLength(2);
  expect(exposureCalls()[1][2]).toEqual(expect.objectContaining({ element_id: 'wheel', is_available: true }));
});

test('background and route blur cancel dwell, and a hidden modal cannot publish readiness or exposure', async () => {
  wheelY = 100; await mount();
  act(() => { layoutViewport(); show(); }); advance(500);
  state('background'); advance(2_000); expect(exposureCalls()).toHaveLength(0);
  state('active'); advance(999); expect(exposureCalls()).toHaveLength(0);
  await act(async () => { tree!.update(<NoCoinsModal {...defaultProps} routeFocused={false} rewardedState="ready" />); });
  advance(2_000); expect(exposureCalls()).toHaveLength(0);
  const ready = jest.mocked(track).mock.calls.filter(([, props]) => props?.action === 'ready');
  expect(ready).toHaveLength(0);
  expect(tree!.root.findAllByProps({ testID: 'no-coins-overlay' })).toHaveLength(0);
});

test('control clipping uses the overlay window intersection and never counts a wheel above its visible screen', async () => {
  controlWindowY = -500; wheelY = 100;
  await mount({ uxVariant: 'control', canFreeSpin: false });
  act(show); advance(1_000); expect(exposureCalls()).toHaveLength(0);
  wheelY = 600;
  act(() => { tree!.root.findByProps({ testID: 'no-coins-wheel-entry' }).props.onLayout(); });
  advance(1_000);
  expect(exposureCalls()).toHaveLength(1);
  expect(exposureCalls()[0][2]).toEqual(expect.objectContaining({ element_id: 'wheel', visibility_rule: 'half_1s_v2' }));
});

test('stale async native layouts cannot restart an invalidated or hidden action dwell', async () => {
  deferMeasurements = true; wheelY = 100;
  await mount(); act(() => { layoutViewport(); show(); });
  const stale = measurements.splice(0);
  wheelY = 700;
  act(() => { tree!.root.findByProps({ testID: 'no-coins-wheel-entry' }).props.onLayout(); });
  act(() => { stale.forEach((complete) => complete()); });
  advance(1_000); expect(exposureCalls()).toHaveLength(0);
  act(() => { measurements.splice(0).forEach((complete) => complete()); });
  advance(1_000);
  expect(exposureCalls()).toHaveLength(1);
  expect(exposureCalls()[0][2]).toEqual(expect.objectContaining({ element_id: 'free_wheel' }));
});

test('blocked state is exposed separately and one action ID is shared by the fact and selected callback', async () => {
  wheelY = 100; await mount({ busy: true });
  act(() => { layoutViewport(); show(); }); advance(1_000);
  expect(exposureCalls()).toHaveLength(2);
  expect(exposureCalls().map(([, , props]) => [props?.is_available, props?.blocked_reason])).toEqual([[false, 'busy'], [false, 'busy']]);
  const shown = jest.mocked(trackOnce).mock.calls.find(([name]) => name === 'no_coins_shown')!;
  expect(shown[2]?.available_actions).toBe('close');
  await act(async () => { tree!.update(<NoCoinsModal {...defaultProps} />); });
  const button = tree!.root.findAll((node) => typeof node.type === 'string' && node.props.label === 'Колесо за видео')[0];
  await act(async () => { button.props.onPress(); button.props.onPress(); });
  const action = jest.mocked(track).mock.calls.find(([name, props]) => name === 'no_coins_action' && props?.action === 'wheel')!;
  expect(onWheel).toHaveBeenCalledTimes(1);
  expect(onWheel).toHaveBeenCalledWith(action[1]?.interaction_id, action[1]?.modal_id);
  expect(action[1]).toEqual(expect.objectContaining({ origin_interaction_id: 'origin:first', attemptId: 'attempt:original' }));
});

test('Android shade blur cancels dwell and readiness visits; focus cannot override a background app', async () => {
  wheelY = 100; await mount();
  act(() => { layoutViewport(); show(); }); advance(500);
  nativeEvent('blur'); advance(1_500); expect(exposureCalls()).toHaveLength(0);
  expect(actualEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'ui_action',
    properties: expect.objectContaining({ action: 'exit', outcome: 'window_blur', left_before_ready: true, wait_ms: 500 }) })]));
  await act(async () => { tree!.update(<NoCoinsModal {...defaultProps} rewardedState="ready" />); });
  expect(actualEvents().filter(({ properties }) => properties?.action === 'ready')).toHaveLength(0);
  state('background'); nativeEvent('focus'); advance(2_000); expect(exposureCalls()).toHaveLength(0);
  state('active'); advance(999); expect(exposureCalls()).toHaveLength(0);
  advance(1); expect(exposureCalls()).toHaveLength(2);
  nativeEvent('blur'); nativeEvent('focus'); advance(1_000);
  // Notification-shade focus does not reset the hook's seen entries in this same window.
  expect(exposureCalls()).toHaveLength(2);
});

test('real exposed, ready, exit, resume and modal payloads pass the production contract without rejected properties', async () => {
  wheelY = 100; await mount();
  act(() => { layoutViewport(); show(); }); advance(1_000);
  await act(async () => { tree!.update(<NoCoinsModal {...defaultProps} canWatchAd rewardedState="ready" />); });
  state('background'); state('active');
  await act(async () => {
    tree!.root.findAll((node) => typeof node.type === 'string' && node.props.label === 'Вернуться к слову')[0].props.onPress();
  });
  const events = actualEvents();
  expect(new Set(events.map(({ name }) => name))).toEqual(new Set(['feature_exposed', 'ui_action', 'no_coins_shown', 'no_coins_action']));
  expect(new Set(events.filter(({ name }) => name === 'ui_action').map(({ properties }) => properties?.action)))
    .toEqual(new Set(['ready', 'exit', 'resume']));
  for (const { name, properties } of events) {
    expect(validateEventProperties(name, properties)).toEqual({ properties, valid: true, rejected: 0, missing: [] });
    if (name === 'feature_exposed' || name === 'ui_action') {
      expect(properties).not.toHaveProperty('cost'); expect(properties).not.toHaveProperty('available_actions');
    } else {
      expect(properties).toHaveProperty('cost', 50); expect(properties).toHaveProperty('available_actions');
    }
  }
});

test('the help overlay uses the same Activity tree, with an accessible heading and no native Modal window', async () => {
  wheelY = 100; await mount({ canWatchAd: true, rewardedState: 'ready' });
  expect(tree!.root.findAllByType(Modal)).toHaveLength(0);
  const overlay = tree!.root.findByProps({ testID: 'no-coins-overlay' });
  expect(overlay.props.accessibilityViewIsModal).toBe(true);
  expect(overlay.props.importantForAccessibility).toBe('yes');
  expect(StyleSheet.flatten(overlay.props.style)).toEqual(expect.objectContaining({ position: 'absolute',
    top: 0, left: 0, bottom: 0, right: 0, zIndex: 20, elevation: 20 }));
  expect(tree!.root.findAllByProps({ accessibilityRole: 'header' }).length).toBeGreaterThan(0);
  act(() => { layoutViewport(); show(); }); advance(1_000);
  expect(exposureCalls()).toHaveLength(2);
  expect(actualEvents().find(({ name }) => name === 'no_coins_shown')?.properties)
    .toEqual(expect.objectContaining({ rewarded_state: 'ready', ready_at_entry: true }));
});

test('entry requires positive focused foreground layout, ignores repeated layout, and records one original shown fact', async () => {
  wheelY = 100; await mount();
  act(() => { layoutViewport(); show(0, 800); }); advance(1_000);
  expect(actualEvents()).toHaveLength(0);
  state('background'); act(show); advance(1_000);
  expect(actualEvents()).toHaveLength(0);
  nativeEvent('blur'); state('active'); advance(1_000); expect(actualEvents()).toHaveLength(0);
  nativeEvent('focus'); advance(500);
  act(show); advance(500);
  expect(exposureCalls()).toHaveLength(2);
  expect(actualEvents().filter(({ name }) => name === 'no_coins_shown')).toHaveLength(1);
  await act(async () => { tree!.update(<NoCoinsModal {...defaultProps} routeFocused={false} />); });
  expect(tree!.root.findAllByProps({ testID: 'no-coins-overlay' })).toHaveLength(0);
  await act(async () => { tree!.update(<NoCoinsModal {...defaultProps} />); }); installMeasurements();
  act(() => { layoutViewport(); }); advance(1_000);
  expect(actualEvents().filter(({ name }) => name === 'no_coins_shown')).toHaveLength(1);
  act(show); advance(1_000);
  expect(actualEvents().filter(({ name }) => name === 'no_coins_shown')).toHaveLength(1);
  expect(actualEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'ui_action',
    properties: expect.objectContaining({ action: 'resume' }) })]));
});

test('mount while already shade-blurred stays unshown until actual focus even if readiness later renders ready', async () => {
  wheelY = 100; await mount({ rewardedState: 'background' });
  act(() => { layoutViewport(); show(); }); advance(1_000);
  expect(actualEvents()).toHaveLength(0);
  await act(async () => { tree!.update(<NoCoinsModal {...defaultProps} rewardedState="ready" canWatchAd />); });
  advance(1_000); expect(actualEvents()).toHaveLength(0);
  nativeEvent('focus'); advance(999); expect(exposureCalls()).toHaveLength(0);
  advance(1); expect(exposureCalls()).toHaveLength(2);
  expect(actualEvents().filter(({ name }) => name === 'no_coins_shown')).toHaveLength(1);
});

test('hardware Back closes once while consumed by the overlay and unregisters on route blur', async () => {
  await mount(); act(show);
  expect(backHandlers.size).toBe(1);
  const back = [...backHandlers][0];
  await act(async () => { expect(back()).toBe(true); expect(back()).toBe(true); });
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => { expect(back()).toBe(true); });
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => { tree!.update(<NoCoinsModal {...defaultProps} routeFocused={false} />); });
  expect(backHandlers.size).toBe(0);
  expect(back()).toBe(false);
});
