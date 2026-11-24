/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { getFullscreenSnapshot, releaseFullscreen, tryAcquireFullscreen, type FullscreenLease } from '@/core/fullscreen';
import SdkQa from '../sdk-qa';
import type { CheckResult } from '../../../modules/rustore-updates';
import type { SoftwareBuildInfo } from '@/core/native/appmetrica';

const mockCapabilities = jest.fn((): { version: 1; enabled: boolean; localQa: boolean } | null =>
  ({ version: 1, enabled: true, localQa: true }));
const mockAvailable = jest.fn(() => true);
const mockActiveForm = jest.fn(() => false);
const mockPrepare = jest.fn(async (): Promise<'ready' | 'unavailable' | 'error'> => 'error');
const mockDiscard = jest.fn();
const mockNativeVersion = jest.fn((): unknown => 33);
let mockVersionBridge: { getNativeVersionCode?: () => unknown } | undefined;
const mockUpdatesSupported = jest.fn(() => true);
const mockUpdatesVersion = jest.fn((): string | null => '34');
const mockUpdatesCheck = jest.fn(async (): Promise<CheckResult> => ({ result: 'unavailable', reason: 'disabled' }));
const mockUpdatesStart = jest.fn();
const mockUpdatesComplete = jest.fn();
const mockUpdatesDiscard = jest.fn();
const mockSoftwareBuildInfo = jest.fn((): SoftwareBuildInfo | null => ({ versionName: '0.1.29', versionCode: '34' }));
const mockCollectionEnabled = jest.fn(() => false);
const mockHealthSummary = jest.fn();
const mockLoadProductPanel = jest.fn(async (): Promise<((props: { active: boolean }) => React.ReactNode) | null> => null);
const mockRouter = { replace: jest.fn() };
let mockAppState: string | null = 'active';
const mockListeners = new Map<string, Set<(state?: string) => void>>();
let mockRouteFocused = true;
const mockRouteListeners = new Set<() => void>();
const mockExposureWindowFocused = jest.fn(() => true);

jest.mock('@/core/native/appmetrica', () => ({
  getCrashReportingCapabilities: () => mockCapabilities(), getSoftwareBuildInfo: () => mockSoftwareBuildInfo(),
}));
jest.mock('@/features/analytics', () => ({
  isAnalyticsCollectionEnabled: () => mockCollectionEnabled(), trackAnalyticsHealthSummary: () => mockHealthSummary(),
}));
jest.mock('@/features/product-qa/entry', () => ({ loadProductQaPanel: () => mockLoadProductPanel() }));
jest.mock('@/features/retention-ui/viewportExposure', () => ({
  isExposureWindowFocused: () => mockExposureWindowFocused(),
}));
jest.mock('../../../modules/rustore-review', () => ({
  isAvailable: () => mockAvailable(), hasActiveForm: () => mockActiveForm(),
  prepareResult: () => mockPrepare(), discard: () => mockDiscard(), launch: jest.fn(),
}));
jest.mock('../../../modules/rustore-updates', () => ({
  isSupported: () => mockUpdatesSupported(), getNativeVersionCode: () => mockUpdatesVersion(),
  checkAvailability: () => mockUpdatesCheck(), startFlexible: (...args: unknown[]) => mockUpdatesStart(...args),
  completeFlexible: (...args: unknown[]) => mockUpdatesComplete(...args), discard: () => mockUpdatesDiscard(),
}));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    Redirect: (props: Record<string, unknown>) => React.createElement('Redirect', props),
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => (() => void)) => {
      const focused = React.useSyncExternalStore((listener: () => void) => {
        mockRouteListeners.add(listener);
        return () => mockRouteListeners.delete(listener);
      }, () => mockRouteFocused);
      React.useEffect(() => focused ? callback() : undefined, [callback, focused]);
    },
  };
});
jest.mock('react-native', () => {
  const React = require('react');
  return {
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
    TurboModuleRegistry: { get: () => null },
    NativeModules: { get RustorePush() { return mockVersionBridge; } },
    ScrollView: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('ScrollView', props, children),
    AppState: {
      get currentState() { return mockAppState; },
      addEventListener: (event: string, callback: (state?: string) => void) => {
        const listeners = mockListeners.get(event) ?? new Set();
        listeners.add(callback); mockListeners.set(event, listeners);
        return { remove: () => listeners.delete(callback) };
      },
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) }));
jest.mock('@/ui', () => {
  const React = require('react');
  return {
    AppButton: (props: Record<string, unknown>) => React.createElement('Button', props),
    AppText: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('Text', props, children),
    colors: { cream: '#FFF6D9', brown: '#56391F' },
  };
});

