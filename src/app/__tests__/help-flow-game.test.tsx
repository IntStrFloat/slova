/* eslint-disable @typescript-eslint/no-require-imports */
import type { ReactTestRenderer } from 'react-test-renderer';
import type { RewardConfirmation, RewardedPlacement, RewardedResult } from '@/features/monetization/types';
import type { FlowResult } from '../../../modules/rustore-updates/types';
import { helpExperimentFixture } from '@/features/hints/__tests__/help-experiment-fixture';
import { helpExperimentPlanFingerprint } from '@/core/config/helpExperiment';

// Each isolated fixture imports the real content catalog; leave room for cold transforms on a shared test host.
jest.setTimeout(20_000);

type ModalProps = {
  requestedHint: 'letter' | 'semantic'; attemptId: string; originInteractionId?: string;
  uxVariant: 'control' | 'clarity';
  focusedOffer?: boolean; earned?: boolean;
  priceCoins: number; currentCoins: number; canWatchAd: boolean; canFreeSpin: boolean;
  helpContext?: Record<string, unknown>; routeFocused?: boolean;
  onWatchAd: (interactionId?: string, modalId?: string) => Promise<void>;
  onFreeWheel: (interactionId?: string, modalId?: string) => void; onWheel: (interactionId?: string, modalId?: string) => void;
  onApplyHint?: (interactionId?: string, modalId?: string) => void; onClose: () => void;
};
let mockParams: Record<string, string | undefined> = { mode: 'normal' };
let mockLegacyAssignedPresentation = true;
let mockHelpController: ReturnType<typeof import('@/features/hints/help-experiment').createHelpExperimentController> | null = null;
jest.mock('@/features/hints/help-experiment', () => {
  const actual = jest.requireActual('@/features/hints/help-experiment');
  return { ...actual,
    prepareHelpRequestDecision: (input: import('@/features/hints/help-experiment').CapturedHelpRequest) => mockHelpController?.prepare(input) ?? actual.prepareHelpRequestDecision(input),
    resolveHelpUxVariant: (flow: import('@/features/hints/help-flow').HelpFlow | string | null) => mockLegacyAssignedPresentation && flow
      ? 'clarity' : mockHelpController && typeof flow === 'object' ? mockHelpController.resolve(flow) : actual.resolveHelpUxVariant(flow),
  };
});
const mockRouter = {
  push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false,
  setParams: jest.fn((params: Record<string, string | undefined>) => { mockParams = { ...mockParams, ...params }; }),
};
const mockReport = jest.fn<boolean, unknown[]>(() => true);
const mockShowRewarded = jest.fn<Promise<RewardedResult>, [RewardedPlacement, RewardConfirmation?]>(async (_placement, confirmation) => {
  confirmation?.persistGrant(confirmation.rewardId);
  confirmation?.persistGrant(confirmation.rewardId);
  return 'rewarded';
});
let mockUpdatesEnabled = false;
let mockUpdateAvailable = true;
const mockUpdateOffer = jest.fn<Promise<FlowResult>, []>(async () => ({ result: 'cancelled', reason: 'declined' }));
const mockUpdateRewardedGuard = jest.fn<Promise<boolean>, []>(async () => false);
const mockCampaignReview = jest.fn(async () => 'skipped');

jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => function Host({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
    return React.createElement(name, props, children);
  };
  return {
    View: host('View'), ScrollView: host('ScrollView'), Pressable: host('Pressable'),
    StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
    BackHandler: { addEventListener: () => ({ remove: () => {} }) },
    useWindowDimensions: () => ({ width: 360, height: 740, fontScale: 1, scale: 1 }),
    Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android },
    TurboModuleRegistry: { get: () => null },
  };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: React.PropsWithChildren) => children }));
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const fade = { duration: () => fade };
  return {
    __esModule: true, default: { View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement('AnimatedView', props, children) },
    Easing: { bezier: () => () => 0 }, FadeIn: fade, FadeInDown: fade, FadeOut: fade,
    interpolate: (value: number) => value, withDelay: (_delay: number, value: unknown) => value, withTiming: (value: unknown) => value,
    cancelAnimation: () => {}, useReducedMotion: () => true,
    useAnimatedStyle: (callback: () => unknown) => callback(),
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef(initial);
      return { get: () => ref.current, set: (value: unknown) => { ref.current = value; } };
    }, withSpring: (value: unknown) => value,
  };
});
jest.mock('expo-router', () => {
  const React = require('react');
  return { useRouter: () => mockRouter, useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]) };
});
jest.mock('expo-haptics', () => ({
  notificationAsync: async () => {}, impactAsync: async () => {},
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' }, ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
jest.mock('expo-image', () => ({ Image: (props: Record<string, unknown>) => require('react').createElement('Image', props) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => require('react').createElement('Gradient', props, children) }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: (...args: unknown[]) => mockReport(...args), isAppMetricaAvailable: () => true,
  getSoftwareBuildInfo: () => ({ versionName: '0.1.29', versionCode: '34' }),
  isAppMetricaTestDevice: () => false, setDataSendingEnabled: () => true, getDataSendingPreference: () => null,
  getAppMetricaIdentifiers: async () => ({ deviceId: '18446744073709551615', installationId: 'fixture_install' }),
}));
jest.mock('@/core/platform/yandexGames', () => ({ setYandexGameplayActive: () => {}, isYandexGamesBuild: () => false }));
jest.mock('@/features/audio', () => ({ playSfx: () => {} }));
jest.mock('@/features/leaderboard', () => ({ useLeaderboard: { getState: () => ({ syncProgress: async () => {} }) } }));
jest.mock('@/features/review', () => ({ requestCampaignReview: () => mockCampaignReview() }));
jest.mock('@/features/updates/config', () => ({ get UPDATES_ENABLED() { return mockUpdatesEnabled; } }));
jest.mock('../../../modules/rustore-review', () => ({ hasActiveForm: () => false }));
jest.mock('../../../modules/rustore-updates', () => ({ updatesGateway: {
  isSupported: () => mockUpdatesEnabled, getNativeVersionCode: () => '34',
  checkAvailability: async () => mockUpdateAvailable
    ? ({ result: 'available', versionCode: '35', installedVersionCode: '34', state: 'unknown', infoToken: 'test-info' })
    : ({ result: 'unavailable', reason: 'native_unavailable' }),
  startFlexible: () => mockUpdateOffer(),
  completeFlexible: async () => ({ result: 'unavailable', reason: 'native_unavailable' }),
  discard: () => {}, subscribe: () => () => {},
} }));
jest.mock('@/features/notifications', () => ({
  trackReminderGameplay: () => {}, cancelDailyReminderForDate: async () => {}, syncDailyReminders: async () => {},
}));
jest.mock('@/features/monetization/providers', () => ({ getAds: () => ({
  isInterstitialReady: () => false, showInterstitial: async () => 'unavailable',
  isRewardedReady: () => true, getRewardedState: () => 'ready', getRewardedFailure: () => null,
  showRewarded: (placement: RewardedPlacement, confirmation?: RewardConfirmation) => mockShowRewarded(placement, confirmation),
}) }));
jest.mock('@/features/monetization/nativeRewardJournal', () => ({
  readNativeEarnedRewards: async () => [], acknowledgeNativeReward: async () => {},
  hasActiveNativeRewardedShow: () => mockUpdateRewardedGuard(),
}));
jest.mock('@/features/monetization/AdBanner', () => ({ AdBanner: () => null }));
jest.mock('@/features/monetization/NoCoinsModal', () => ({
  NoCoinsModal: (props: ModalProps) => require('react').createElement('NoCoinsModal', props),
}));
jest.mock('@/features/monetization/PostAdSubscriptionOffer', () => ({ PostAdSubscriptionOffer: () => null }));
jest.mock('@/features/collection', () => ({ useCollection: require('@/features/collection/store').useCollection }));
jest.mock('@/features/game', () => ({
  useGame: require('@/features/game/store').useGame,
  CrosswordGrid: (props: Record<string, unknown>) => require('react').createElement('CrosswordGrid', props),
  LevelObjective: (props: Record<string, unknown>) => require('react').createElement('LevelObjective', props),
  LetterDisk: (props: Record<string, unknown>) => require('react').createElement('LetterDisk', props),
  LevelComplete: (props: Record<string, unknown>) => require('react').createElement('LevelComplete', props),
}));
jest.mock('@/features/game/CompactBonusObjective', () => ({
  CompactBonusObjective: (props: Record<string, unknown>) => require('react').createElement('CompactBonusObjective', props),
}));
jest.mock('@/ui', () => {
  const React = require('react');
  const host = (name: string) => function Host({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
    return React.createElement(name, props, children);
  };
  return { ...require('@/ui/theme'), AppText: host('Text'), GlassPanel: host('Panel'),
    CoinBadge: () => null, Icon: () => null, WorldBackground: () => null,
    AppButton: ({ label, ...props }: { label: string }) => React.createElement('Button', props, label) };
});

function gameModules(startLevel = 6, balance = 20) {
  let modules!: {
    React: typeof import('react'); renderer: typeof import('react-test-renderer');
    GameScreen: typeof import('../game').default; saved: typeof import('@/core/storage');
    game: typeof import('@/features/game/store'); levels: typeof import('@/features/levels');
    currency: typeof import('@/features/currency'); flows: typeof import('@/features/hints/help-flow');
    analytics: typeof import('@/features/analytics'); sdk: typeof import('@/features/analytics/sdkIdentity');
    persistence: typeof import('@/features/game/persistence'); hints: typeof import('@/features/hints');
    daily: typeof import('@/features/dailypuzzle'); wheel: typeof import('@/features/wheel');
    updates: typeof import('@/features/updates'); fullscreen: typeof import('@/core/fullscreen');
    actualLevelComplete: typeof import('@/features/game/LevelComplete').LevelComplete;
    actualNoCoins: typeof import('@/features/monetization/NoCoinsModal').NoCoinsModal;
    rewardedHints: typeof import('@/features/hints/rewarded-hint');
  };
  jest.isolateModules(() => {
    const saved = require('@/core/storage') as typeof import('@/core/storage');
    const onboarding = require('@/features/onboarding') as typeof import('@/features/onboarding');
    expect(onboarding.assignIntroPackForCurrentProfile()).toBe(true);
    const completed = Array.from({ length: startLevel - 1 }, (_, index) => index + 1);
    saved.storage.set(saved.KEYS.levelsProgress, JSON.stringify({ world: 'world1', currentLevel: startLevel, completed }));
    saved.storage.set(saved.KEYS.campaignHistoryProof, JSON.stringify({ version: 1, complete: true }));
    saved.storage.set(saved.KEYS.currency, JSON.stringify({ version: 2, coins: balance, gems: 0, newProfile: true,
      appliedRewards: { 'starter:coins': 1, 'starter:hint-coins': 1 } }));
    saved.storage.set(saved.KEYS.settings, JSON.stringify({ sound: false, music: false, haptics: false, notifications: false }));
    const model = require('@/features/retention/model') as typeof import('@/features/retention/model');
    let progress = model.makeInitialSnapshot({ newProfile: true });
    for (const id of completed) progress = model.reduceCompletion(progress, {
      mode: 'campaign', puzzleKey: String(id), actionDay: '2026-11-03', completedAtMs: Date.now(),
    }).snapshot;
    progress.pendingCoinGrants = {};
    saved.storage.set(saved.KEYS.retention, JSON.stringify(progress));
    modules = { React: require('react'), renderer: require('react-test-renderer'), saved,
      GameScreen: require('../game').default, game: require('@/features/game/store'),
      levels: require('@/features/levels'), currency: require('@/features/currency'),
      analytics: require('@/features/analytics'), sdk: require('@/features/analytics/sdkIdentity'),
      flows: require('@/features/hints/help-flow'), persistence: require('@/features/game/persistence'),
      hints: require('@/features/hints'), daily: require('@/features/dailypuzzle'), wheel: require('@/features/wheel'),
      updates: require('@/features/updates'), fullscreen: require('@/core/fullscreen'),
      rewardedHints: require('@/features/hints/rewarded-hint'),
      actualLevelComplete: require('@/features/game/LevelComplete').LevelComplete,
      actualNoCoins: jest.requireActual('@/features/monetization/NoCoinsModal').NoCoinsModal };
  });
  return modules;
}
type Modules = ReturnType<typeof gameModules>;
const mounted = new Map<ReactTestRenderer, Modules>();
async function mountGame(modules: Modules) {
  let tree!: ReactTestRenderer;
  await modules.renderer.act(async () => { tree = modules.renderer.create(modules.React.createElement(modules.GameScreen)); });
  mounted.set(tree, modules);
  return tree;
}
function unmountGame(tree: ReactTestRenderer) {
  const modules = mounted.get(tree);
  if (!modules) return;
  modules.renderer.act(() => tree.unmount());
  mounted.delete(tree);
}
function modal(tree: ReactTestRenderer): ModalProps {
  return tree.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'NoCoinsModal')[0]?.props as ModalProps;
}
function hintAction(tree: ReactTestRenderer, label: string): () => void {
  const button = tree.root.findAll((node) => typeof node.type === 'string'
    && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith(`${label},`))[0];
  if (button) return button.props.onPress;
  if (label === 'Наводка') {
    const objective = tree.root.findAll((node) => typeof node.type === 'string' && typeof node.props.onCluePress === 'function')[0];
    if (objective) return objective.props.onCluePress;
  }
  throw new Error(`Missing explicit ${label} action`);
}
async function requestLetter(modules: Modules, tree: ReactTestRenderer) {
  await modules.renderer.act(async () => { hintAction(tree, 'Буква')(); });
  const selected = modal(tree);
  expect(selected).toMatchObject({ requestedHint: 'letter', priceCoins: 50, currentCoins: 20 });
  const flow = modules.flows.getHelpFlow(selected.originInteractionId)!;
  expect(flow).not.toBeNull();
  return { selected, flow };
}
function hintDebits(modules: Modules) {
  return Object.keys(modules.currency.useCurrency.getState().appliedRewards).filter((id) => id.startsWith('hint:'));
}
function analyticsEvents(name: string): Record<string, unknown>[] {
  return mockReport.mock.calls.filter(([event]) => event === name).map(([, properties]) => properties as Record<string, unknown>);
}

test('actual earned hint survives the Logs parser without pretending it was a coin grant or a paid hint', async () => {
  const modules = gameModules(); const tree = await mountGame(modules);
  const { selected, flow } = await requestLetter(modules, tree);
  jest.setSystemTime(Date.now() + 2_000);
  await modules.renderer.act(async () => { await selected.onWatchAd('roundtrip:reward', 'roundtrip:modal'); });
  expect(mockShowRewarded).toHaveBeenCalledTimes(1);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(modal(tree)).toBeUndefined();
  expect(analyticsEvents('help_used')).toEqual([expect.objectContaining({
    origin_interaction_id: flow.id, charged_amount: 0, displayed_cost: 0, paidWith: 'free',
  })]);
  expect(analyticsEvents('help_used')[0]).not.toHaveProperty('transaction_id');
  const sdk = '18446744073709551615';
  const records = mockReport.mock.calls.map(([event, raw]) => {
    const properties = raw as Record<string, unknown>;
    return { event_name: event, event_json: { ...properties }, appmetrica_device_id: sdk,
      event_timestamp: Date.parse(String(properties.sdk_handoff_at ?? properties.occurred_at)) / 1000,
      app_version_name: properties.app_version };
  });
  type Metric = { numerator: number; denominator: number; rate: number | null };
  const { analyzeHelpFunnel } = require('../../../scripts/analyze-help-funnel.cjs') as {
    analyzeHelpFunnel: (rows: unknown[], options: Record<string, unknown>) => {
      metrics: { weeks: { sufficiency: Metric; returnHelp: Metric;
        primary: { provenFirstEligibleBaseline: Metric; assignedEligibleItt: Metric } }[] };
    };
  };
  const report = analyzeHelpFunnel(records, { baselineStart: '2026-10-21', currentStart: '2026-10-28',
    timezone: 'UTC+03:00', asOf: '2026-11-04T15:00:00+03:00', source: 'synthetic' });
  const current = report.metrics.weeks[1];
  // These legacy metrics require a linked coin grant. A free earned hint must
  // not manufacture a wallet grant to enter that denominator.
  expect(current.sufficiency).toMatchObject({ numerator: 0, denominator: 0, rate: null });
  expect(current.returnHelp).toMatchObject({ numerator: 0, denominator: 0, rate: null });
  expect(current.primary.provenFirstEligibleBaseline.rate).toBeNull();
  expect(current.primary.assignedEligibleItt.rate).toBeNull();
  for (const coverage of ['since_restore', 'mixed_consent']) {
    const partialActiveTime = records.map((row) => row.event_name === 'help_used'
      ? { ...row, event_json: { ...row.event_json, time_coverage: coverage } } : row);
    const observedAfterGrant = analyzeHelpFunnel(partialActiveTime, { baselineStart: '2026-10-21', currentStart: '2026-10-28',
      timezone: 'UTC+03:00', asOf: '2026-11-04T15:00:00+03:00', source: 'synthetic' });
    expect(observedAfterGrant.metrics.weeks[1].returnHelp).toMatchObject({ numerator: 0, denominator: 0, rate: null });
  }
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  const publicReport = JSON.stringify(report);
  for (const privateId of [sdk, flow.id, flow.attemptId]) expect(publicReport).not.toContain(privateId);
});

test('actual Game first-deficit producer roundtrips its prospective SDK-player trial claim and exact completion through P5', async () => {
  mockLegacyAssignedPresentation = false;
  const modules = gameModules();
  const actual = jest.requireActual('@/features/hints/help-experiment') as typeof import('@/features/hints/help-experiment');
  // gameModules is isolated: obtain its tracker/cache through the imported real controller dependency graph.
  let analytics!: typeof import('@/features/analytics'); let sdk!: typeof import('@/features/analytics/sdkIdentity');
  // The ports below use the same app-level tracker via the scoped modules returned by gameModules.
  analytics = modules.analytics; sdk = modules.sdk;
  await sdk.primeSdkIdentity();
  const declared = helpExperimentFixture();
  mockHelpController = actual.createHelpExperimentController({ ...declared,
    read: modules.saved.getString, write: (key, raw) => { modules.saved.storage.set(key, raw); return modules.saved.getString(key) === raw; },
    remove: modules.saved.removeKey, identity: sdk.getSdkIdentitySnapshot, collectionEnabled: analytics.isAnalyticsCollectionEnabled,
    consentEpoch: analytics.getAnalyticsConsentEpoch, profileToken: () => 'fixture_owner', now: Date.now,
    capture: analytics.captureHelpEnrollmentFact, enqueue: analytics.enqueueCapturedHelpFact, restoreFlow: modules.flows.restoreHelpFlowProjection,
    event: analytics.trackOnce, changed: () => {}, stopControl: () => ({ connected: true, enrollmentAllowed: true, disabledVariants: [] }) });
  const requestTime = Date.now(); jest.setSystemTime(new Date('2026-10-19T00:00:00Z')); mockHelpController.observeIdentity(); jest.setSystemTime(requestTime);
  const tree = await mountGame(modules); const { flow } = await requestLetter(modules, tree);
  const assigned = analyticsEvents('experiment_assigned'); expect(assigned).toHaveLength(1);
  expect(assigned[0]).toMatchObject({ unit_type: 'sdk_player', origin_interaction_id: flow.id, occurredAtMs: flow.createdAtMs,
    measurement_phase: 'trial', eligibility_epoch: declared.config.trial.eligibilityEpoch,
    trial_plan_fingerprint: helpExperimentPlanFingerprint(declared.config) });
  expect(analyticsEvents('hint_requested')).toHaveLength(1); expect(analyticsEvents('hint_rejected')).toHaveLength(1);
  jest.setSystemTime(requestTime + 1000); await modules.renderer.act(async () => { modal(tree).onClose(); });
  jest.setSystemTime(requestTime + 60_000);
  const level = modules.game.useGame.getState().level!;
  for (const answer of level.answers) await modules.renderer.act(async () => {
    const disk = tree.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'LetterDisk')[0];
    expect(disk.props.onWord(answer.word)).toBe('grid');
  });
  expect(analyticsEvents('puzzle_completed')).toHaveLength(1);
  const records = mockReport.mock.calls.map(([name, value]) => ({ event_name: name, event_json: value,
    appmetrica_device_id: '18446744073709551615', installation_id: 'fixture_install' }));
  const analyze = require('../../../scripts/analyze-help-funnel.cjs').createHelpExperimentAnalysisContext;
  const report = analyze(records, { asOf: '2026-11-18T00:00:00Z', timezone: 'UTC+03:00', source: 'synthetic' }).analyzeScope({
    experimentId: declared.config.experimentId, eligibilityVersion: declared.config.eligibilityVersion,
    phase: 'trial', eligibilityEpoch: declared.config.trial.eligibilityEpoch, allocationVersion: declared.config.trial.allocationVersion,
    enrollmentFrom: declared.config.trial.enrollmentFrom, enrollmentToExclusive: declared.config.trial.enrollmentToExclusive, primaryWindowMinutes: 10,
    trialPlanFingerprint: helpExperimentPlanFingerprint(declared.config) });
  expect(report.firstClaims.valid).toBe(1); expect(report.assignments.total).toBe(1);
  expect(report.primary.total.reasons).toEqual({});
  expect(report.primary.total).toMatchObject({ matureN: 1, successes: 1, unknownOutcomes: 0 });
  const publicResult = JSON.stringify(report); expect(publicResult).not.toContain(flow.id); expect(publicResult).not.toContain(flow.attemptId);
});

test('a replayed puzzle exports known prior completion before any currency action', async () => {
  const modules = gameModules(); const tree = await mountGame(modules);
  const state = modules.levels.useLevels.getState();
  await modules.renderer.act(async () => { modules.levels.useLevels.setState({ completed: [...state.completed, 6] }); });
  const { flow } = await requestLetter(modules, tree);
  expect(flow.previouslyCompleted).toBe(true);
  expect(analyticsEvents('hint_requested')[0]).toMatchObject({ origin_interaction_id: flow.id,
    previously_completed: true, is_available: true, already_owned: false, displayed_cost: 50, balance: 20 });
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(hintDebits(modules)).toEqual([]);
});

beforeEach(() => {
  mockLegacyAssignedPresentation = true; mockHelpController = null;
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  jest.setSystemTime(new Date('2026-11-03T09:00:00Z'));
  mockParams = { mode: 'normal' };
  mockReport.mockClear(); mockRouter.push.mockClear(); mockRouter.replace.mockClear(); mockRouter.back.mockClear();
  mockRouter.setParams.mockReset().mockImplementation((params) => { mockParams = { ...mockParams, ...params }; });
  mockShowRewarded.mockClear();
  mockUpdatesEnabled = false; mockUpdateAvailable = true; mockUpdateOffer.mockReset().mockResolvedValue({ result: 'cancelled', reason: 'declined' });
  mockUpdateRewardedGuard.mockReset().mockResolvedValue(false); mockCampaignReview.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  for (const tree of mounted.keys()) unmountGame(tree);
  jest.restoreAllMocks(); jest.useRealTimers();
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: true });
});

