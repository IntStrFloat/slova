import { startSubscriptionAutoSync } from '../subscriptionAutoSync';

type Snapshot = { busy: boolean; error: string | null; hasPendingCheckout: boolean; needsMigration: boolean;
  status: { active: boolean; pendingPaymentId: string | null } | null; sync: jest.Mock<Promise<void>, []> };
type Profile = { busy: boolean; profile: { userId: string } | null };
let mockState: Snapshot;
let mockProfile: Profile;
let mockAppState: string | null;
let mockWeb: boolean;
let mockAppListener: (state: string) => void;
let mockUrlListener: (event: { url: string }) => void;
const mockBillingListeners = new Set<(state: Snapshot, previous: Snapshot) => void>();
const mockProfileListeners = new Set<(state: Profile, previous: Profile) => void>();
const mockRemoveApp = jest.fn();
const mockRemoveUrl = jest.fn();
let mockFetch: jest.Mock<Promise<void>, []>;

jest.mock('react-native', () => ({
  Platform: { OS: 'android', select: (options: Record<string, unknown>) => options.android ?? options.default },
  TurboModuleRegistry: { get: () => null },
  AppState: {
  get currentState() { return mockAppState; },
  addEventListener: (_event: string, listener: typeof mockAppListener) => {
    mockAppListener = listener; return { remove: mockRemoveApp };
  },
} }));
jest.mock('expo-linking', () => ({ addEventListener: (_event: string, listener: typeof mockUrlListener) => {
  mockUrlListener = listener; return { remove: mockRemoveUrl };
} }));
jest.mock('@/core/platform/yandexGames', () => ({ isYandexGamesBuild: () => mockWeb }));
jest.mock('../subscription', () => ({ useSubscription: {
  getState: () => mockState,
  subscribe: (listener: (state: Snapshot, previous: Snapshot) => void) => {
    mockBillingListeners.add(listener); return () => mockBillingListeners.delete(listener);
  },
} }));
jest.mock('@/features/profile', () => ({ useProfile: {
  getState: () => mockProfile,
  subscribe: (listener: (state: Profile, previous: Profile) => void) => {
    mockProfileListeners.add(listener); return () => mockProfileListeners.delete(listener);
  },
} }));

function setBilling(update: Partial<Snapshot>) {
  const previous = mockState; mockState = { ...mockState, ...update };
  mockBillingListeners.forEach((listener) => listener(mockState, previous));
}
function setProfile(update: Partial<Profile>) {
  const previous = mockProfile; mockProfile = { ...mockProfile, ...update };
  mockProfileListeners.forEach((listener) => listener(mockProfile, previous));
}
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
let dispose: (() => void) | undefined;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(1_800_000_000_000);
  mockWeb = false; mockAppState = 'active'; mockProfile = { busy: false, profile: { userId: 'owner' } };
  mockRemoveApp.mockClear(); mockRemoveUrl.mockClear();
  mockFetch = jest.fn(async () => {});
  mockState = { busy: false, error: null, hasPendingCheckout: false, needsMigration: false, status: null,
    sync: jest.fn(async () => {
      setBilling({ busy: true });
      try { await mockFetch(); } finally { setBilling({ busy: false }); }
    }) };
});
afterEach(() => { dispose?.(); dispose = undefined; mockBillingListeners.clear(); mockProfileListeners.clear(); jest.useRealTimers(); });

test('checks once on launch and checks again on resume without a payment button', async () => {
  dispose = startSubscriptionAutoSync(); await flush();
  expect(mockState.sync).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockState.sync).toHaveBeenCalledTimes(1);
  mockAppListener('background'); mockAppListener('active'); await flush();
  expect(mockState.sync).toHaveBeenCalledTimes(2);
});

test('polls a delayed payment until server activation, then stops', async () => {
  mockState.hasPendingCheckout = true;
  mockState.status = { active: false, pendingPaymentId: 'invoice' };
  mockFetch.mockImplementation(async () => {
    if (mockFetch.mock.calls.length === 3) setBilling({ hasPendingCheckout: false, status: { active: true, pendingPaymentId: null } });
  });
  dispose = startSubscriptionAutoSync(); await flush();
  await jest.advanceTimersByTimeAsync(6_000);
  expect(mockState.sync).toHaveBeenCalledTimes(3);
  expect(mockState.status?.active).toBe(true);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockState.sync).toHaveBeenCalledTimes(3);
});

test('waits for checkout to finish when returning from the browser during a busy action', async () => {
  mockState.busy = true; mockState.hasPendingCheckout = true;
  dispose = startSubscriptionAutoSync();
  mockAppListener('background'); mockAppListener('active');
  expect(mockState.sync).not.toHaveBeenCalled();
  setBilling({ busy: false }); await flush();
  expect(mockState.sync).toHaveBeenCalledTimes(1);
});