let tree: ReactTestRenderer | null = null;
let foreignLease: FullscreenLease | null = null;
const envBefore = process.env.EXPO_PUBLIC_LOCAL_SDK_QA;
function render() { act(() => { tree = TestRenderer.create(<SdkQa />); }); }
function status() { return tree!.root.findByProps({ testID: 'sdk-qa-status' }).props.children; }
function nativeVersionLabel() { return tree!.root.findByProps({ testID: 'sdk-qa-native-version-code' }).props.accessibilityLabel; }
function updatesVersionLabel() { return tree!.root.findByProps({ testID: 'sdk-qa-updates-version-code' }).props.accessibilityLabel; }
function updatesStatus() { return tree!.root.findByProps({ testID: 'sdk-qa-updates-status' }).props.accessibilityLabel; }
function press(label: string) { return tree!.root.findByProps({ label }).props.onPress(); }
function pressEnabled(label: string) {
  const button = tree!.root.findByProps({ label });
  expect(button.props.disabled).toBe(false);
  return button.props.onPress();
}
function routeFocus(focused: boolean) {
  act(() => { mockRouteFocused = focused; mockRouteListeners.forEach((listener) => listener()); });
}
function emit(event: string, state?: string) {
  if (event === 'change' && state) mockAppState = state;
  act(() => { mockListeners.get(event)?.forEach((listener) => listener(state)); });
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_LOCAL_SDK_QA = '1';
  mockAppState = 'active'; mockListeners.clear();
  mockRouteFocused = true; mockRouteListeners.clear();
  mockExposureWindowFocused.mockReset().mockReturnValue(true);
  mockCapabilities.mockReset().mockReturnValue({ version: 1, enabled: true, localQa: true });
  mockAvailable.mockReset().mockReturnValue(true);
  mockActiveForm.mockReset().mockReturnValue(false);
  mockPrepare.mockReset().mockResolvedValue('error');
  mockNativeVersion.mockReset().mockReturnValue(33);
  mockVersionBridge = { getNativeVersionCode: mockNativeVersion };
  mockUpdatesSupported.mockReset().mockReturnValue(true);
  mockUpdatesVersion.mockReset().mockReturnValue('34');
  mockUpdatesCheck.mockReset().mockResolvedValue({ result: 'unavailable', reason: 'disabled' });
  mockUpdatesStart.mockClear(); mockUpdatesComplete.mockClear(); mockUpdatesDiscard.mockClear();
  mockSoftwareBuildInfo.mockReset().mockReturnValue({ versionName: '0.1.29', versionCode: '34' });
  mockCollectionEnabled.mockReset().mockReturnValue(false);
  mockHealthSummary.mockReset();
  mockLoadProductPanel.mockReset().mockResolvedValue(null);
  mockDiscard.mockClear(); mockRouter.replace.mockClear();
});
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = null;
  if (foreignLease) releaseFullscreen(foreignLease);
  foreignLease = null;
  expect(getFullscreenSnapshot().owner).toBeNull();
  expect(mockUpdatesStart).not.toHaveBeenCalled();
  expect(mockUpdatesComplete).not.toHaveBeenCalled();
  expect(mockUpdatesDiscard).not.toHaveBeenCalled();
  jest.useRealTimers();
});
afterAll(() => {
  if (envBefore === undefined) delete process.env.EXPO_PUBLIC_LOCAL_SDK_QA;
  else process.env.EXPO_PUBLIC_LOCAL_SDK_QA = envBefore;
});

test.each([undefined, '0', 'true'])('normal build flag %s redirects without querying native or requesting Review', (flag) => {
  if (flag === undefined) delete process.env.EXPO_PUBLIC_LOCAL_SDK_QA;
  else process.env.EXPO_PUBLIC_LOCAL_SDK_QA = flag;
  render();
  expect(tree!.root.findByType('Redirect' as never).props.href).toBe('/');
  expect(mockCapabilities).not.toHaveBeenCalled();
  expect(mockAvailable).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockDiscard).not.toHaveBeenCalled();
  expect(mockNativeVersion).not.toHaveBeenCalled();
  expect(mockUpdatesSupported).not.toHaveBeenCalled();
  expect(mockUpdatesVersion).not.toHaveBeenCalled();
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
  expect(mockSoftwareBuildInfo).not.toHaveBeenCalled();
  expect(mockCollectionEnabled).not.toHaveBeenCalled();
  expect(mockHealthSummary).not.toHaveBeenCalled();
  expect(mockExposureWindowFocused).not.toHaveBeenCalled();
});