test('explicit insufficient letter applies one earned hint to its exact origin without crediting or debiting coins', async () => {
  const modules = gameModules(); const tree = await mountGame(modules);
  expect(tree.root.findAllByProps({ testID: 'game-content' })[0].props.importantForAccessibility).toBe('auto');
  const attemptId = modules.game.useGame.getState().snapshot!.attemptId;
  const { selected, flow } = await requestLetter(modules, tree);
  expect(flow).toMatchObject({ attemptId, levelId: 6, requestedHint: 'letter', displayedCost: 50, balance: 20, status: 'requested' });
  expect(JSON.parse(modules.saved.storage.getString(modules.saved.KEYS.helpFlows)!)[flow.id].attemptId).toBe(attemptId);
  expect(selected.canWatchAd).toBe(true);
  expect(selected.helpContext).toMatchObject({ origin_interaction_id: flow.id, attemptId, entry_source: 'no_coins' });
  expect(selected.routeFocused).toBe(true);
  expect(selected.focusedOffer).toBe(true);
  expect(analyticsEvents('hint_requested')[0]).toMatchObject({ interaction_id: flow.id,
    origin_interaction_id: flow.id, is_available: true, previously_completed: false, displayed_cost: 50, balance: 20 });
  expect(analyticsEvents('hint_rejected')[0]).toMatchObject({ interaction_id: flow.id,
    reason: 'insufficient_coins', is_available: true, previously_completed: false });
  const background = tree.root.findAllByProps({ testID: 'game-content' })[0];
  expect(background.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(background.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'NoCoinsModal')).toHaveLength(0);
  await modules.renderer.act(async () => { await selected.onWatchAd('tap:rewarded', 'modal:coins'); });
  expect(mockShowRewarded).toHaveBeenCalledTimes(1);
  expect(mockShowRewarded.mock.calls[0][1]?.receipt?.flowContext).toMatchObject({ origin_interaction_id: flow.id, attemptId,
    requested_hint: 'letter', interaction_id: 'tap:rewarded', modal_id: 'modal:coins', displayed_cost: 50, balance: 20 });
  const rewardId = mockShowRewarded.mock.calls[0][1]!.rewardId;
  expect(mockShowRewarded.mock.calls[0][1]!.receipt).toMatchObject({ kind: 'hint', amount: 1 });
  expect(modules.currency.useCurrency.getState().getTransaction(rewardId)).toBeNull();
  expect(analyticsEvents('wallet_transaction').filter((entry) => entry.rewardId === rewardId)).toEqual([]);
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(hintDebits(modules)).toEqual([]);
  const filledAfterReward = { ...modules.game.useGame.getState().play!.filled };
  await modules.renderer.act(async () => {
    const confirmation = mockShowRewarded.mock.calls[0][1]!;
    expect(confirmation.persistGrant(rewardId)).toBe(true);
    selected.onApplyHint?.('tap:stale', 'modal:closed');
    selected.onApplyHint?.('tap:duplicate', 'modal:closed');
  });
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(modules.game.useGame.getState().play!.filled).toEqual(filledAfterReward);
  expect(hintDebits(modules)).toEqual([]);
  expect(tree.root.findAllByProps({ testID: 'game-content' })[0].props.importantForAccessibility).toBe('auto');
  expect(analyticsEvents('help_used')).toEqual([expect.objectContaining({ charged_amount: 0, paidWith: 'free',
    origin_interaction_id: flow.id, interaction_id: 'tap:rewarded', modal_id: 'modal:coins', attemptId })]);
  expect(analyticsEvents('help_used')[0]).not.toHaveProperty('transaction_id');
  expect(modules.flows.getHelpFlow(flow.id)?.status).toBe('applied');
  expect(modules.game.useGame.getState().snapshot?.attemptId).toBe(attemptId);
  expect(modal(tree)).toBeUndefined();
});