test('waits for bootstrap and synchronizes the new owner when it finishes', async () => {
  mockProfile = { busy: true, profile: null };
  dispose = startSubscriptionAutoSync();
  expect(mockState.sync).not.toHaveBeenCalled();
  setProfile({ busy: false, profile: { userId: 'new-owner' } }); await flush();
  expect(mockState.sync).toHaveBeenCalledTimes(1);
});

test('does not poll while backgrounded, even after an in-flight response', async () => {
  mockState.hasPendingCheckout = true;
  let finish!: () => void;
  mockFetch.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  dispose = startSubscriptionAutoSync(); mockAppListener('background'); finish(); await flush();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockState.sync).toHaveBeenCalledTimes(1);
  mockAppListener('active'); await flush();
  expect(mockState.sync).toHaveBeenCalledTimes(2);
});

test('URL triggers only an authenticated refresh and ignores fake payment success parameters', async () => {
  dispose = startSubscriptionAutoSync(); await flush();
  mockUrlListener({ url: 'slova://shop?paid=true&activeUntil=9999999999999' }); await flush();
  expect(mockState.sync).toHaveBeenCalledTimes(2);
  expect(mockState.status).toBeNull();
  mockUrlListener({ url: 'https://attacker.invalid/shop?paid=true' }); await flush();
  mockUrlListener({ url: 'slova://shopping' }); await flush();
  expect(mockState.sync).toHaveBeenCalledTimes(2);
});

test('an unresolved migration does not create a polling loop', async () => {
  mockState.hasPendingCheckout = true; mockState.needsMigration = true;
  dispose = startSubscriptionAutoSync(); await flush();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(mockState.sync).toHaveBeenCalledTimes(1);
});

test('offline failures back off and a later success is picked up automatically', async () => {
  mockState.hasPendingCheckout = true;
  mockFetch.mockImplementationOnce(async () => { setBilling({ error: 'network' }); })
    .mockImplementationOnce(async () => { setBilling({ error: 'network' }); })
    .mockImplementationOnce(async () => { setBilling({ error: null, hasPendingCheckout: false, status: { active: true, pendingPaymentId: null } }); });
  dispose = startSubscriptionAutoSync(); await flush();
  await jest.advanceTimersByTimeAsync(4_999); expect(mockState.sync).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1); expect(mockState.sync).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(10_000); expect(mockState.status?.active).toBe(true);
  await jest.advanceTimersByTimeAsync(30_000); expect(mockState.sync).toHaveBeenCalledTimes(3);
});

test('a slow request never overlaps another poll', async () => {
  mockState.hasPendingCheckout = true;
  let finish!: () => void;
  mockFetch.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  dispose = startSubscriptionAutoSync();
  await jest.advanceTimersByTimeAsync(30_000); expect(mockState.sync).toHaveBeenCalledTimes(1);
  finish(); await flush();
  await jest.advanceTimersByTimeAsync(10_000); expect(mockState.sync).toHaveBeenCalledTimes(2);
});

test('polling is bounded and a new foreground session starts a fresh check', async () => {
  mockState.hasPendingCheckout = true;
  dispose = startSubscriptionAutoSync(); await flush();
  await jest.advanceTimersByTimeAsync(11 * 60_000);
  const count = mockState.sync.mock.calls.length;
  expect(count).toBeGreaterThan(10); expect(count).toBeLessThan(45);
  await jest.advanceTimersByTimeAsync(60_000); expect(mockState.sync).toHaveBeenCalledTimes(count);
  mockAppListener('background'); mockAppListener('active'); await flush();
  expect(mockState.sync).toHaveBeenCalledTimes(count + 1);
});

test('dispose removes observers and prevents polls after an in-flight completion', async () => {
  mockState.hasPendingCheckout = true;
  let finish!: () => void;
  mockFetch.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  dispose = startSubscriptionAutoSync(); dispose(); dispose = undefined;
  finish(); await flush(); await jest.advanceTimersByTimeAsync(60_000);
  expect(mockState.sync).toHaveBeenCalledTimes(1);
  expect(mockBillingListeners.size).toBe(0); expect(mockProfileListeners.size).toBe(0);
  expect(mockRemoveApp).toHaveBeenCalledTimes(1); expect(mockRemoveUrl).toHaveBeenCalledTimes(1);
});

test('web game does not start native billing observers', async () => {
  mockWeb = true; dispose = startSubscriptionAutoSync(); await flush();
  expect(mockState.sync).not.toHaveBeenCalled(); expect(mockBillingListeners.size).toBe(0);
});