test.each([null, { version: 1 as const, enabled: true, localQa: false }])('public flag alone cannot authorize native Review actions (%j)', (capabilities) => {
  mockCapabilities.mockReturnValue(capabilities);
  render();
  expect(tree!.root.findByType('Redirect' as never).props.href).toBe('/');
  expect(mockAvailable).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockDiscard).not.toHaveBeenCalled();
  expect(mockNativeVersion).not.toHaveBeenCalled();
  expect(mockUpdatesSupported).not.toHaveBeenCalled();
  expect(mockUpdatesVersion).not.toHaveBeenCalled();
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
  expect(mockSoftwareBuildInfo).not.toHaveBeenCalled();
  expect(mockCollectionEnabled).not.toHaveBeenCalled();
  expect(mockHealthSummary).not.toHaveBeenCalled();
  expect(mockExposureWindowFocused).not.toHaveBeenCalled();
});

test('allowed mount has no Review SDK side effect; explicit inspect only reads pure getters', () => {
  render();
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  expect(status()).toBe('not_checked');
  expect(mockAvailable).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockNativeVersion).not.toHaveBeenCalled();
  act(() => press('Проверить Review bridge'));
  expect(status()).toBe('native_available');
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockDiscard).not.toHaveBeenCalled();
  expect(nativeVersionLabel()).toBe('SDK QA native_version_code: 33');
});

test('product QA code loads only after an explicit enabled action', async () => {
  const panel = jest.fn(() => null);
  mockLoadProductPanel.mockResolvedValue(panel);
  render();
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  expect(tree!.root.findByProps({ label: 'Открыть продуктовые QA сценарии' }).props.disabled).toBe(false);
  act(() => press('Открыть продуктовые QA сценарии'));
  await flush();
  expect(mockLoadProductPanel).toHaveBeenCalledTimes(1);
  expect(panel).toHaveBeenCalledWith(expect.objectContaining({ active: true }), undefined);
});

function staleFocusWhileRouteAway() {
  routeFocus(false);
  emit('blur');
  // Android window focus can precede the active AppState snapshot. The route
  // returning later must read current state even without another window event.
  mockAppState = 'background';
  emit('focus');
  mockAppState = 'active';
}

test('route refocus refreshes stale focused state with a live active app and focused window', async () => {
  const panel = jest.fn(() => null);
  mockLoadProductPanel.mockResolvedValue(panel);
  render();
  const mount = tree;
  expect(tree!.root.findByProps({ label: 'Открыть продуктовые QA сценарии' }).props.disabled).toBe(false);
  staleFocusWhileRouteAway();
  expect(tree!.root.findByProps({ label: 'Открыть продуктовые QA сценарии' }).props.disabled).toBe(true);
  routeFocus(true);
  expect(tree).toBe(mount); // Navigate away/back preserves the mounted QA screen.
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
  act(() => pressEnabled('Проверить отключённый Updates'));
  await flush();
  expect(updatesStatus()).toBe('SDK QA updates_status: unavailable:disabled');
  act(() => pressEnabled('Открыть продуктовые QA сценарии'));
  await flush();
  expect(mockUpdatesCheck).toHaveBeenCalledTimes(1);
  expect(mockLoadProductPanel).toHaveBeenCalledTimes(1);
  expect(panel).toHaveBeenCalledWith(expect.objectContaining({ active: true }), undefined);
});

test.each(['window_blurred', 'background'])('route refocus cannot authorize actions while %s', async (condition) => {
  render(); routeFocus(false); emit('blur');
  if (condition === 'background') { emit('change', 'background'); emit('focus'); }
  routeFocus(true);
  expect(tree!.root.findByProps({ label: 'Открыть продуктовые QA сценарии' }).props.disabled).toBe(true);
  expect(tree!.root.findByProps({ label: 'Проверить отключённый Updates' }).props.disabled).toBe(true);
  await flush();
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalled();
});