test('closing a rewarded video without earned leaves the requested hint and wallet unchanged', async () => {
  mockShowRewarded.mockResolvedValueOnce('dismissed');
  const modules = gameModules(); const tree = await mountGame(modules);
  const { selected, flow } = await requestLetter(modules, tree);
  const filledBefore = { ...modules.game.useGame.getState().play!.filled };
  await modules.renderer.act(async () => { await selected.onWatchAd('cancel:reward', 'cancel:modal'); });
  expect(mockShowRewarded).toHaveBeenCalledTimes(1);
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(0);
  expect(modules.game.useGame.getState().play!.filled).toEqual(filledBefore);
  expect(modules.rewardedHints.hasEarnedRewardedHint(flow.id)).toBe(false);
  expect(modules.rewardedHints.rewardedHintCountForDay()).toBe(0);
  expect(analyticsEvents('help_used')).toEqual([]);
  expect(modal(tree)).toMatchObject({ originInteractionId: flow.id, currentCoins: 20, earned: false });
});

test('the actual focused offer exposes only the selected rewarded hint and refusal, with no wheel or coin offer', async () => {
  const modules = gameModules(); const gameTree = await mountGame(modules);
  const { selected } = await requestLetter(modules, gameTree);
  let finish!: () => void;
  const watch = jest.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const wheel = jest.fn(), close = jest.fn();
  let offer!: ReactTestRenderer;
  await modules.renderer.act(async () => {
    offer = modules.renderer.create(modules.React.createElement(modules.actualNoCoins, {
      ...selected, onWatchAd: watch, onWheel: wheel, onFreeWheel: wheel, onShop: jest.fn(), onClose: close,
    }));
  });
  try {
    const buttons = offer.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'Button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.children).toBe('Да, за рекламу');
    expect(buttons[0].props.icon).toBe('play');
    const text = offer.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'Text')
      .map((node) => String(node.props.children)).join(' ');
    expect(text).toContain('Подсказка без монет?');
    expect(text).not.toMatch(/Колесо|\+60/);
    await modules.renderer.act(async () => { buttons[0].props.onPress(); buttons[0].props.onPress(); });
    expect(watch).toHaveBeenCalledTimes(1);
    expect(wheel).not.toHaveBeenCalled();
    await modules.renderer.act(async () => { finish(); });
    const decline = offer.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLabel === 'Не сейчас')[0];
    await modules.renderer.act(async () => { decline.props.onPress(); });
    expect(close).toHaveBeenCalledTimes(1);
  } finally { modules.renderer.act(() => offer.unmount()); }
});

test('an earned callback captured on an old attempt never applies help to a newer puzzle', async () => {
  let finish!: () => void;
  mockShowRewarded.mockImplementationOnce(async (_placement, confirmation) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    expect(confirmation?.persistGrant(confirmation.rewardId)).toBe(true);
    return 'rewarded';
  });
  const modules = gameModules(); const tree = await mountGame(modules);
  const { selected, flow } = await requestLetter(modules, tree);
  let watching!: Promise<void>;
  await modules.renderer.act(async () => { watching = selected.onWatchAd('stale:reward', 'stale:modal'); });
  expect(mockShowRewarded).toHaveBeenCalledTimes(1);
  await modules.renderer.act(async () => { modules.game.useGame.getState().start(modules.levels.loadGlobalLevel(7)!, 'normal'); });
  const newer = modules.game.useGame.getState().snapshot!.attemptId;
  expect(newer).not.toBe(flow.attemptId);
  const newerFilled = { ...modules.game.useGame.getState().play!.filled };
  await modules.renderer.act(async () => { finish(); await watching; });
  expect(modules.game.useGame.getState().snapshot!.attemptId).toBe(newer);
  expect(modules.game.useGame.getState().play!.filled).toEqual(newerFilled);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(0);
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.rewardedHints.hasEarnedRewardedHint(flow.id)).toBe(true);
  expect(modules.rewardedHints.getEarnedRewardedHintFlow(flow.attemptId)?.id).toBe(flow.id);
  expect(analyticsEvents('help_used')).toEqual([]);
});

test('108 coins buy a 50-coin letter directly without offering a rewarded video', async () => {
  const modules = gameModules(6, 108); const tree = await mountGame(modules);
  await modules.renderer.act(async () => { hintAction(tree, 'Буква')(); });
  expect(modules.currency.useCurrency.getState().coins).toBe(58);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(hintDebits(modules)).toHaveLength(1);
  expect(modal(tree)).toBeUndefined();
  expect(mockShowRewarded).not.toHaveBeenCalled();
  expect(analyticsEvents('help_used')).toEqual([expect.objectContaining({
    charged_amount: 50, paidWith: 'coins', balance_before: 108, balance_after: 58,
  })]);
});

test('a fresh level welcome overlays the board without resizing the grid or letter disk and does not replay on resume', async () => {
  const modules = gameModules(6); let tree = await mountGame(modules);
  const attemptId = modules.game.useGame.getState().snapshot!.attemptId;
  await modules.renderer.act(async () => {
    tree.root.findAllByProps({ testID: 'game-play-area' })[0].props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 480 } },
    });
  });
  const note = tree.root.findAllByProps({ testID: 'level-start-note' })[0];
  expect(note).toBeDefined();
  expect(note.props.accessibilityLabel).toMatch(/^\d+% игроков прошли этот уровень\. (А вы\?|Примете вызов\?)$/);
  const overlays = tree.root.findAll((node) => typeof node.type === 'string' && node.props.pointerEvents === 'none'
    && node.props.style?.position === 'absolute'
    && node.findAllByProps({ testID: 'level-start-note' }).length > 0);
  expect(overlays).toHaveLength(1);
  expect(overlays[0].findAllByProps({ testID: 'level-start-note' }).length).toBeGreaterThan(0);
  const geometry = () => ({
    gridMaxHeight: tree.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'CrosswordGrid')[0].props.maxHeight,
    diskSize: tree.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'LetterDisk')[0].props.size,
    playAreaHeight: tree.root.findAllByProps({ testID: 'game-play-scroll' })[0].props.contentContainerStyle.height,
  });
  const before = geometry();
  expect(before.gridMaxHeight).toBeGreaterThan(0);
  expect(before.diskSize).toBeGreaterThan(0);
  await modules.renderer.act(async () => { jest.advanceTimersByTime(3_201); });
  expect(tree.root.findAllByProps({ testID: 'level-start-note' })).toHaveLength(0);
  expect(geometry()).toEqual(before);
  expect(modules.game.useGame.getState().snapshot!.attemptId).toBe(attemptId);
  unmountGame(tree);
  tree = await mountGame(modules);
  expect(modules.game.useGame.getState().snapshot!.attemptId).toBe(attemptId);
  expect(tree.root.findAllByProps({ testID: 'level-start-note' })).toHaveLength(0);
});

