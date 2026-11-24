/* eslint-disable @typescript-eslint/no-require-imports */
import type { ReactTestRenderer } from 'react-test-renderer';

let mockFontsLoaded = false;
const mockReport = jest.fn<boolean, unknown[]>(() => true);
const mockRouter = { navigate: jest.fn() };

jest.mock('@expo-google-fonts/nunito', () => ({
  useFonts: () => [mockFontsLoaded],
  Nunito_600SemiBold: 'semibold', Nunito_700Bold: 'bold', Nunito_800ExtraBold: 'extra-bold',
}));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/', Stack: () => null }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => {}), hideAsync: jest.fn(async () => {}),
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: (...args: unknown[]) => mockReport(...args),
  isAppMetricaAvailable: () => true,
  isAppMetricaTestDevice: () => false,
}));
jest.mock('@/core/platform/yandexGames', () => ({
  isYandexGamesBuild: () => false, markYandexGameReady: async () => {},
}));
jest.mock('@/features/audio', () => ({ AudioRoot: () => null }));
jest.mock('@/features/monetization', () => ({ getAds: () => ({ init: async () => {} }) }));
jest.mock('@/features/monetization/subscription', () => ({
  useSubscription: { getState: () => ({ sync: async () => {} }) },
}));
jest.mock('@/features/monetization/subscriptionAutoSync', () => ({
  startSubscriptionAutoSync: () => () => {},
}));
jest.mock('@/features/profile', () => ({
  useProfile: { getState: () => ({ ensure: async () => true }), subscribe: () => () => {} },
}));
jest.mock('@/features/word-report', () => ({ flushWordReports: async () => {} }));
jest.mock('@/features/collection/store', () => ({ backfillUnlockedLandmarks: () => {} }));
jest.mock('@/features/progression/store', () => ({ backfillCompletedChestCoins: () => {} }));
jest.mock('@/features/retention', () => ({ reconcileRewards: () => {}, useRetention: { getState: () => ({}) } }));
jest.mock('@/features/marathon', () => ({ recoverMarathonProgress: () => {}, reconcileMarathonRewards: () => {} }));
jest.mock('@/features/notifications', () => ({
  PushNavigationRoot: () => null,
  getPush: () => ({ init: async () => {}, onNotificationTap: () => () => {} }),
  startDailyReminderTelemetry: () => () => {},
  startLevelExpansionAudienceSync: () => () => {},
  syncDailyReminders: async () => {},
}));
jest.mock('@/ui', () => ({ colors: { bgBottom: '#000' } }));

function bootstrapModules(legacy = false) {
  let modules!: {
    React: typeof import('react');
    renderer: typeof import('react-test-renderer');
    RootLayout: typeof import('../_layout').default;
    saved: typeof import('@/core/storage');
    onboarding: typeof import('@/features/onboarding');
    game: typeof import('@/features/game/store');
    persistence: typeof import('@/features/game/persistence');
    lifecycle: typeof import('@/features/analytics/puzzleLifecycle');
    useGameplayClock: typeof import('@/features/game/useGameplayClock').useGameplayClock;
  };
  // Seed real storage before the real stores decide whether this profile is new.
  // React and its renderer share this registry, so hooks use the same dispatcher.
  jest.isolateModules(() => {
    const saved = require('@/core/storage') as typeof import('@/core/storage');
    if (legacy) saved.storage.set(saved.KEYS.levelsProgress, JSON.stringify({
      world: 'world1', currentLevel: 4, completed: [1, 2, 3],
    }));
    modules = {
      React: require('react'), renderer: require('react-test-renderer'),
      saved, RootLayout: require('../_layout').default,
      onboarding: require('@/features/onboarding'),
      game: require('@/features/game/store'),
      persistence: require('@/features/game/persistence'),
      lifecycle: require('@/features/analytics/puzzleLifecycle'),
      useGameplayClock: require('@/features/game/useGameplayClock').useGameplayClock,
    };
  });
  return modules;
}

function reports(name: string) {
  return mockReport.mock.calls.filter((call) => call[0] === name);
}

const unmount: (() => void)[] = [];