test.each(['public', 'native'])('route refocus keeps the %s QA action guard effective', async (guard) => {
  render(); staleFocusWhileRouteAway();
  if (guard === 'public') process.env.EXPO_PUBLIC_LOCAL_SDK_QA = '0';
  else mockCapabilities.mockReturnValue({ version: 1, enabled: true, localQa: false });
  routeFocus(true);
  act(() => pressEnabled('Открыть продуктовые QA сценарии'));
  act(() => pressEnabled('Проверить отключённый Updates'));
  await flush();
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
  expect(updatesStatus()).toBe('SDK QA updates_status: unavailable:qa_guard');
});

test('route refocus keeps active native forms and foreign fullscreen ownership protected', async () => {
  render(); staleFocusWhileRouteAway();
  foreignLease = tryAcquireFullscreen('checkout');
  routeFocus(true);
  act(() => pressEnabled('Подготовить Review'));
  await flush();
  expect(status()).toBe('fullscreen_busy');
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(getFullscreenSnapshot().owner).toBe('checkout');
  releaseFullscreen(foreignLease!); foreignLease = null;
  routeFocus(false); mockActiveForm.mockReturnValue(true); routeFocus(true);
  act(() => pressEnabled('Подготовить Review'));
  await flush();
  expect(status()).toBe('fullscreen_busy');
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockDiscard).not.toHaveBeenCalled();
});

function expectFocusControlsDisabled(disabled: boolean) {
  for (const label of ['Открыть продуктовые QA сценарии', 'Подготовить Review', 'Проверить отключённый Updates']) {
    expect(tree!.root.findByProps({ label }).props.disabled).toBe(disabled);
  }
}

test.each([null, 'unknown', 'inactive', 'background'])('cached focus initial %s becomes active without a replayed window event', async (initialState) => {
  mockAppState = initialState;
  render(); expectFocusControlsDisabled(true);
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
  emit('change', 'active');
  expectFocusControlsDisabled(false);
  act(() => pressEnabled('Подготовить Review')); await flush();
  act(() => pressEnabled('Проверить отключённый Updates')); await flush();
  act(() => pressEnabled('Открыть продуктовые QA сценарии')); await flush();
  expect(mockPrepare).toHaveBeenCalledTimes(1);
  expect(mockUpdatesCheck).toHaveBeenCalledTimes(1);
  expect(mockLoadProductPanel).toHaveBeenCalledTimes(1);
});

test('cached focus allows cold Game to deeplink QA with no local focus replay', async () => {
  mockRouteFocused = false; mockAppState = 'background';
  render(); expectFocusControlsDisabled(true);
  const mountedQa = tree;
  mockAppState = 'active'; // The resumed Activity snapshot precedes the QA route callback.
  routeFocus(true);
  expect(tree).toBe(mountedQa);
  expectFocusControlsDisabled(false);
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  act(() => pressEnabled('Открыть продуктовые QA сценарии')); await flush();
  expect(mockLoadProductPanel).toHaveBeenCalledTimes(1);
  expect(mockExposureWindowFocused).toHaveBeenCalled();
});

test('cached focus false blocks an active late mount until actual local window focus', async () => {
  mockExposureWindowFocused.mockReturnValue(false);
  render(); expectFocusControlsDisabled(true);
  routeFocus(false); routeFocus(true);
  expectFocusControlsDisabled(true);
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  emit('focus');
  expectFocusControlsDisabled(false);
  // The old shared snapshot cannot override the newer local focus observation.
  routeFocus(false); routeFocus(true);
  expectFocusControlsDisabled(false);
  act(() => pressEnabled('Подготовить Review')); await flush();
  expect(mockPrepare).toHaveBeenCalledTimes(1);
});

test('cached focus is refreshed on route entry only before a local window signal', async () => {
  mockExposureWindowFocused.mockReturnValue(false);
  render(); expectFocusControlsDisabled(true);
  routeFocus(false); mockExposureWindowFocused.mockReturnValue(true); routeFocus(true);
  expectFocusControlsDisabled(false);
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  act(() => pressEnabled('Открыть продуктовые QA сценарии')); await flush();
  expect(mockLoadProductPanel).toHaveBeenCalledTimes(1);
});

test('cached focus cannot erase a real local blur across route entry or active notification', async () => {
  render(); expectFocusControlsDisabled(false);
  emit('blur'); expectFocusControlsDisabled(true);
  routeFocus(false); emit('change', 'active'); routeFocus(true);
  expect(mockExposureWindowFocused()).toBe(true); // No shared observer remains to update this stale cache.
  expectFocusControlsDisabled(true);
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
  emit('focus'); expectFocusControlsDisabled(false);
  mockExposureWindowFocused.mockReturnValue(false);
  routeFocus(false); routeFocus(true);
  expectFocusControlsDisabled(false);
  act(() => pressEnabled('Открыть продуктовые QA сценарии')); await flush();
  expect(mockLoadProductPanel).toHaveBeenCalledTimes(1);
});

