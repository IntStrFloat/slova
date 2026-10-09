/* eslint-disable @typescript-eslint/no-require-imports */
import type { ReactTestRenderer } from 'react-test-renderer';

type DiskProps = { letters: string[]; onWord: (word: string) => string; demoLoop?: boolean };
type ResultProps = {
  introComplete: boolean;
  rewardPending: boolean;
  heroCaption?: string;
  heroImage?: number;
  onNext: () => Promise<boolean>;
  onDaily?: () => Promise<boolean>;
};
let mockDiskProps: DiskProps | null = null;
let mockResultProps: ResultProps | null = null;
const mockReport = jest.fn<boolean, unknown[]>(() => true);
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false };
const mockParams = { mode: 'normal' };
const mockReview = jest.fn<Promise<string>, unknown[]>(async () => 'skipped');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => function Host({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
    return React.createElement(name, props, children);
  };
  return {
    View: host('View'), ScrollView: host('ScrollView'), Pressable: host('Pressable'),
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
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
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: (...args: unknown[]) => mockReport(...args), isAppMetricaAvailable: () => true,
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
  getAds: () => ({ isInterstitialReady: () => false, showInterstitial: async () => 'unavailable' }),
}));
jest.mock('@/features/monetization/rewarded', () => ({
  isRewardedReady: () => false, requestRewarded: async () => 'unavailable',
}));
jest.mock('@/features/monetization/AdBanner', () => ({ AdBanner: () => null }));
jest.mock('@/features/monetization/NoCoinsModal', () => ({ NoCoinsModal: () => null }));
jest.mock('@/features/collection', () => ({ useCollection: require('@/features/collection/store').useCollection }));
jest.mock('@/features/game', () => {
  const React = require('react');
  return {
    useGame: require('@/features/game/store').useGame,
    CrosswordGrid: () => null, LevelObjective: () => null,
    LetterDisk: (props: DiskProps) => { mockDiskProps = props; return React.createElement('LetterDisk', props); },
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

function gameModules(startLevel: 1 | 5 = 5) {
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
    && (envelope as { properties: { levelId: number } }).properties.levelId === level);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  jest.setSystemTime(new Date('2026-10-03T09:00:00.000Z'));
  mockDiskProps = null;
  mockResultProps = null;
  mockReport.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.push.mockClear();
  mockReview.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  dispose.splice(0).forEach((unmount) => unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
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
  expect(wins[0][1]).toMatchObject({ properties: { levelId: 1, assisted: true, assistanceType: 'intro_help' } });
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