test('a pending rewarded show blocks word and hint input until its frozen hint is earned', async () => {
  let finish!: () => void;
  mockShowRewarded.mockImplementationOnce(async (_placement, confirmation) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    expect(confirmation?.persistGrant(confirmation.rewardId)).toBe(true);
    return 'rewarded';
  });
  const modules = gameModules(); const tree = await mountGame(modules);
  const { selected, flow } = await requestLetter(modules, tree);
  const filledBefore = { ...modules.game.useGame.getState().play!.filled };
  const diskBefore = [...modules.game.useGame.getState().disk];
  const word = modules.game.useGame.getState().level!.answers[0].word;
  let watching!: Promise<void>;
  await modules.renderer.act(async () => { watching = selected.onWatchAd('pending:reward', 'pending:modal'); });
  expect(mockShowRewarded).toHaveBeenCalledTimes(1);
  await modules.renderer.act(async () => {
    const disk = tree.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'LetterDisk')[0];
    expect(disk.props.onWord(word)).toBe('blocked');
    disk.props.onShuffle();
    hintAction(tree, 'Буква')();
    hintAction(tree, 'Наводка')();
    await selected.onWatchAd('pending:duplicate', 'pending:modal');
  });
  expect(modules.game.useGame.getState().snapshot!.attemptId).toBe(flow.attemptId);
  expect(modules.game.useGame.getState().play!.filled).toEqual(filledBefore);
  expect(modules.game.useGame.getState().disk).toEqual(diskBefore);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(0);
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(Object.values(modules.flows.useHelpFlows.getState().flows)).toHaveLength(1);
  expect(mockShowRewarded).toHaveBeenCalledTimes(1);
  await modules.renderer.act(async () => { finish(); await watching; });
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.game.useGame.getState().snapshot!.attemptId).toBe(flow.attemptId);
  expect(modal(tree)).toBeUndefined();
});

test('free wheel choice persists the selected help before navigation and does not buy a letter', async () => {
  const modules = gameModules(); const tree = await mountGame(modules);
  const { selected, flow } = await requestLetter(modules, tree);
  expect(selected.canFreeSpin).toBe(true);
  await modules.renderer.act(async () => { selected.onFreeWheel('tap:free-wheel', 'modal:coins'); });
  expect(mockRouter.setParams).toHaveBeenCalledWith({ helpFlowId: flow.id });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/wheel', params: { helpFlowId: flow.id, source: 'no_coins',
    entryInteractionId: 'tap:free-wheel', modalId: 'modal:coins' } });
  expect(modules.wheel.useWheel.getState().pendingSpin?.flowContext).toMatchObject({ origin_interaction_id: flow.id,
    attemptId: flow.attemptId, requested_hint: 'letter', interaction_id: 'tap:free-wheel', modal_id: 'modal:coins',
    displayed_cost: 50, balance: 20, entry_source: 'no_coins' });
  expect(modules.flows.getHelpFlow(flow.id)).toMatchObject({ attemptId: flow.attemptId, displayedCost: 50, balance: 20 });
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(0);
  expect(hintDebits(modules)).toEqual([]);
  expect(mockShowRewarded).not.toHaveBeenCalled();
});

test('control return keeps the original help origin when the player uses the normal hint button', async () => {
  mockLegacyAssignedPresentation = false;
  const modules = gameModules(6, 30); let tree = await mountGame(modules);
  const attemptId = modules.game.useGame.getState().snapshot!.attemptId;
  await modules.renderer.act(async () => { hintAction(tree, 'Буква')(); });
  const selected = modal(tree);
  expect(selected).toMatchObject({ priceCoins: 50, currentCoins: 30 });
  const origin = modules.flows.getHelpFlow(selected.originInteractionId)!;
  // Freeze the control fixture before entering the wheel. Assignment itself is outside this UI test.
  const control = { ...origin, uxVariant: 'control' as const };
  await modules.renderer.act(async () => {
    const flows = { ...modules.flows.useHelpFlows.getState().flows, [origin.id]: control };
    modules.saved.storage.set(modules.saved.KEYS.helpFlows, JSON.stringify(flows));
    modules.flows.useHelpFlows.setState({ flows });
  });
  expect(modal(tree).uxVariant).toBe('control');
  await modules.renderer.act(async () => { modal(tree).onWheel('tap:control-wheel', 'modal:control'); });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/wheel', params: { helpFlowId: origin.id,
    source: 'no_coins', entryInteractionId: 'tap:control-wheel', modalId: 'modal:control' } });
  unmountGame(tree);
  // Fifty is a real wheel sector. The persisted grant is already confirmed before returning.
  const rewardId = 'wheel:control-return';
  expect(modules.currency.useCurrency.getState().addOnce(rewardId, 'coins', 50, {
    ...modules.flows.helpFlowProperties(control), interaction_id: 'tap:control-spin', modal_id: 'modal:control',
  })).toBe(true);
  expect(modules.currency.useCurrency.getState().coins).toBe(80);
  mockParams = { mode: 'normal', helpFlowId: origin.id, source: 'help_return' };
  tree = await mountGame(modules);
  expect(modules.game.useGame.getState().snapshot?.attemptId).toBe(attemptId);
  expect(modal(tree)).toBeUndefined();
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(0);
  expect(analyticsEvents('help_used')).toEqual([]);
  expect(Object.keys(modules.flows.useHelpFlows.getState().flows)).toEqual([origin.id]);
  await modules.renderer.act(async () => { hintAction(tree, 'Буква')(); });
  expect(modules.currency.useCurrency.getState().coins).toBe(30);
  expect(modules.game.useGame.getState().snapshot).toMatchObject({ attemptId, hintsUsed: ['bulb'] });
  expect(Object.keys(modules.flows.useHelpFlows.getState().flows)).toEqual([origin.id]);
  expect(modules.flows.getHelpFlow(origin.id)).toMatchObject({ status: 'applied', uxVariant: 'control' });
  expect(hintDebits(modules)).toHaveLength(1);
  const debit = modules.currency.useCurrency.getState().getTransaction(hintDebits(modules)[0])!;
  expect(debit).toMatchObject({ delta: -50, balanceBefore: 80, balanceAfter: 30,
    context: { origin_interaction_id: origin.id, attemptId, entry_source: 'game_help' } });
  const hintRequest = analyticsEvents('hint_requested').slice(-1)[0];
  expect(hintRequest).toMatchObject({ origin_interaction_id: origin.id, attemptId, displayed_cost: 50, balance: 80 });
  expect(hintRequest.interaction_id).not.toBe(origin.id);
  expect(analyticsEvents('help_used')).toEqual([expect.objectContaining({ transaction_id: debit.id,
    origin_interaction_id: origin.id, interaction_id: hintRequest.interaction_id,
    attemptId, charged_amount: 50, balance_before: 80, balance_after: 30 })]);
});

test.each([false, true])('a closed legacy wheel return cannot spend through a stale apply; new request works when route clear fails=%s', async (routeClearFails) => {
  const modules = gameModules(); const tree = await mountGame(modules);
  const { flow } = await requestLetter(modules, tree);
  // A voluntary wheel grant remains coins. Preserve the legacy return guard
  // without treating the new earned-hint action as a +60 coin offer.
  await modules.renderer.act(async () => {
    expect(modules.currency.useCurrency.getState().addOnce('wheel:close-return', 'coins', 50)).toBe(true);
    modules.flows.markHelpFlowReturned(flow.id);
  });
  const returned = modal(tree);
  const staleApply = returned.onApplyHint!;
  expect(modules.currency.useCurrency.getState().coins).toBe(70);
  const write = modules.saved.storage.set.bind(modules.saved.storage);
  jest.spyOn(modules.saved.storage, 'set').mockImplementation((key, value) => {
    if (key === modules.saved.KEYS.helpFlows && typeof value === 'string' && JSON.parse(value)[flow.id]?.status === 'closed') {
      throw new Error('optional close metadata failed');
    }
    return write(key, value);
  });
  if (routeClearFails) mockRouter.setParams.mockImplementation((params) => {
    if (params.helpFlowId === undefined) throw new Error('optional route clear failed');
    mockParams = { ...mockParams, ...params };
  });
  await modules.renderer.act(async () => { returned.onClose(); });
  expect(modal(tree)).toBeUndefined();
  expect(modules.flows.getHelpFlow(flow.id)?.status).toBe('returned');
  await modules.renderer.act(async () => { staleApply('tap:stale', 'modal:closed'); staleApply('tap:stale-repeat', 'modal:closed'); });
  expect(modules.currency.useCurrency.getState().coins).toBe(70);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(0);
  expect(hintDebits(modules)).toEqual([]);
  expect(analyticsEvents('help_used')).toEqual([]);
  await modules.renderer.act(async () => { hintAction(tree, 'Буква')(); });
  const flows = Object.values(modules.flows.useHelpFlows.getState().flows);
  expect(flows).toHaveLength(2);
  const fresh = flows.find((item) => item.id !== flow.id)!;
  expect(fresh).toMatchObject({ attemptId: flow.attemptId, requestedHint: 'letter', status: 'applied' });
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(hintDebits(modules)).toHaveLength(1);
  const debit = modules.currency.useCurrency.getState().getTransaction(hintDebits(modules)[0])!;
  expect(debit.context?.origin_interaction_id).toBe(fresh.id);
  expect(analyticsEvents('help_used')).toEqual([expect.objectContaining({ origin_interaction_id: fresh.id,
    transaction_id: debit.id, charged_amount: 50, balance_before: 70, balance_after: 20 })]);
  expect(modules.flows.getHelpFlow(flow.id)?.status).toBe('returned');
});