test.each([false, true])('cached focus background cancels pending work and retains actual blur=%s', async (actualBlur) => {
  let finishReview!: (value: 'ready') => void;
  let finishUpdates!: (value: CheckResult) => void;
  mockPrepare.mockImplementationOnce(() => new Promise((resolve) => { finishReview = resolve; }));
  mockUpdatesCheck.mockImplementationOnce(() => new Promise((resolve) => { finishUpdates = resolve; }));
  render();
  act(() => { pressEnabled('Подготовить Review'); pressEnabled('Проверить отключённый Updates'); });
  expect(getFullscreenSnapshot().owner).toBe('review');
  emit('change', 'background');
  if (actualBlur) emit('blur');
  expectFocusControlsDisabled(true);
  expect(status()).toBe('prepare_cancelled');
  expect(updatesStatus()).toBe('SDK QA updates_status: cancelled:inactive');
  expect(getFullscreenSnapshot().owner).toBeNull();
  expect(mockDiscard).toHaveBeenCalledTimes(1);
  routeFocus(false); routeFocus(true);
  expectFocusControlsDisabled(true);
  await act(async () => { finishReview('ready'); finishUpdates({ result: 'unavailable', reason: 'disabled' }); await Promise.resolve(); });
  expect(status()).toBe('prepare_cancelled');
  expect(updatesStatus()).toBe('SDK QA updates_status: cancelled:inactive');
  emit('change', 'active');
  expectFocusControlsDisabled(actualBlur);
  if (actualBlur) emit('focus');
  expectFocusControlsDisabled(false);
  act(() => pressEnabled('Подготовить Review')); await flush();
  expect(mockPrepare).toHaveBeenCalledTimes(2);
  expect(mockLoadProductPanel).not.toHaveBeenCalled();
});

test('revoked QA authorization during product loading does not mount the panel', async () => {
  let finish!: (panel: () => null) => void;
  mockLoadProductPanel.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render();
  act(() => press('Открыть продуктовые QA сценарии'));
  mockCapabilities.mockReturnValue(null);
  const panel = jest.fn(() => null);
  await act(async () => finish(panel));
  expect(panel).not.toHaveBeenCalled();
});

test.each([33, 34])('explicit inspect displays actual native binary version %d', (version) => {
  mockNativeVersion.mockReturnValue(version);
  render();
  expect(nativeVersionLabel()).toBe('SDK QA native_version_code: not_checked');
  expect(mockNativeVersion).not.toHaveBeenCalled();
  act(() => press('Проверить Review bridge'));
  expect(nativeVersionLabel()).toBe(`SDK QA native_version_code: ${version}`);
  expect(mockPrepare).not.toHaveBeenCalled();
});

test.each([undefined, {}])('old or missing native version bridge fails closed (%j)', (bridge) => {
  mockVersionBridge = bridge;
  render(); act(() => press('Проверить Review bridge'));
  expect(nativeVersionLabel()).toBe('SDK QA native_version_code: 0');
  expect(mockPrepare).not.toHaveBeenCalled();
});

test.each([0, -1, 3.3, Number.NaN, Number.POSITIVE_INFINITY, 2_100_000_001, '34', null])('native version %j is not accepted as an installed build', (value) => {
  mockNativeVersion.mockReturnValue(value);
  render(); act(() => press('Проверить Review bridge'));
  expect(nativeVersionLabel()).toBe('SDK QA native_version_code: 0');
});

test('throwing native version getter is contained as unknown version', () => {
  mockNativeVersion.mockImplementation(() => { throw new Error('untrusted native error'); });
  render(); act(() => press('Проверить Review bridge'));
  expect(nativeVersionLabel()).toBe('SDK QA native_version_code: 0');
  expect(status()).toBe('native_available');
});

test('explicit preparation records a bounded error, discards and releases its own lease', async () => {
  render();
  act(() => press('Подготовить Review'));
  expect(getFullscreenSnapshot().owner).toBe('review');
  await flush();
  expect(status()).toBe('prepare_error');
  expect(mockPrepare).toHaveBeenCalledTimes(1);
  expect(mockDiscard).toHaveBeenCalledTimes(1);
  expect(getFullscreenSnapshot().owner).toBeNull();
});