beforeEach(() => {
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true, writable: true });
  mockFontsLoaded = false;
  mockReport.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true, writable: true });
  unmount.splice(0).forEach((dispose) => dispose());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('fresh bootstrap assigns the introduction before events even while fonts are loading', async () => {
  const { React, renderer, RootLayout, saved, onboarding } = bootstrapModules();
  let tree!: ReactTestRenderer;
  await renderer.act(async () => { tree = renderer.create(React.createElement(RootLayout)); });
  unmount.push(() => renderer.act(() => tree.unmount()));

  expect(tree.toJSON()).toBeNull();
  expect(saved.storage.getString(onboarding.INTRO_PACK_ASSIGNMENT_KEY)).toBe('intro-v2');
  expect(reports('first_open')).toHaveLength(1);
  expect(reports('onboarding_assigned')).toHaveLength(1);
  expect(reports('game_session_start')).toHaveLength(1);
  for (const [, envelope] of mockReport.mock.calls) {
    expect(envelope).toMatchObject({ onboarding_version: 'intro-v2', variant_id: 'intro-v2' });
  }
  expect(reports('onboarding_assigned')[0][1]).toMatchObject({
    schema_version: 3, onboardingVersion: 'intro-v2',
  });

  const firstEvents = mockReport.mock.calls.map(([name]) => name);
  mockFontsLoaded = true;
  await renderer.act(async () => { tree.update(React.createElement(RootLayout)); });
  expect(mockReport.mock.calls.map(([name]) => name).slice(0, firstEvents.length)).toEqual(firstEvents);
  expect(reports('screen_viewed')).toHaveLength(1);
  expect(reports('app_ready')).toHaveLength(1);
  expect(onboarding.getAssignedIntroVersion()).toBe('intro-v2');
});

test('bootstrap preserves an existing campaign profile and its legacy cohort', async () => {
  const { React, renderer, RootLayout, saved, onboarding } = bootstrapModules(true);
  const progress = saved.storage.getString(saved.KEYS.levelsProgress);
  let tree!: ReactTestRenderer;
  await renderer.act(async () => { tree = renderer.create(React.createElement(RootLayout)); });
  unmount.push(() => renderer.act(() => tree.unmount()));

  expect(tree.toJSON()).toBeNull();
  expect(onboarding.hasIntroPackAssignment()).toBe(false);
  expect(saved.storage.getString(onboarding.INTRO_PACK_ASSIGNMENT_KEY)).toBeUndefined();
  expect(saved.storage.getString(saved.KEYS.levelsProgress)).toBe(progress);
  expect(reports('first_open')).toHaveLength(0);
  expect(reports('onboarding_assigned')).toHaveLength(0);
  expect(reports('game_session_start')).toHaveLength(1);
  expect(reports('game_session_start')[0][1]).toMatchObject({
    onboarding_version: 'legacy', variant_id: 'released',
  });

  mockFontsLoaded = true;
  await renderer.act(async () => { tree.update(React.createElement(RootLayout)); });
  expect(reports('onboarding_assigned')).toHaveLength(0);
  expect(reports('game_session_start')).toHaveLength(1);
});

test('the real gameplay clock preserves the winning partial interval through save, restore and analytics', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-03T09:00:00.000Z'));
  const { React, renderer, saved, onboarding, game, persistence, lifecycle, useGameplayClock } = bootstrapModules();
  const level = onboarding.getIntroLevel(1)!;
  game.useGame.getState().start(level);
  const attemptId = game.useGame.getState().snapshot!.attemptId;
  let flush!: () => void;
  function Clock() {
    flush = useGameplayClock(true, attemptId);
    return null;
  }
  let tree!: ReactTestRenderer;
  renderer.act(() => { tree = renderer.create(React.createElement(Clock)); });
  unmount.push(() => renderer.act(() => tree.unmount()));

  renderer.act(() => {
    jest.advanceTimersByTime(1_250);
    flush();
    game.useGame.getState().submit('кот');
    jest.advanceTimersByTime(2_250);
    flush();
    game.useGame.getState().submit('ток');
  });
  const winning = game.useGame.getState().snapshot!;
  expect(winning.completion.status).toBe('completion_pending');
  expect(winning.activeTimeMs).toBe(3_500);
  expect(JSON.parse(saved.storage.getString(saved.KEYS.gameCurrentNormal)!)).toMatchObject({
    attemptId, activeTimeMs: 3_500, completion: { status: 'completion_pending' },
  });
  expect(persistence.loadGameSnapshot('normal', level)).toMatchObject({ activeTimeMs: 3_500 });
  lifecycle.trackPuzzleCompletion(level, winning, { introPlayer: true, assisted: false });

  renderer.act(() => { jest.advanceTimersByTime(10_000); });
  game.useGame.getState().start(level);
  const restored = game.useGame.getState().snapshot!;
  expect(restored).toMatchObject({ attemptId, activeTimeMs: 3_500 });
  lifecycle.trackPuzzleCompletion(level, restored, { introPlayer: true, assisted: false });
  expect(reports('puzzle_completed')).toHaveLength(1);
  expect(reports('puzzle_completed')[0][1]).toMatchObject({
    schema_version: 3, attemptId, activeTimeMs: 3_500, durationSec: 3.5, assisted: false,
  });
});