test('semantic classification failure retries its original paid origin once and joins the committed debit', async () => {
  const modules = gameModules(6, 60); const tree = await mountGame(modules);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const attemptId = modules.game.useGame.getState().snapshot!.attemptId;
  const write = modules.saved.storage.set.bind(modules.saved.storage);
  const failure = jest.spyOn(modules.saved.storage, 'set').mockImplementation((key, value) => {
    if (key === modules.saved.KEYS.gameCurrentNormal && typeof value === 'string' && JSON.parse(value).semanticHelpUsed) {
      throw new Error('classification write failed');
    }
    return write(key, value);
  });
  await modules.renderer.act(async () => { hintAction(tree, 'Наводка')(); });
  const flows = Object.values(modules.flows.useHelpFlows.getState().flows);
  expect(flows).toHaveLength(1);
  const flow = flows[0];
  expect(flow).toMatchObject({ attemptId, requestedHint: 'semantic', displayedCost: 30, balance: 60, status: 'requested' });
  const debits = Object.keys(modules.currency.useCurrency.getState().appliedRewards).filter((id) => id.startsWith('semantic-clue:'));
  expect(debits).toHaveLength(1);
  const transaction = modules.currency.useCurrency.getState().getTransaction(debits[0])!;
  expect(transaction).toMatchObject({ delta: -30, balanceBefore: 60, balanceAfter: 30,
    context: { origin_interaction_id: flow.id, attemptId } });
  expect(modules.game.useGame.getState().snapshot?.semanticHelpUsed).not.toBe(true);
  expect(analyticsEvents('help_used')).toEqual([]);
  expect(warning).toHaveBeenCalledWith('[game] clue save deferred', expect.objectContaining({ message: 'classification write failed' }));
  expect(modal(tree)).toBeUndefined();
  const retryButton = tree.root.findAll((node) => typeof node.type === 'string'
    && (node.type as string) === 'Button' && node.props.children === 'Повторить')[0];
  expect(retryButton).toBeDefined();
  failure.mockRestore();
  jest.advanceTimersByTime(1000);
  await modules.renderer.act(async () => { retryButton.props.onPress(); retryButton.props.onPress(); });
  expect(modules.currency.useCurrency.getState().coins).toBe(30);
  expect(Object.keys(modules.currency.useCurrency.getState().appliedRewards).filter((id) => id.startsWith('semantic-clue:'))).toEqual(debits);
  expect(Object.values(modules.flows.useHelpFlows.getState().flows)).toHaveLength(1);
  expect(modules.flows.getHelpFlow(flow.id)?.status).toBe('applied');
  expect(modules.game.useGame.getState().snapshot).toMatchObject({ attemptId, semanticHelpUsed: true });
  expect(analyticsEvents('wallet_transaction').filter((entry) => entry.delta === -30)).toHaveLength(1);
  expect(analyticsEvents('help_used')).toEqual([expect.objectContaining({ transaction_id: transaction.id,
    origin_interaction_id: flow.id, attemptId, displayed_cost: 0, charged_amount: 30,
    balance_before: 60, balance_after: 30, already_owned: true })]);
  const linked = analyticsEvents('help_used')[0];
  expect(linked.interaction_id).not.toBe(transaction.context?.interaction_id);
  expect(JSON.stringify(mockReport.mock.calls)).not.toContain(debits[0]);
});

test('failed optional applied-flow metadata cannot repeat a committed letter after remount', async () => {
  const modules = gameModules(); let tree = await mountGame(modules);
  const { selected, flow } = await requestLetter(modules, tree);
  const write = modules.saved.storage.set.bind(modules.saved.storage);
  const failure = jest.spyOn(modules.saved.storage, 'set').mockImplementation((key, value) => {
    if (key === modules.saved.KEYS.helpFlows && typeof value === 'string' && JSON.parse(value)[flow.id]?.status === 'applied') {
      throw new Error('optional flow metadata save failed');
    }
    return write(key, value);
  });
  await modules.renderer.act(async () => { await selected.onWatchAd(); });
  expect(mockShowRewarded).toHaveBeenCalledTimes(1);
  await modules.renderer.act(async () => { selected.onApplyHint?.(); selected.onApplyHint?.(); });
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(['requested', 'returned']).toContain(modules.flows.getHelpFlow(flow.id)?.status);
  expect(modules.flows.currentHelpQuote(modules.flows.getHelpFlow(flow.id)!).helpAvailable).toBe(false);
  failure.mockRestore();
  unmountGame(tree);
  mockParams = { mode: 'normal', helpFlowId: flow.id, source: 'help_return' };
  tree = await mountGame(modules);
  expect(modal(tree)).toBeUndefined();
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(hintDebits(modules)).toHaveLength(0);
  expect(mockShowRewarded).toHaveBeenCalledTimes(1);
  expect(modules.game.useGame.getState().snapshot?.attemptId).toBe(flow.attemptId);
});

test.each([false, true])('failed applied-flow metadata cannot strand normal Next when route clearing fails=%s', async (routeClearFails) => {
  const modules = gameModules(); const tree = await mountGame(modules);
  const { selected, flow } = await requestLetter(modules, tree);
  if (routeClearFails) mockRouter.setParams.mockImplementation((params) => {
    if (params.helpFlowId === undefined) throw new Error('optional route update failed');
    mockParams = { ...mockParams, ...params };
  });
  const write = modules.saved.storage.set.bind(modules.saved.storage);
  jest.spyOn(modules.saved.storage, 'set').mockImplementation((key, value) => {
    if (key === modules.saved.KEYS.helpFlows && typeof value === 'string'
      && ['applied', 'closed'].includes(JSON.parse(value)[flow.id]?.status)) throw new Error('optional flow metadata save failed');
    return write(key, value);
  });
  await modules.renderer.act(async () => { await selected.onWatchAd(); });
  expect(mockShowRewarded).toHaveBeenCalledTimes(1);
  await modules.renderer.act(async () => { selected.onApplyHint?.(); selected.onApplyHint?.(); });
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(hintDebits(modules)).toHaveLength(0);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(['requested', 'returned']).toContain(modules.flows.getHelpFlow(flow.id)?.status);
  if (routeClearFails) expect(mockParams.helpFlowId).toBe(flow.id);
  const originLevel = modules.game.useGame.getState().level!;
  for (const answer of originLevel.answers) {
    if (modules.game.useGame.getState().snapshot!.solvedWords.includes(answer.word)) continue;
    await modules.renderer.act(async () => {
      const disk = tree.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'LetterDisk')[0];
      expect(disk.props.onWord(answer.word)).toBe('grid');
    });
  }
  expect(modules.game.useGame.getState().completion.status).toBe('reward_claimed');
  await modules.renderer.act(async () => { jest.advanceTimersByTime(400); });
  const result = tree.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'LevelComplete')[0];
  expect(result).toBeDefined();
  const balanceAfterWin = modules.currency.useCurrency.getState().coins;
  let continued!: boolean;
  await modules.renderer.act(async () => { continued = await result.props.onNext(); });
  expect(continued).toBe(true);
  expect(modules.game.useGame.getState().level?.globalId).toBe(7);
  expect(modules.game.useGame.getState().snapshot?.attemptId).not.toBe(flow.attemptId);
  expect(modules.persistence.loadGameSnapshot('normal')?.globalLevel).toBe(7);
  expect(modules.game.useGame.getState().completion.status).toBe('playing');
  expect(tree.root.findAll((node) => typeof node.type === 'string' && node.props.children === 'Исходная попытка недоступна')).toHaveLength(0);
  expect(modules.currency.useCurrency.getState().coins).toBe(balanceAfterWin);
  expect(hintDebits(modules)).toHaveLength(0);
  expect(['requested', 'returned']).toContain(modules.flows.getHelpFlow(flow.id)?.status);
  if (routeClearFails) expect(mockParams.helpFlowId).toBe(flow.id);
});

test('cold helpFlow route restores the saved origin level and attempt while route progress points elsewhere', async () => {
  const modules = gameModules(); let tree = await mountGame(modules);
  const { flow } = await requestLetter(modules, tree);
  unmountGame(tree);
  modules.levels.useLevels.setState({ currentLevel: 20 });
  modules.game.useGame.setState({ level: null, play: null, snapshot: null, disk: [], hintsUsed: [], mistakes: 0, completion: { status: 'playing' } });
  modules.flows.useHelpFlows.setState({ flows: JSON.parse(modules.saved.storage.getString(modules.saved.KEYS.helpFlows)!) });
  mockParams = { mode: 'normal', helpFlowId: flow.id, source: 'help_return' };
  tree = await mountGame(modules);
  expect(modules.game.useGame.getState().level?.globalId).toBe(6);
  expect(modules.game.useGame.getState().snapshot?.attemptId).toBe(flow.attemptId);
  expect(modules.levels.useLevels.getState().currentLevel).toBe(20);
  expect(modal(tree)).toMatchObject({ attemptId: flow.attemptId, originInteractionId: flow.id, priceCoins: 50, currentCoins: 20 });
  expect(mockReport.mock.calls.filter(([name, envelope]) => name === 'puzzle_started' && (envelope as { levelId: number }).levelId === 20)).toEqual([]);
});