test('ready preparation is discarded without showing a form or reserving policy', async () => {
  const bridge = require('../../../modules/rustore-review');
  mockPrepare.mockResolvedValue('ready');
  render();
  act(() => press('Подготовить Review'));
  await flush();
  expect(status()).toBe('prepare_ready');
  expect(mockDiscard).toHaveBeenCalledTimes(1);
  expect(bridge.launch).not.toHaveBeenCalled();
});

test('public actions recheck the native QA guard after rendering', async () => {
  render();
  mockCapabilities.mockReturnValue(null);
  act(() => press('Проверить Review bridge'));
  expect(mockNativeVersion).not.toHaveBeenCalled();
  act(() => press('Подготовить Review'));
  await flush();
  expect(status()).toBe('qa_unavailable');
  act(() => press('Сбросить подготовку'));
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(mockDiscard).not.toHaveBeenCalled();
});

test('another fullscreen owner or an old native Review form prevents preparation and discard', async () => {
  render();
  foreignLease = tryAcquireFullscreen('checkout');
  act(() => press('Подготовить Review'));
  act(() => press('Сбросить подготовку'));
  await flush();
  expect(status()).toBe('fullscreen_busy');
  expect(mockPrepare).not.toHaveBeenCalled(); expect(mockDiscard).not.toHaveBeenCalled();
  expect(getFullscreenSnapshot().owner).toBe('checkout');
  releaseFullscreen(foreignLease!); foreignLease = null;
  mockActiveForm.mockReturnValue(true);
  act(() => press('Подготовить Review'));
  act(() => press('Сбросить подготовку'));
  await flush();
  expect(mockPrepare).not.toHaveBeenCalled(); expect(mockDiscard).not.toHaveBeenCalled();
});

test('double press starts one request; timeout releases, then a late callback cannot affect a new request', async () => {
  let first!: (value: 'ready') => void;
  let second!: (value: 'error') => void;
  mockPrepare.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
  render();
  act(() => { press('Подготовить Review'); press('Подготовить Review'); });
  expect(mockPrepare).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(1500); });
  expect(status()).toBe('prepare_timeout');
  expect(getFullscreenSnapshot().owner).toBeNull();
  act(() => press('Подготовить Review'));
  await act(async () => { first('ready'); await Promise.resolve(); });
  expect(status()).toBe('prepare_pending');
  expect(getFullscreenSnapshot().owner).toBe('review');
  await act(async () => { second('error'); await Promise.resolve(); });
  expect(status()).toBe('prepare_error');
});

test.each(['blur', 'change'])('focus loss %s invalidates pending preparation and prevents stale callbacks', async (event) => {
  let resolve!: (value: 'ready') => void;
  mockPrepare.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(); act(() => press('Подготовить Review'));
  emit(event, event === 'change' ? 'background' : undefined);
  expect(status()).toBe('prepare_cancelled');
  expect(getFullscreenSnapshot().owner).toBeNull();
  await act(async () => { resolve('ready'); await Promise.resolve(); });
  expect(status()).toBe('prepare_cancelled');
  act(() => press('Подготовить Review'));
  expect(status()).toBe('not_focused');
  expect(mockPrepare).toHaveBeenCalledTimes(1);
});

test('unmount discards a pending request and late completion cannot retain ownership', async () => {
  let resolve!: (value: 'ready') => void;
  mockPrepare.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(); act(() => press('Подготовить Review'));
  act(() => tree!.unmount()); tree = null;
  expect(mockDiscard).toHaveBeenCalledTimes(1);
  expect(getFullscreenSnapshot().owner).toBeNull();
  await act(async () => { resolve('ready'); await Promise.resolve(); });
  expect(mockDiscard).toHaveBeenCalledTimes(1);
});

test('Updates SDK remains untouched at mount; explicit inspect reads only supported and actual version getters', () => {
  render();
  expect(updatesStatus()).toBe('SDK QA updates_status: not_checked');
  expect(updatesVersionLabel()).toBe('SDK QA updates_version_code: not_checked');
  expect(mockUpdatesSupported).not.toHaveBeenCalled();
  expect(mockUpdatesVersion).not.toHaveBeenCalled();
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
  act(() => press('Проверить Updates bridge'));
  expect(updatesStatus()).toBe('SDK QA updates_status: bridge_supported');
  expect(updatesVersionLabel()).toBe('SDK QA updates_version_code: 34');
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
});

