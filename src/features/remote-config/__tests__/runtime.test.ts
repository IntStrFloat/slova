import { storage } from '@/core/storage';
import { DEFAULT_POLICY, getRuntimePolicy, resetRuntimePolicy } from '@/core/config/runtimePolicy';
import { startRemoteConfig, applyRemoteConfigAtSafePoint } from '../runtime';

const mockPreferences = new Set<() => void>();
const mockProfileListeners = new Set<() => void>();
const mockGameListeners = new Set<(state: typeof mockGameState) => void>();
let mockGameState: { play: object | null; completion: { status: string } } = { play: null, completion: { status: 'finished' } };
let mockEnabled = true;
let mockBuildEnabled = true;
const mockAssignment = { experiment_id: 'ad_delay', assignment_id: 'assignment_a', variant: 'candidate', allocation_version: 1 };
const mockInitialize = jest.fn<Promise<void>, []>(async () => {});
const mockNativeAllowed = jest.fn();
const mockFetch = jest.fn();
const mockContext = jest.fn();
const mockExposure = jest.fn<boolean, unknown[]>(() => true);
const mockJson = JSON.stringify({ schema_version: 1, config_version: 'runtime_v1', fetch_enabled: true,
  experiment_id: 'ad_delay', allocation_version: 1,
  variants: { control: { ads_interstitial_interval_seconds: 300 }, candidate: { ads_interstitial_interval_seconds: 600 } } });
jest.mock('../config', () => ({ get REMOTE_CONFIG_ENABLED() { return mockBuildEnabled; } }));

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  Object.defineProperty(actual, 'AppState', { configurable: true,
    value: { currentState: 'active', addEventListener: () => ({ remove: jest.fn() }) } });
  return actual;
});

jest.mock('@/features/analytics', () => ({
  isAnalyticsCollectionEnabled: () => mockEnabled, setAnalyticsContext: (...args: unknown[]) => mockContext(...args), track: jest.fn(),
  useAnalyticsPrefs: { subscribe: (listener: () => void) => { mockPreferences.add(listener); return () => mockPreferences.delete(listener); } },
}));
jest.mock('@/features/analytics/experiments', () => ({
  initializeAnalyticsExperiments: () => mockInitialize(), getAnalyticsExperimentAssignment: () => mockAssignment,
  hasStoredAnalyticsAssignment: () => true, exposeAnalyticsParameter: (...args: unknown[]) => mockExposure(...args),
}));
jest.mock('@/features/game/store', () => ({ useGame: {
  getState: () => mockGameState,
  subscribe: (listener: (state: typeof mockGameState) => void) => { mockGameListeners.add(listener); return () => mockGameListeners.delete(listener); },
} }));
jest.mock('@/features/profile', () => ({ useProfile: {
  getState: () => ({ profile: { userId: 'local_fixture' } }),
  subscribe: (listener: () => void) => { mockProfileListeners.add(listener); return () => mockProfileListeners.delete(listener); },
} }));
jest.mock('../../../../modules/rustore-remote-config', () => ({
  setRemoteConfigAllowed: (...args: unknown[]) => mockNativeAllowed(...args), fetchRemotePolicy: () => mockFetch(),
}));

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
let stop = () => {};
beforeEach(() => {
  storage.clearAll(); resetRuntimePolicy(); jest.clearAllMocks();
  mockEnabled = true; mockBuildEnabled = true; mockInitialize.mockResolvedValue(undefined);
  mockGameState = { play: null, completion: { status: 'finished' } };
  mockFetch.mockResolvedValue({ status: 'success', json: mockJson });
});
afterEach(async () => { stop(); await settle(); });

test('enabled application wiring fetches in background and stages until the saved safe boundary', async () => {
  mockGameState = { play: {}, completion: { status: 'playing' } };
  stop = startRemoteConfig(); await settle(); await settle();
  expect({ prefs: mockPreferences.size, profiles: mockProfileListeners.size, games: mockGameListeners.size, initialized: mockInitialize.mock.calls.length })
    .toEqual({ prefs: 1, profiles: 1, games: 1, initialized: 1 });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  expect(mockExposure).not.toHaveBeenCalled();
  mockGameState = { play: null, completion: { status: 'finished' } };
  applyRemoteConfigAtSafePoint();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  expect(mockContext).toHaveBeenLastCalledWith({ configVersion: 'runtime_v1' });
  mockEnabled = false; for (const listener of mockPreferences) listener();
  await settle();
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
  expect(mockNativeAllowed).toHaveBeenLastCalledWith(false);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('default off does not load identifiers or query native transport', async () => {
  mockBuildEnabled = false;
  stop = startRemoteConfig(); await settle();
  expect(mockInitialize).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled(); expect(mockNativeAllowed).not.toHaveBeenCalled();
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
});

test('a rejected initialization from an old mount cannot disable the newer active owner', async () => {
  let rejectOld!: (error: Error) => void;
  mockInitialize.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
  const oldStop = startRemoteConfig(); await settle(); oldStop();
  stop = startRemoteConfig(); await settle(); await settle();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  rejectOld(new Error('old lifecycle')); await settle();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  oldStop(); await settle();
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
});
