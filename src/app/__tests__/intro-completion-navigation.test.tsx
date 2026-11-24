/* eslint-disable @typescript-eslint/no-require-imports */
import type { ReactTestRenderer } from 'react-test-renderer';
import { minimumLetterDiskSize } from '@/features/game/layout';
import type { InterstitialResult } from '@/features/monetization/types';

type DiskProps = { letters: string[]; onWord: (word: string) => string; demoLoop?: boolean; size: number };
type ResultProps = {
  introComplete: boolean;
  rewardPending: boolean;
  heroCaption?: string;
  heroImage?: number;
  onNext: () => Promise<boolean>;
  onDaily?: () => Promise<boolean>;
};
type PromptProps = { plan: { amount: string; periodDays: number } | null;
  onShown: () => void; onLater: () => void; onSubscribe: () => void };
let mockPromptProps: PromptProps | null = null;
let mockDiskProps: DiskProps | null = null;
let mockResultProps: ResultProps | null = null;
const mockReport = jest.fn<boolean, unknown[]>(() => true);
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false };
const mockParams = { mode: 'normal' };
const mockReview = jest.fn<Promise<string>, unknown[]>(async () => 'skipped');
const mockInterstitialReady = jest.fn(() => false);
const mockShowInterstitial = jest.fn<Promise<InterstitialResult>, unknown[]>(async () => 'shown');
const mockAppStateListeners = new Set<(state: string) => void>();
let mockCurrentAppState = 'active';

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => function Host({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
    return React.createElement(name, props, children);
  };
  return {
    View: host('View'), ScrollView: host('ScrollView'), Pressable: host('Pressable'),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    AppState: { get currentState() { return mockCurrentAppState; },
      addEventListener: (_event: string, listener: (state: string) => void) => {
        mockAppStateListeners.add(listener);
        return { remove: () => mockAppStateListeners.delete(listener) };
      } },
    BackHandler: { addEventListener: () => ({ remove: () => {} }) },
    useWindowDimensions: () => ({ width: 360, height: 740, fontScale: 1, scale: 1 }),
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
    TurboModuleRegistry: { get: () => null },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const fade = { duration: () => fade };
  return {
    __esModule: true,
    default: { View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement('AnimatedView', props, children) },
    FadeIn: fade, FadeOut: fade, cancelAnimation: () => {}, useReducedMotion: () => true,
    useAnimatedStyle: (callback: () => unknown) => callback(),
    useSharedValue: (initial: unknown) => {
      let value = initial;
      return { get: () => value, set: (next: unknown) => { value = next; } };
    },
    withSpring: (value: unknown) => value,
  };
});
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});
jest.mock('expo-haptics', () => ({
  notificationAsync: async () => {}, impactAsync: async () => {},
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
jest.mock('../../../modules/rustore-review', () => ({ hasActiveForm: () => false }));
jest.mock('../../../modules/rustore-updates', () => ({ updatesGateway: {
  isSupported: () => false, getNativeVersionCode: () => null,
  checkAvailability: async () => ({ result: 'unavailable', reason: 'native_unavailable' }),
  startFlexible: async () => ({ result: 'unavailable', reason: 'native_unavailable' }),
  completeFlexible: async () => ({ result: 'unavailable', reason: 'native_unavailable' }),
  discard: () => {}, subscribe: () => () => {},
} }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: (...args: unknown[]) => mockReport(...args), isAppMetricaAvailable: () => true,
  isAppMetricaTestDevice: () => false, setDataSendingEnabled: () => true,
  getDataSendingPreference: () => null,
}));
jest.mock('@/core/platform/yandexGames', () => ({ setYandexGameplayActive: () => {}, isYandexGamesBuild: () => false }));
jest.mock('@/features/audio', () => ({ playSfx: () => {} }));
jest.mock('@/features/leaderboard', () => ({
  useLeaderboard: { getState: () => ({ syncProgress: async () => {} }) },
}));
jest.mock('@/features/review', () => ({ requestCampaignReview: (...args: unknown[]) => mockReview(...args) }));
jest.mock('@/features/notifications', () => ({
  trackReminderGameplay: () => {}, cancelDailyReminderForDate: async () => {}, syncDailyReminders: async () => {},
}));
jest.mock('@/features/monetization/providers', () => ({
  getAds: () => ({
    isInterstitialReady: () => mockInterstitialReady(), isRewardedReady: () => false,
    showInterstitial: (...args: unknown[]) => mockShowInterstitial(...args),
  }),
}));
jest.mock('@/features/monetization/rewarded', () => ({
  isRewardedReady: () => false, requestRewarded: async () => 'unavailable',
}));
jest.mock('@/features/monetization/AdBanner', () => ({
  AdBanner: () => require('react').createElement('AdBanner', { testID: 'mock-ad-banner' }),
}));
jest.mock('@/features/monetization/NoCoinsModal', () => ({ NoCoinsModal: () => null }));
jest.mock('@/features/monetization/PostAdSubscriptionOffer', () => ({
  PostAdSubscriptionOffer: (props: PromptProps) => { mockPromptProps = props; return null; },
}));
jest.mock('@/features/collection', () => ({ useCollection: require('@/features/collection/store').useCollection }));
jest.mock('@/features/game', () => {
  const React = require('react');
  return {
    useGame: require('@/features/game/store').useGame,
    CrosswordGrid: () => null, LevelObjective: () => null,
    LetterDisk: (props: DiskProps) => { mockDiskProps = props; return React.createElement('LetterDisk', { ...props, testID: 'mock-letter-disk' }); },
    LevelComplete: (props: ResultProps) => { mockResultProps = props; return React.createElement('LevelComplete', props); },
  };
});
jest.mock('@/ui', () => {
  const React = require('react');
  const host = (name: string) => function Host({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
    return React.createElement(name, props, children);
  };
  return {
    ...require('@/ui/theme'),
    AppText: host('Text'), GlassPanel: host('Panel'), CoinBadge: () => null,
    Icon: () => null, WorldBackground: () => null,
    AppButton: ({ label, ...props }: { label: string }) => React.createElement('Button', props, label),
  };
});

function gameModules(startLevel = 5) {
  let modules!: {
    React: typeof import('react');
    renderer: typeof import('react-test-renderer');
    GameScreen: typeof import('../game').default;
    saved: typeof import('@/core/storage');
    onboarding: typeof import('@/features/onboarding');
    game: typeof import('@/features/game/store');
    levels: typeof import('@/features/levels');
    currency: typeof import('@/features/currency');
    retention: typeof import('@/features/retention');
    collection: typeof import('@/features/collection/store');
    persistence: typeof import('@/features/game/persistence');
    settlement: typeof import('@/features/game/settlement');
    ads: typeof import('@/features/monetization');
    subscription: typeof import('@/features/monetization/subscription');
  };
  jest.isolateModules(() => {
    const saved = require('@/core/storage') as typeof import('@/core/storage');
    const onboarding = require('@/features/onboarding') as typeof import('@/features/onboarding');
    expect(onboarding.assignIntroPackForCurrentProfile()).toBe(true);
    const completed = Array.from({ length: startLevel - 1 }, (_, index) => index + 1);
    saved.storage.set(saved.KEYS.levelsProgress, JSON.stringify({ world: 'world1', currentLevel: startLevel, completed }));
    saved.storage.set(saved.KEYS.currency, JSON.stringify({
      version: 2, coins: 160, gems: 0, newProfile: true,
      appliedRewards: { 'starter:coins': 1, 'starter:hint-coins': 1 },
    }));
    saved.storage.set(saved.KEYS.settings, JSON.stringify({ sound: false, music: false, haptics: false, notifications: false }));
    const model = require('@/features/retention/model') as typeof import('@/features/retention/model');
    let progress = model.makeInitialSnapshot({ newProfile: true });
    for (const id of completed) progress = model.reduceCompletion(progress, {
      mode: 'campaign', puzzleKey: String(id), actionDay: '2026-10-03', completedAtMs: Date.now(),
    }).snapshot;
    progress.pendingCoinGrants = {};
    saved.storage.set(saved.KEYS.retention, JSON.stringify(progress));
    modules = {
      React: require('react'), renderer: require('react-test-renderer'), saved, onboarding,
      GameScreen: require('../game').default,
      game: require('@/features/game/store'), levels: require('@/features/levels'),
      currency: require('@/features/currency'), retention: require('@/features/retention'),
      collection: require('@/features/collection/store'), persistence: require('@/features/game/persistence'),
      settlement: require('@/features/game/settlement'),
      ads: require('@/features/monetization'),
      subscription: require('@/features/monetization/subscription'),
    };
  });
  return modules;
}

type Modules = ReturnType<typeof gameModules>;
const dispose: (() => void)[] = [];

async function mountGame(modules: Modules) {
  let tree!: ReactTestRenderer;
  await modules.renderer.act(async () => { tree = modules.renderer.create(modules.React.createElement(modules.GameScreen)); });
  dispose.push(() => modules.renderer.act(() => tree.unmount()));
  return tree;
}

async function showResult(modules: Modules) {
  await modules.renderer.act(async () => { jest.advanceTimersByTime(400); });
  expect(mockResultProps).not.toBeNull();
  expect(mockResultProps).toMatchObject({ introComplete: true, rewardPending: false, heroCaption: 'Острова Сены' });
  expect(mockResultProps!.heroImage).toBeDefined();
  expect(modules.collection.useCollection.getState().opened.filter((id) => id === 'paris-river-islands')).toHaveLength(1);
  expect(modules.levels.useLevels.getState().completed).toEqual([1, 2, 3, 4, 5]);
  expect(modules.levels.useLevels.getState().currentLevel).toBe(6);
  return mockResultProps!;
}

async function winFifth(modules: Modules) {
  await mountGame(modules);
  for (const word of ['клуб', 'лук', 'куб']) {
    await modules.renderer.act(async () => { expect(mockDiskProps!.onWord(word)).toBe('grid'); });
  }
  return showResult(modules);
}

function completedRewards(modules: Modules) {
  return JSON.stringify({
    grants: modules.retention.useRetention.getState().rewardGrants,
    ownership: modules.retention.useRetention.getState().ownedCollectibles,
    wallet: modules.currency.useCurrency.getState().appliedRewards,
    coins: modules.currency.useCurrency.getState().coins,
  });
}

function startsAt(level: number) {
  return mockReport.mock.calls.filter(([name, envelope]) => name === 'puzzle_started'
    && (envelope as { levelId: number }).levelId === level);
}

beforeEach(() => {
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  jest.setSystemTime(new Date('2026-10-03T09:00:00.000Z'));
  mockDiskProps = null;
  mockCurrentAppState = 'active';
  mockResultProps = null;
  mockPromptProps = null;
  mockReport.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.push.mockClear();
  mockReview.mockClear();
  mockInterstitialReady.mockReset().mockReturnValue(false);
  mockShowInterstitial.mockReset().mockResolvedValue('shown');
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  dispose.splice(0).forEach((unmount) => unmount());
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: true });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('a taller sticky banner keeps a short game area scrollable without shrinking letters or restarting the puzzle', async () => {
  const modules = gameModules(400);
  const tree = await mountGame(modules);
  const attemptId = modules.game.useGame.getState().snapshot!.attemptId;
  const minimumWheelSize = minimumLetterDiskSize(modules.game.useGame.getState().level!.letters.length, 200);
  const wheel = tree.root.findByProps({ testID: 'mock-letter-disk' });
  const resize = async (height: number) => {
    await modules.renderer.act(async () => {
      tree.root.findByProps({ testID: 'game-play-area' }).props.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
      });
    });
  };

  await resize(480);
  expect(tree.root.findByProps({ testID: 'game-play-scroll' }).props.scrollEnabled).toBe(false);
  expect(mockDiskProps!.size).toBeGreaterThanOrEqual(minimumWheelSize);

  await resize(367);
  const compactScroll = tree.root.findByProps({ testID: 'game-play-scroll' });
  expect(compactScroll.props.scrollEnabled).toBe(true);
  expect(compactScroll.props.contentContainerStyle.height - 367).toBeLessThanOrEqual(24);

  await resize(200);
  const area = tree.root.findByProps({ testID: 'game-play-area' });
  const scroll = tree.root.findByProps({ testID: 'game-play-scroll' });
  expect(area.props.style).toMatchObject({ minHeight: 0, overflow: 'hidden' });
  expect(scroll.props.scrollEnabled).toBe(true);
  expect(scroll.props.contentContainerStyle.height).toBeGreaterThan(200);
  expect(scroll.props.contentContainerStyle.height - mockDiskProps!.size).toBeLessThanOrEqual(128);
  expect(tree.root.findByProps({ testID: 'game-board-scroll' }).props.nestedScrollEnabled).toBe(true);
  expect(mockDiskProps!.size).toBeGreaterThanOrEqual(minimumWheelSize);
  expect(area.findAllByProps({ testID: 'mock-ad-banner' })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: 'mock-ad-banner' })).toHaveLength(1);

  await resize(480);
  expect(tree.root.findByProps({ testID: 'game-play-scroll' }).props.scrollEnabled).toBe(false);
  expect(tree.root.findByProps({ testID: 'mock-letter-disk' })).toBe(wheel);
  expect(modules.game.useGame.getState().snapshot!.attemptId).toBe(attemptId);
});