test.each(['33', '34', null])('Updates inspect exposes only the actual native version or unknown (%j)', (version) => {
  mockUpdatesVersion.mockReturnValue(version);
  render(); act(() => press('Проверить Updates bridge'));
  expect(updatesVersionLabel()).toBe(`SDK QA updates_version_code: ${version ?? '0'}`);
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
});

test('unsupported Updates bridge fails closed without native availability request', async () => {
  mockUpdatesSupported.mockReturnValue(false);
  mockUpdatesVersion.mockReturnValue(null);
  render();
  act(() => press('Проверить Updates bridge'));
  expect(updatesVersionLabel()).toBe('SDK QA updates_version_code: 0');
  act(() => press('Проверить отключённый Updates'));
  await flush();
  expect(updatesStatus()).toBe('SDK QA updates_status: unavailable:native_unavailable');
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
});

test('Updates actions recheck the actual native QA guard after mount', async () => {
  render(); mockCapabilities.mockReturnValue({ version: 1, enabled: true, localQa: false });
  act(() => press('Проверить Updates bridge'));
  act(() => press('Проверить отключённый Updates'));
  await flush();
  expect(updatesStatus()).toBe('SDK QA updates_status: unavailable:qa_guard');
  expect(mockUpdatesSupported).not.toHaveBeenCalled();
  expect(mockUpdatesVersion).not.toHaveBeenCalled();
  expect(mockUpdatesCheck).not.toHaveBeenCalled();
});

test('explicit disabled check displays the typed disabled callback without a fullscreen owner or installer', async () => {
  render(); act(() => press('Проверить отключённый Updates'));
  expect(updatesStatus()).toBe('SDK QA updates_status: pending');
  expect(getFullscreenSnapshot().owner).toBeNull();
  await flush();
  expect(mockUpdatesCheck).toHaveBeenCalledTimes(1);
  expect(updatesStatus()).toBe('SDK QA updates_status: unavailable:disabled');
});

test('an unexpected available result is marked explicitly and never starts a flow', async () => {
  mockUpdatesCheck.mockResolvedValue({ result: 'available', installedVersionCode: '34', versionCode: '35',
    state: 'pending', infoToken: 'private_token_not_for_ui' });
  render(); act(() => press('Проверить отключённый Updates')); await flush();
  expect(updatesStatus()).toBe('SDK QA updates_status: available:unexpected_qa_result');
  expect(JSON.stringify(tree!.toJSON())).not.toContain('private_token_not_for_ui');
});

test('unknown failure reasons and thrown errors never render raw messages', async () => {
  mockUpdatesCheck.mockResolvedValueOnce({ result: 'terminal_error', reason: 'private_error_payload' })
    .mockRejectedValueOnce(new Error('private_exception_message'));
  render(); act(() => press('Проверить отключённый Updates')); await flush();
  expect(updatesStatus()).toBe('SDK QA updates_status: terminal_error:unknown_error');
  act(() => press('Проверить отключённый Updates')); await flush();
  expect(updatesStatus()).toBe('SDK QA updates_status: unknown:check_error');
  expect(JSON.stringify(tree!.toJSON())).not.toContain('private_');
});

test('duplicate disabled check starts once; timeout and old completion cannot replace a newer result', async () => {
  let first!: (result: CheckResult) => void;
  let second!: (result: CheckResult) => void;
  mockUpdatesCheck.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
  render(); act(() => { press('Проверить отключённый Updates'); press('Проверить отключённый Updates'); });
  expect(mockUpdatesCheck).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(1500); });
  expect(updatesStatus()).toBe('SDK QA updates_status: unknown:timeout');
  act(() => press('Проверить отключённый Updates'));
  await act(async () => { first({ result: 'unavailable', reason: 'busy' }); await Promise.resolve(); });
  expect(updatesStatus()).toBe('SDK QA updates_status: pending');
  await act(async () => { second({ result: 'unavailable', reason: 'disabled' }); await Promise.resolve(); });
  expect(updatesStatus()).toBe('SDK QA updates_status: unavailable:disabled');
});