test('cold return to a restarted attempt on the same puzzle refuses the stale flow without another start or debit', async () => {
  const modules = gameModules(); let tree = await mountGame(modules);
  const { flow } = await requestLetter(modules, tree);
  unmountGame(tree);
  modules.persistence.clearGameSnapshot('normal');
  modules.game.useGame.getState().start(modules.levels.loadGlobalLevel(6)!, 'normal');
  const restartedAttempt = modules.game.useGame.getState().snapshot!.attemptId;
  expect(restartedAttempt).not.toBe(flow.attemptId);
  const persisted = modules.saved.storage.getString(modules.saved.KEYS.gameCurrentNormal);
  const startsBefore = mockReport.mock.calls.filter(([name]) => name === 'puzzle_started').length;
  mockParams = { mode: 'normal', helpFlowId: flow.id, source: 'help_return' };
  tree = await mountGame(modules);
  expect(modules.game.useGame.getState().snapshot?.attemptId).toBe(restartedAttempt);
  expect(modules.saved.storage.getString(modules.saved.KEYS.gameCurrentNormal)).toBe(persisted);
  expect(mockReport.mock.calls.filter(([name]) => name === 'puzzle_started')).toHaveLength(startsBefore);
  expect(modal(tree)).toBeUndefined();
  expect(tree.root.findAll((node) => typeof node.type === 'string' && node.props.children === 'Исходная попытка недоступна')).toHaveLength(1);
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(hintDebits(modules)).toEqual([]);
});

test('cold return with the same attempt and content version but incompatible fingerprint never overwrites that saved attempt', async () => {
  const modules = gameModules(); let tree = await mountGame(modules);
  const { flow } = await requestLetter(modules, tree);
  unmountGame(tree);
  const saved = JSON.parse(modules.saved.storage.getString(modules.saved.KEYS.gameCurrentNormal)!);
  expect(saved).toMatchObject({ attemptId: flow.attemptId, globalLevel: flow.levelId, contentVersion: flow.contentVersion });
  saved.levelFingerprint = 'same-version-incompatible-catalog-fingerprint';
  const incompatible = JSON.stringify(saved);
  modules.saved.storage.set(modules.saved.KEYS.gameCurrentNormal, incompatible);
  const startsBefore = mockReport.mock.calls.filter(([name]) => name === 'puzzle_started').length;
  mockParams = { mode: 'normal', helpFlowId: flow.id, source: 'help_return' };
  tree = await mountGame(modules);
  expect(modules.saved.storage.getString(modules.saved.KEYS.gameCurrentNormal)).toBe(incompatible);
  expect(modules.game.useGame.getState().snapshot?.attemptId).toBe(flow.attemptId);
  expect(mockReport.mock.calls.filter(([name]) => name === 'puzzle_started')).toHaveLength(startsBefore);
  expect(tree.root.findAll((node) => typeof node.type === 'string' && node.props.children === 'Исходная попытка недоступна')).toHaveLength(1);
  expect(modal(tree)).toBeUndefined();
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(0);
  expect(hintDebits(modules)).toEqual([]);
});

test('introductory free letter stays a direct action without a coin flow or debit', async () => {
  const modules = gameModules(3, 0); const tree = await mountGame(modules);
  const before = modules.currency.useCurrency.getState().coins;
  await modules.renderer.act(async () => { hintAction(tree, 'Буква')(); });
  expect(modules.game.useGame.getState().hintsUsed).toHaveLength(1);
  expect(modules.currency.useCurrency.getState().coins).toBe(before);
  expect(Object.keys(modules.flows.useHelpFlows.getState().flows)).toEqual([]);
  expect(modal(tree)).toBeUndefined();
  expect(mockShowRewarded).not.toHaveBeenCalled();
  expect(analyticsEvents('help_used')).toEqual([expect.objectContaining({ charged_amount: 0, paidWith: 'free', displayed_cost: 0 })]);
  expect(analyticsEvents('help_used')[0]).not.toHaveProperty('transaction_id');
});

test('an already purchased semantic clue reopens directly with no second debit or coin flow', async () => {
  const chipModules = gameModules(6, 60);
  const objectiveLevelId = Array.from({ length: 120 }, (_, index) => index + 6).find((id) => {
    const candidate = chipModules.levels.loadGlobalLevel(id);
    return candidate?.mechanic && candidate.mechanic !== 'classic';
  });
  expect(objectiveLevelId).toBeDefined();
  for (const [index, levelId] of [6, objectiveLevelId!].entries()) {
    const modules = index === 0 ? chipModules : gameModules(levelId, 60);
    const level = modules.levels.loadGlobalLevel(levelId)!;
    modules.game.useGame.getState().start(level, 'normal');
    const snapshot = modules.game.useGame.getState().snapshot!;
    expect(modules.hints.purchaseSemanticClue(`campaign:${levelId}`, snapshot.levelFingerprint, level.answers[0].word)).toBe('unlocked');
    const before = modules.currency.useCurrency.getState().coins;
    const tree = await mountGame(modules);
    if (index === 0) {
      const advertisedClue = tree.root.findAll((node) => typeof node.type === 'string'
        && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Наводка,'));
      expect(advertisedClue).toHaveLength(1);
      expect(advertisedClue[0].props.accessibilityLabel).toBe('Наводка, бесплатно');
    } else {
      const objective = tree.root.findAll((node) => typeof node.type === 'string'
        && ['LevelObjective', 'CompactBonusObjective'].includes(node.type as string))[0];
      expect(objective.props.cluePrice).toBe(0);
    }
    await modules.renderer.act(async () => { hintAction(tree, 'Наводка')(); });
    expect(modules.currency.useCurrency.getState().coins).toBe(before);
    expect(modules.game.useGame.getState().snapshot?.semanticHelpUsed).toBe(true);
    expect(Object.keys(modules.flows.useHelpFlows.getState().flows)).toEqual([]);
    expect(modal(tree)).toBeUndefined();
    const help = analyticsEvents('help_used').filter((entry) => entry.attemptId === snapshot.attemptId);
    expect(help).toEqual([expect.objectContaining({ charged_amount: 0, paidWith: 'owned', displayed_cost: 0 })]);
    expect(help[0]).not.toHaveProperty('transaction_id');
    expect(help[0]).not.toHaveProperty('origin_interaction_id');
    unmountGame(tree);
  }
  expect(mockShowRewarded).not.toHaveBeenCalled();
});

test('daily help return stays pinned to its original date and attempt after midnight and a newer daily starts', async () => {
  jest.setSystemTime(new Date('2026-11-03T20:55:00Z'));
  const modules = gameModules();
  const original = modules.daily.useDailyPuzzle.getState().getOrStartDaily()!;
  mockParams = { mode: 'daily', date: original.dateKey };
  let tree = await mountGame(modules);
  const { flow } = await requestLetter(modules, tree);
  expect(flow).toMatchObject({ mode: 'daily', dateKey: original.dateKey });
  unmountGame(tree);
  jest.setSystemTime(new Date('2026-11-04T00:10:00+03:00'));
  const newer = modules.daily.useDailyPuzzle.getState().getOrStartDaily()!;
  expect(newer.dateKey).not.toBe(original.dateKey);
  modules.game.useGame.getState().start(newer.level, 'daily', newer.dateKey);
  const newerAttempt = modules.game.useGame.getState().snapshot!.attemptId;
  mockParams = { mode: 'daily', date: newer.dateKey, helpFlowId: flow.id, source: 'help_return' };
  tree = await mountGame(modules);
  expect(modules.game.useGame.getState().snapshot).toMatchObject({ attemptId: flow.attemptId, dailyId: original.dateKey });
  expect(modal(tree)).toMatchObject({ attemptId: flow.attemptId, originInteractionId: flow.id });
  expect(modules.persistence.loadGameSnapshot('daily', undefined, newer.dateKey)?.attemptId).toBe(newerAttempt);
  expect(modules.currency.useCurrency.getState().coins).toBe(20);
  expect(hintDebits(modules)).toEqual([]);
});

async function savedUpdateResult() {
  mockUpdatesEnabled = true;
  const modules = gameModules(), stop = modules.updates.startUpdates(), tree = await mountGame(modules);
  const level = modules.game.useGame.getState().level!;
  for (const answer of level.answers) {
    await modules.renderer.act(async () => {
      const disk = tree.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'LetterDisk')[0];
      expect(disk.props.onWord(answer.word)).toBe('grid');
    });
  }
  expect(modules.game.useGame.getState().completion.status).toBe('reward_claimed');
  await modules.renderer.act(async () => { jest.advanceTimersByTime(400); });
  const result = tree.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'LevelComplete')[0];
  expect(result).toBeDefined();
  let action!: ReactTestRenderer;
  await modules.renderer.act(async () => { action = modules.renderer.create(result.props.secondaryAction); });
  const tap = () => action.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'Button'
    && node.props.children === 'Обновить игру')[0].props.onPress();
  return { modules, tree, action, result, tap, close: () => { modules.renderer.act(() => action.unmount()); stop(); unmountGame(tree); } };
}