test('the visible first-level gesture guide classifies a manual win as assisted without a currency grant', async () => {
  const modules = gameModules(1);
  const initialCoins = modules.currency.useCurrency.getState().coins;
  const initialWalletLedger = { ...modules.currency.useCurrency.getState().appliedRewards };
  await mountGame(modules);
  expect(mockDiskProps?.demoLoop).toBe(true);
  expect(modules.onboarding.readIntroGuidance().demoHelpedLevelIds).toContain(1);

  for (const word of ['кот', 'ток']) {
    await modules.renderer.act(async () => { expect(mockDiskProps!.onWord(word)).toBe('grid'); });
  }
  expect(modules.game.useGame.getState().completion.status).toBe('reward_claimed');
  expect(modules.levels.useLevels.getState().completed).toEqual([1]);
  const wins = mockReport.mock.calls.filter(([name]) => name === 'puzzle_completed');
  expect(wins).toHaveLength(1);
  expect(wins[0][1]).toMatchObject({ levelId: 1, assisted: true, assistanceType: 'intro_help' });
  expect(modules.currency.useCurrency.getState().coins).toBe(initialCoins);
  expect(modules.currency.useCurrency.getState().appliedRewards).toEqual(initialWalletLedger);
});

test('the actual fifth-win Continue callback opens level 6 once and never repeats its rewards', async () => {
  const modules = gameModules();
  const result = await winFifth(modules);
  const rewards = completedRewards(modules);
  expect(startsAt(5)).toHaveLength(1);
  expect(startsAt(6)).toHaveLength(0);

  let outcomes!: boolean[];
  await modules.renderer.act(async () => { outcomes = await Promise.all([result.onNext(), result.onNext()]); });
  expect(outcomes).toEqual([true, false]);
  expect(modules.game.useGame.getState().level?.globalId).toBe(6);
  expect(modules.game.useGame.getState().completion.status).toBe('playing');
  expect(startsAt(6)).toHaveLength(1);
  expect(completedRewards(modules)).toBe(rewards);
  expect(modules.levels.useLevels.getState().completed).toEqual([1, 2, 3, 4, 5]);
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('the actual fifth-win Daily callback routes to daily without fabricating a level 6 start', async () => {
  const modules = gameModules();
  const result = await winFifth(modules);
  const rewards = completedRewards(modules);

  let outcomes!: boolean[];
  await modules.renderer.act(async () => { outcomes = await Promise.all([result.onDaily!(), result.onDaily!()]); });
  expect(outcomes).toEqual([true, false]);
  expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).toHaveBeenCalledWith('/daily?source=intro_completion');
  expect(startsAt(6)).toHaveLength(0);
  expect(modules.game.useGame.getState().level?.globalId).toBe(5);
  expect(modules.persistence.loadGameSnapshot('normal')).toBeNull();
  expect(modules.saved.storage.getString(modules.saved.KEYS.introSurface)).toBe('menu');
  expect(completedRewards(modules)).toBe(rewards);
});

test('a saved fifth-level pending result settles and reveals its postcard without another puzzle start', async () => {
  const modules = gameModules();
  const level = modules.onboarding.getIntroLevel(5)!;
  modules.game.useGame.getState().start(level);
  for (const word of ['клуб', 'лук', 'куб']) modules.game.useGame.getState().submit(word);
  const pending = modules.game.useGame.getState().snapshot!;
  expect(pending.completion.status).toBe('completion_pending');

  await mountGame(modules);
  await showResult(modules);
  expect(modules.game.useGame.getState().completion.status).toBe('reward_claimed');
  expect(startsAt(5)).toHaveLength(0);
  expect(startsAt(6)).toHaveLength(0);
  const rewards = completedRewards(modules);
  modules.settlement.settlePuzzleCompletion(level, 'normal', pending, true);
  expect(completedRewards(modules)).toBe(rewards);
  expect(mockReport.mock.calls.filter(([name]) => name === 'puzzle_completed')).toHaveLength(1);
  expect(mockReport.mock.calls.filter(([name]) => name === 'fifth_level_completed')).toHaveLength(1);
});

test.each(['completion_pending', 'reward_claimed'] as const)('a saved %s fifth-win result survives progress already advancing to level 6', async (status) => {
  const modules = gameModules();
  const level = modules.onboarding.getIntroLevel(5)!;
  modules.game.useGame.getState().start(level);
  for (const word of ['клуб', 'лук', 'куб']) modules.game.useGame.getState().submit(word);
  const pending = modules.game.useGame.getState().snapshot!;
  modules.settlement.settlePuzzleCompletion(level, 'normal', pending, true);
  if (status === 'reward_claimed') modules.game.useGame.getState().markRewardClaimed();
  expect(modules.levels.useLevels.getState().currentLevel).toBe(6);
  expect(modules.persistence.loadGameSnapshot('normal')?.completion.status).toBe(status);
  const rewards = completedRewards(modules);

  await mountGame(modules);
  await showResult(modules);
  expect(modules.game.useGame.getState().level?.globalId).toBe(5);
  expect(modules.game.useGame.getState().completion.status).toBe('reward_claimed');
  expect(startsAt(6)).toHaveLength(0);
  expect(completedRewards(modules)).toBe(rewards);
});

test.each(['fingerprint', 'solved word', 'filled cell'] as const)('a result with a corrupted %s cannot replace the real current level', async (corruption) => {
  const modules = gameModules();
  const level = modules.onboarding.getIntroLevel(5)!;
  modules.game.useGame.getState().start(level);
  for (const word of ['клуб', 'лук', 'куб']) modules.game.useGame.getState().submit(word);
  const pending = modules.game.useGame.getState().snapshot!;
  modules.settlement.settlePuzzleCompletion(level, 'normal', pending, true);
  const corrupted = corruption === 'fingerprint' ? { ...pending, levelFingerprint: 'corrupted-content' }
    : corruption === 'solved word' ? { ...pending, solvedWords: pending.solvedWords.filter((word) => word !== 'куб') }
    : { ...pending, filled: Object.fromEntries(Object.entries(pending.filled).slice(1)) };
  if (corruption !== 'fingerprint') expect(corrupted.levelFingerprint).toBe(level.fingerprint);
  modules.saved.storage.set(modules.saved.KEYS.gameCurrentNormal, JSON.stringify(corrupted));
  const rewards = completedRewards(modules);

  await mountGame(modules);
  await modules.renderer.act(async () => { jest.advanceTimersByTime(400); });
  expect(mockResultProps).toBeNull();
  expect(modules.game.useGame.getState().level?.globalId).toBe(6);
  expect(modules.game.useGame.getState().completion.status).toBe('playing');
  expect(startsAt(6)).toHaveLength(1);
  expect(completedRewards(modules)).toBe(rewards);
});

async function winCurrentCampaignLevel(modules: Modules) {
  const level = modules.game.useGame.getState().level!;
  for (const answer of level.answers) {
    await modules.renderer.act(async () => { expect(mockDiskProps!.onWord(answer.word)).toBe('grid'); });
  }
  await modules.renderer.act(async () => { jest.advanceTimersByTime(400); });
  expect(modules.game.useGame.getState().completion.status).toBe('reward_claimed');
  expect(mockResultProps).toMatchObject({ rewardPending: false });
  return mockResultProps!;
}

async function continueCampaign(modules: Modules, result: ResultProps) {
  let outcomes!: boolean[];
  await modules.renderer.act(async () => { outcomes = await Promise.all([result.onNext(), result.onNext()]); });
  expect(outcomes).toEqual([true, false]);
}

test('a cold launch restored on a claimed result resets the previous visit before checking ad eligibility', async () => {
  const modules = gameModules(6);
  const level = modules.levels.loadGlobalLevel(6)!;
  modules.game.useGame.getState().start(level);
  for (const answer of level.answers) modules.game.useGame.getState().submit(answer.word);
  modules.settlement.settlePuzzleCompletion(level, 'normal', modules.game.useGame.getState().snapshot!, true);
  modules.game.useGame.getState().markRewardClaimed();
  modules.ads.saveAdsMeta({
    ...modules.ads.loadAdsMeta(), visibleGameplaySinceInterstitialSec: 300,
    newCampaignCompletionsSinceFullscreen: 3,
  });
  modules.saved.storage.set('ads.gameplay-session.v1', JSON.stringify({
    version: 1, firstRuntimeId: 'first-old-visit', lastRuntimeId: 'previous-runtime',
  }));
  mockInterstitialReady.mockReturnValue(true);

  await mountGame(modules);
  await modules.renderer.act(async () => { jest.advanceTimersByTime(400); });
  expect(modules.game.useGame.getState().level?.globalId).toBe(6);
  expect(modules.ads.loadAdsMeta().visibleGameplaySinceInterstitialSec).toBe(300);
  await continueCampaign(modules, mockResultProps!);

  expect(mockShowInterstitial).not.toHaveBeenCalled();
  expect(modules.game.useGame.getState().level?.globalId).toBe(7);
  expect(modules.ads.loadAdsMeta().visibleGameplaySinceInterstitialSec).toBe(0);
  expect(modules.ads.loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(0);
  expect(mockReport.mock.calls.some(([name, envelope]) => name === 'ad_lifecycle'
    && (envelope as { stage: string; reason: string }).stage === 'skipped'
    && (envelope as { reason: string }).reason === 'insufficient_interstitial_interval')).toBe(true);
});

test('actual Continue callbacks show one interstitial after three new short levels', async () => {
  const modules = gameModules(6);
  mockInterstitialReady.mockReturnValue(true);
  await mountGame(modules);
  for (const levelId of [6, 7, 8]) {
    expect(modules.game.useGame.getState().level?.globalId).toBe(levelId);
    const result = await winCurrentCampaignLevel(modules);
    await continueCampaign(modules, result);
    expect(mockShowInterstitial).toHaveBeenCalledTimes(levelId === 8 ? 1 : 0);
  }
  expect(mockShowInterstitial).toHaveBeenCalledWith('level_complete');
  expect(modules.ads.loadAdsMeta().visibleGameplaySinceInterstitialSec).toBe(0);
  expect(modules.ads.loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(0);
  expect(modules.ads.loadAdsMeta().interstitialShownAt).toHaveLength(1);
});

test('a late native ad dismissal after background cannot advance or repay the solved result', async () => {
  const modules = gameModules(6);
  mockInterstitialReady.mockReturnValue(true);
  let closeAd!: (result: InterstitialResult) => void;
  mockShowInterstitial.mockImplementation(() => new Promise((resolve) => { closeAd = resolve; }));
  await mountGame(modules);
  await modules.renderer.act(async () => { jest.advanceTimersByTime(300_000); });
  const result = await winCurrentCampaignLevel(modules);
  const rewards = completedRewards(modules);
  let continuation!: Promise<boolean>;
  await modules.renderer.act(async () => { continuation = result.onNext(); for (let i = 0; i < 10; i++) await Promise.resolve(); });
  expect(mockShowInterstitial).toHaveBeenCalledTimes(1);
  await modules.renderer.act(async () => {
    mockCurrentAppState = 'background';
    for (const callback of mockAppStateListeners) callback('background');
    closeAd('shown');
    expect(await continuation).toBe(false);
  });
  expect(modules.game.useGame.getState().level?.globalId).toBe(6);
  expect(modules.game.useGame.getState().completion.status).toBe('reward_claimed');
  expect(completedRewards(modules)).toBe(rewards);
  expect(mockPromptProps?.plan).toBeNull();
  await modules.renderer.act(async () => {
    mockCurrentAppState = 'active';
    for (const callback of mockAppStateListeners) callback('active');
  });
  await continueCampaign(modules, mockResultProps!);
  expect(modules.game.useGame.getState().level?.globalId).toBe(7);
  expect(mockShowInterstitial).toHaveBeenCalledTimes(1);
  expect(completedRewards(modules)).toBe(rewards);
});

test.each(['later', 'subscribe'] as const)('the third shown ad waits at the result; %s continues once without checkout', async (choice) => {
  const modules = gameModules(6);
  modules.saved.storage.set(modules.saved.KEYS.subscriptionOfferProgress, JSON.stringify({
    version: 1, shownInterstitialsSinceOffer: 2, lastPresentedAt: null,
  }));
  modules.subscription.useSubscription.setState({
    catalog: { provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: 'slova',
      available: true, mode: 'live', plan: { amount: '99.00', periodDays: 30 } } as never,
    status: { active: false, autoRenew: false, activeUntil: null, nextPaymentAt: null,
      pendingPaymentId: null, serverTime: Date.now() },
  });
  mockInterstitialReady.mockReturnValue(true);
  await mountGame(modules);
  for (const level of [6, 7]) {
    const result = await winCurrentCampaignLevel(modules);
    await continueCampaign(modules, result);
    expect(modules.game.useGame.getState().level?.globalId).toBe(level + 1);
    expect(mockPromptProps?.plan).toBeNull();
  }
  const result = await winCurrentCampaignLevel(modules);
  const rewards = completedRewards(modules);
  const checkout = jest.spyOn(modules.subscription.useSubscription.getState(), 'checkout');
  let continuation!: Promise<boolean>;
  await modules.renderer.act(async () => { continuation = result.onNext(); for (let i = 0; i < 10; i++) await Promise.resolve(); });
  expect(mockShowInterstitial).toHaveBeenCalledTimes(1);
  expect(mockPromptProps?.plan).toEqual({ amount: '99.00', periodDays: 30 });
  expect(modules.game.useGame.getState().level?.globalId).toBe(8);
  expect(completedRewards(modules)).toBe(rewards);
  await modules.renderer.act(async () => {
    mockPromptProps!.onShown();
    if (choice === 'subscribe') mockPromptProps!.onSubscribe(); else mockPromptProps!.onLater();
    expect(await continuation).toBe(true);
  });
  expect(modules.game.useGame.getState().level?.globalId).toBe(9);
  expect(completedRewards(modules)).toBe(rewards);
  expect(checkout).not.toHaveBeenCalled();
  if (choice === 'subscribe') expect(mockRouter.push).toHaveBeenCalledWith('/shop?source=post_ad');
  else expect(mockRouter.push).not.toHaveBeenCalled();
});

test('five minutes of actual visible gameplay allow Continue after one long level', async () => {
  const modules = gameModules(6);
  mockInterstitialReady.mockReturnValue(true);
  await mountGame(modules);
  await modules.renderer.act(async () => { jest.advanceTimersByTime(300_000); });
  expect(mockShowInterstitial).not.toHaveBeenCalled();
  expect(modules.ads.loadAdsMeta().visibleGameplaySinceInterstitialSec).toBe(300);

  const result = await winCurrentCampaignLevel(modules);
  expect(modules.ads.loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(1);
  await continueCampaign(modules, result);
  expect(mockShowInterstitial).toHaveBeenCalledTimes(1);
  expect(modules.game.useGame.getState().level?.globalId).toBe(7);
  expect(modules.ads.loadAdsMeta().interstitialShownAt).toHaveLength(1);
});

test.each(['not loaded', 'failed to show'] as const)('an ad %s preserves the eligible interval for the next actual Continue', async (failure) => {
  const modules = gameModules(6);
  mockInterstitialReady.mockReturnValue(failure === 'failed to show');
  if (failure === 'failed to show') mockShowInterstitial.mockResolvedValueOnce('unavailable');
  await mountGame(modules);
  await modules.renderer.act(async () => { jest.advanceTimersByTime(300_000); });
  const first = await winCurrentCampaignLevel(modules);
  await continueCampaign(modules, first);
  expect(mockShowInterstitial).toHaveBeenCalledTimes(failure === 'failed to show' ? 1 : 0);
  expect(modules.ads.loadAdsMeta().visibleGameplaySinceInterstitialSec).toBe(300);
  expect(modules.ads.loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(1);
  expect(modules.ads.loadAdsMeta().interstitialShownAt).toEqual([]);

  mockInterstitialReady.mockReturnValue(true);
  const second = await winCurrentCampaignLevel(modules);
  await continueCampaign(modules, second);
  expect(mockShowInterstitial).toHaveBeenCalledTimes(failure === 'failed to show' ? 2 : 1);
  expect(modules.ads.loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(0);
  expect(modules.ads.loadAdsMeta().interstitialShownAt).toHaveLength(1);
});

test('a protected postcard result preserves the interval until the next ordinary result', async () => {
  const modules = gameModules(9);
  mockInterstitialReady.mockReturnValue(true);
  await mountGame(modules);
  await modules.renderer.act(async () => { jest.advanceTimersByTime(300_000); });
  const postcardResult = await winCurrentCampaignLevel(modules);
  await continueCampaign(modules, postcardResult);
  expect(mockShowInterstitial).not.toHaveBeenCalled();
  expect(mockReport.mock.calls.some(([name, envelope]) => name === 'ad_lifecycle'
    && (envelope as { stage: string; reason: string }).stage === 'skipped'
    && (envelope as { reason: string }).reason === 'protected_transition')).toBe(true);
  expect(modules.ads.loadAdsMeta().visibleGameplaySinceInterstitialSec).toBe(300);
  expect(modules.ads.loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(1);

  const ordinaryResult = await winCurrentCampaignLevel(modules);
  await continueCampaign(modules, ordinaryResult);
  expect(mockShowInterstitial).toHaveBeenCalledTimes(1);
  expect(modules.ads.loadAdsMeta().newCampaignCompletionsSinceFullscreen).toBe(0);
  expect(modules.ads.loadAdsMeta().interstitialShownAt).toHaveLength(1);
});