test.each(['blur', 'change'])('Updates check ignores stale callbacks after %s and refuses another request while inactive', async (event) => {
  let resolve!: (result: CheckResult) => void;
  mockUpdatesCheck.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(); act(() => press('Проверить отключённый Updates'));
  emit(event, event === 'change' ? 'background' : undefined);
  expect(updatesStatus()).toBe('SDK QA updates_status: cancelled:inactive');
  await act(async () => { resolve({ result: 'unavailable', reason: 'disabled' }); await Promise.resolve(); });
  expect(updatesStatus()).toBe('SDK QA updates_status: cancelled:inactive');
  act(() => press('Проверить отключённый Updates'));
  expect(updatesStatus()).toBe('SDK QA updates_status: unavailable:not_focused');
  expect(mockUpdatesCheck).toHaveBeenCalledTimes(1);
});

test('unmounted Updates check ignores late callbacks and keeps the shared owner unchanged', async () => {
  let resolve!: (result: CheckResult) => void;
  mockUpdatesCheck.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(); act(() => press('Проверить отключённый Updates'));
  act(() => tree!.unmount()); tree = null;
  await act(async () => { resolve({ result: 'unavailable', reason: 'disabled' }); await Promise.resolve(); });
  act(() => { jest.advanceTimersByTime(1500); });
  expect(getFullscreenSnapshot().owner).toBeNull();
  expect(mockUpdatesCheck).toHaveBeenCalledTimes(1);
});

test('analytics metadata and health summary are untouched until the explicit guarded button', () => {
  render();
  expect(tree!.root.findByProps({ testID: 'sdk-qa-analytics-build' }).props.accessibilityLabel)
    .toBe('SDK QA analytics_build: not_checked');
  expect(mockSoftwareBuildInfo).not.toHaveBeenCalled();
  expect(mockHealthSummary).not.toHaveBeenCalled();
  act(() => press('Проверить метаданные аналитики'));
  expect(tree!.root.findByProps({ testID: 'sdk-qa-analytics-build' }).props.accessibilityLabel)
    .toBe('SDK QA analytics_build: 34');
  expect(tree!.root.findByProps({ testID: 'sdk-qa-analytics-version-name' }).props.accessibilityLabel)
    .toBe('SDK QA analytics_version_name: 0.1.29');
  expect(tree!.root.findByProps({ testID: 'sdk-qa-collection-enabled' }).props.accessibilityLabel)
    .toBe('SDK QA collection_enabled: false');
  expect(tree!.root.findByProps({ testID: 'sdk-qa-analytics-status' }).props.accessibilityLabel)
    .toBe('SDK QA analytics_status: health_summary_requested');
  expect(mockHealthSummary).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(tree!.toJSON())).not.toMatch(/queued|delivered|отправлено/);
});

test('old analytics bridge metadata stays unknown without borrowing Push or Updates version', () => {
  mockSoftwareBuildInfo.mockReturnValue(null);
  render(); act(() => press('Проверить метаданные аналитики'));
  expect(tree!.root.findByProps({ testID: 'sdk-qa-analytics-build' }).props.accessibilityLabel)
    .toBe('SDK QA analytics_build: unknown');
  expect(tree!.root.findByProps({ testID: 'sdk-qa-analytics-version-name' }).props.accessibilityLabel)
    .toBe('SDK QA analytics_version_name: unknown');
  expect(mockNativeVersion).not.toHaveBeenCalled();
  expect(mockUpdatesVersion).not.toHaveBeenCalled();
});

test('analytics action rechecks the actual native QA guard before any metadata or collection request', () => {
  render(); mockCapabilities.mockReturnValue(null);
  act(() => press('Проверить метаданные аналитики'));
  expect(tree!.root.findByProps({ testID: 'sdk-qa-analytics-status' }).props.accessibilityLabel)
    .toBe('SDK QA analytics_status: qa_unavailable');
  expect(mockSoftwareBuildInfo).not.toHaveBeenCalled();
  expect(mockCollectionEnabled).not.toHaveBeenCalled();
  expect(mockHealthSummary).not.toHaveBeenCalled();
});

test('read-only collection status can be true without claiming the existing void request enqueued anything', () => {
  mockCollectionEnabled.mockReturnValue(true);
  render(); act(() => press('Проверить метаданные аналитики'));
  expect(tree!.root.findByProps({ testID: 'sdk-qa-collection-enabled' }).props.accessibilityLabel)
    .toBe('SDK QA collection_enabled: true');
  expect(mockHealthSummary).toHaveBeenCalledTimes(1);
  expect(tree!.root.findByProps({ testID: 'sdk-qa-analytics-status' }).props.accessibilityLabel)
    .toBe('SDK QA analytics_status: health_summary_requested');
});