test('actual UpdateAction reserves synchronously before Continue can advance, and cancellation restores the same saved result', async () => {
  let finish!: (result: FlowResult) => void;
  mockUpdateOffer.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const f = await savedUpdateResult();
  try {
    const attempt = f.modules.game.useGame.getState().snapshot!.attemptId;
    const balance = f.modules.currency.useCurrency.getState().coins;
    let continued: boolean | undefined;
    await f.modules.renderer.act(async () => {
      f.tap(); // No React render, Activity pause or SDK callback precedes this second tap.
      continued = await f.result.props.onNext();
    });
    expect(continued).toBe(false); expect(mockUpdateOffer).toHaveBeenCalledTimes(1);
    expect(f.modules.fullscreen.getFullscreenSnapshot().owner).toBe('update');
    expect(f.modules.game.useGame.getState().snapshot!.attemptId).toBe(attempt);
    expect(f.modules.game.useGame.getState().completion.status).toBe('reward_claimed');
    await f.modules.renderer.act(async () => { finish({ result: 'cancelled', reason: 'declined' }); });
    expect(f.modules.fullscreen.getFullscreenSnapshot().owner).toBeNull();
    expect(f.modules.currency.useCurrency.getState().coins).toBe(balance);
    await f.modules.renderer.act(async () => { continued = await f.result.props.onNext(); });
    expect(continued).toBe(true); expect(f.modules.game.useGame.getState().completion.status).toBe('playing');
    expect(f.modules.game.useGame.getState().snapshot!.attemptId).not.toBe(attempt);
    expect(mockCampaignReview).not.toHaveBeenCalled();
  } finally { f.close(); }
});

test('actual result action rechecks its captured attempt after asynchronous native guard, preserving a newer game', async () => {
  let unblock!: (busy: boolean) => void;
  mockUpdateRewardedGuard.mockReturnValueOnce(new Promise((resolve) => { unblock = resolve; }));
  const f = await savedUpdateResult();
  try {
    const oldAttempt = f.modules.game.useGame.getState().snapshot!.attemptId;
    await f.modules.renderer.act(async () => { f.tap(); });
    expect(f.modules.fullscreen.getFullscreenSnapshot().owner).toBe('update');
    await f.modules.renderer.act(async () => { f.modules.game.useGame.getState().start(f.modules.levels.loadGlobalLevel(7)!); });
    const newer = f.modules.game.useGame.getState().snapshot!.attemptId;
    expect(newer).not.toBe(oldAttempt);
    await f.modules.renderer.act(async () => { unblock(false); });
    expect(mockUpdateOffer).not.toHaveBeenCalled(); expect(f.modules.fullscreen.getFullscreenSnapshot().owner).toBeNull();
    expect(f.modules.game.useGame.getState().snapshot!.attemptId).toBe(newer);
    expect(f.modules.persistence.loadGameSnapshot('normal')?.attemptId).toBe(newer);
  } finally { f.close(); }
});

test('actual manual RuStore tap blocks same-task Continue before the native guard resolves and unlocks after refusal', async () => {
  mockUpdateAvailable = false;
  const f = await savedUpdateResult(); let unblock!: (busy: boolean) => void;
  mockUpdateRewardedGuard.mockReturnValueOnce(new Promise((resolve) => { unblock = resolve; }));
  try {
    const attempt = f.modules.game.useGame.getState().snapshot!.attemptId, coins = f.modules.currency.useCurrency.getState().coins;
    let continued: boolean | undefined;
    await f.modules.renderer.act(async () => {
      f.action.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'Button'
        && node.props.children === 'Открыть RuStore')[0].props.onPress();
      continued = await f.result.props.onNext();
    });
    expect(continued).toBe(false); expect(f.modules.fullscreen.getFullscreenSnapshot().owner).toBe('update');
    expect(f.modules.game.useGame.getState().snapshot!.attemptId).toBe(attempt);
    await f.modules.renderer.act(async () => { unblock(true); });
    expect(f.modules.fullscreen.getFullscreenSnapshot().owner).toBeNull(); expect(mockUpdateOffer).not.toHaveBeenCalled();
    expect(f.modules.currency.useCurrency.getState().coins).toBe(coins);
    await f.modules.renderer.act(async () => { continued = await f.result.props.onNext(); });
    expect(continued).toBe(true);
  } finally { f.close(); }
});

test('actual Menu refusal from the game unlocks the real LevelComplete controls after native cancellation', async () => {
  let finish!: (result: FlowResult) => void; mockUpdateOffer.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const f = await savedUpdateResult(); let widget!: ReactTestRenderer;
  try {
    await f.modules.renderer.act(async () => {
      const props = f.result.props as React.ComponentProps<Modules['actualLevelComplete']>;
      widget = f.modules.renderer.create(f.modules.React.createElement(f.modules.actualLevelComplete, { ...props, secondaryAction: null }));
    });
    await f.modules.renderer.act(async () => {
      f.tap(); widget.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'Pressable' && node.props.accessibilityRole === 'button')[0].props.onPress();
    });
    expect(mockRouter.replace).not.toHaveBeenCalled(); expect(f.modules.game.useGame.getState().completion.status).toBe('reward_claimed');
    await f.modules.renderer.act(async () => { finish({ result: 'cancelled', reason: 'declined' }); });
    expect(f.modules.fullscreen.getFullscreenSnapshot().owner).toBeNull();
    const next = widget.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'Button' && node.props.large === true)[0];
    expect(next.props.disabled).toBe(false);
    await f.modules.renderer.act(async () => { next.props.onPress(); });
    expect(f.modules.game.useGame.getState().completion.status).toBe('playing');
  } finally { if (widget) f.modules.renderer.act(() => widget.unmount()); f.close(); }
});

test('actual saved-result remount during native form retains exact-result prompt suppression after cancellation', async () => {
  let finish!: (result: FlowResult) => void; mockUpdateOffer.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const f = await savedUpdateResult(); let remount!: ReactTestRenderer;
  try {
    const attempt = f.modules.game.useGame.getState().snapshot!.attemptId, coins = f.modules.currency.useCurrency.getState().coins;
    await f.modules.renderer.act(async () => { f.tap(); });
    f.modules.renderer.act(() => f.action.unmount()); unmountGame(f.tree);
    remount = await mountGame(f.modules); await f.modules.renderer.act(async () => { jest.advanceTimersByTime(400); });
    const result = remount.root.findAll((node) => typeof node.type === 'string' && (node.type as string) === 'LevelComplete')[0];
    expect(f.modules.game.useGame.getState().snapshot!.attemptId).toBe(attempt);
    expect(await result.props.onNext()).toBe(false);
    await f.modules.renderer.act(async () => { finish({ result: 'cancelled', reason: 'declined' }); });
    let advanced: boolean | undefined; await f.modules.renderer.act(async () => { advanced = await result.props.onNext(); });
    expect(advanced).toBe(true); expect(mockCampaignReview).not.toHaveBeenCalled(); expect(f.modules.currency.useCurrency.getState().coins).toBe(coins);
  } finally { if (remount) unmountGame(remount); f.close(); }
});

test('a result-marker write failure opens no native form and does not strand the actual Game Continue action', async () => {
  const f = await savedUpdateResult(), write = f.modules.saved.storage.set.bind(f.modules.saved.storage);
  const failure = jest.spyOn(f.modules.saved.storage, 'set').mockImplementation((key, value) => {
    if (key === 'updates.result-attempt.v1') throw Error('marker_unwritable'); write(key, value);
  });
  try {
    const coins = f.modules.currency.useCurrency.getState().coins;
    await f.modules.renderer.act(async () => { f.tap(); });
    expect(mockUpdateOffer).not.toHaveBeenCalled(); expect(f.modules.fullscreen.getFullscreenSnapshot().owner).toBeNull();
    let advanced: boolean | undefined; await f.modules.renderer.act(async () => { advanced = await f.result.props.onNext(); });
    expect(advanced).toBe(true); expect(f.modules.currency.useCurrency.getState().coins).toBe(coins);
  } finally { failure.mockRestore(); f.close(); }
});
