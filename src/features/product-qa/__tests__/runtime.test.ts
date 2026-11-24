/* eslint-disable @typescript-eslint/no-require-imports */
import type { AdsProvider, RewardConfirmation, RewardedResult } from '@/features/monetization/types';
import type { NativeRewardReceipt } from '@/features/monetization/nativeRewardJournal';

let mockAds: AdsProvider;
let mockNativeReceipts: NativeRewardReceipt[] = [];
const mockAck = jest.fn(async (id: string) => { mockNativeReceipts = mockNativeReceipts.filter((value) => value.rewardId !== id); });
jest.mock('@/features/monetization/providers', () => ({ getAds: () => mockAds }));
jest.mock('@/features/monetization/nativeRewardJournal', () => ({
  ...jest.requireActual('@/features/monetization/nativeRewardJournal'),
  readNativeEarnedRewards: async () => [...mockNativeReceipts], acknowledgeNativeReward: (id: string) => mockAck(id),
}));
jest.mock('@/features/monetization/checkoutFullscreen', () => ({ openCheckoutConfirmation: jest.fn() }));
jest.mock('@/core/net', () => ({ ...jest.requireActual('@/core/net'), getBackend: jest.fn(() => { throw new Error('Unexpected QA backend request'); }) }));
jest.mock('@/core/native/appmetrica', () => ({ reportEvent: jest.fn(() => true), isAppMetricaAvailable: () => true, isAppMetricaTestDevice: () => true }));

function setup(saved?: [string, string][]) {
  const storage = require('@/core/storage') as typeof import('@/core/storage');
  storage.storage.clearAll();
  for (const [key, value] of saved ?? []) storage.storage.set(key, value);
  mockAds = { init: jest.fn(async () => {}), showInterstitial: jest.fn(async () => 'unavailable' as const),
    showRewarded: jest.fn(async () => 'unavailable' as const), isInterstitialReady: () => false, isRewardedReady: () => true,
    getRewardedState: () => 'ready', subscribeRewardedReady: () => () => {}, subscribeRewardedState: () => () => {} };
  let authorized = true;
  let complete = () => {};
  let dismiss = () => {};
  const showSimulation = jest.fn((onComplete: () => void, onDismiss: () => void) => { complete = onComplete; dismiss = onDismiss; });
  const currency = (require('@/features/currency') as typeof import('@/features/currency')).useCurrency;
  const wheel = require('@/features/wheel') as typeof import('@/features/wheel');
  const levels = require('@/features/levels') as typeof import('@/features/levels');
  const game = (require('@/features/game/store') as typeof import('@/features/game/store')).useGame;
  const subscription = (require('@/features/monetization/subscription') as typeof import('@/features/monetization/subscription')).useSubscription;
  const recovery = require('@/features/monetization/rewardRecovery') as typeof import('@/features/monetization/rewardRecovery');
  const ports = { allowed: () => authorized, active: () => true, ads: mockAds, currency, wheel: wheel.useWheel, game, levels: levels.useLevels,
    subscription, storage: storage.storage, keys: storage.KEYS,
    clearGameSnapshot: require('@/features/game/persistence').clearGameSnapshot, loadGlobalLevel: levels.loadGlobalLevel,
    spinWheel: wheel.spinWheel, dayKey: require('@/core/time').dayKey, apiUrl: 'http://127.0.0.1:18788',
    recover: recovery.recoverRewardedGrants, validReceipt: require('@/features/monetization/nativeRewardJournal').isNativeRewardReceipt,
    recoveryState: () => recovery.useRewardRecovery.getState(), matchingHelpContext: () => undefined as Record<string, unknown> | undefined,
    showSimulation } satisfies import('../runtime').ProductQaPorts;
  const harness = (require('../runtime') as typeof import('../runtime')).createProductQaHarness(ports)!;
  const save = (): [string, string][] => storage.storage.getAllKeys().map((key) => [key, storage.storage.getString(key)!]);
  return { harness, ports, storage, currency, wheel: wheel.useWheel, game, subscription, recovery,
    complete: () => complete(), dismiss: () => dismiss(), authorize: (value: boolean) => { authorized = value; }, save,
    requestRewarded: (require('@/features/monetization/rewarded') as typeof import('@/features/monetization/rewarded')).requestRewarded };
}

function confirmation(fixture: ReturnType<typeof setup>, id = 'qa:reward:1'): RewardConfirmation {
  return { rewardId: id, receipt: { version: 1, rewardId: id, kind: 'coins', amount: 60,
    offerDay: fixture.ports.dayKey(), createdAtMs: Date.now() },
  persistGrant: (rewardId) => fixture.currency.getState().addOnce(rewardId, 'coins', 60) || fixture.currency.getState().hasApplied(rewardId) };
}

beforeEach(() => { jest.resetModules(); mockNativeReceipts = []; mockAck.mockClear(); });

test('denied factory never reads a business dependency or installs an action', () => {
  const forbidden = new Proxy({ allowed: () => false }, { get(target, name) {
    if (name === 'allowed') return target.allowed;
    throw new Error('Denied business dependency touched');
  } });
  expect(require('../runtime').createProductQaHarness(forbidden)).toBeNull();
});

test('real campaign6, wallet20, requestRewarded and explicit paid hint retain their actual persistence path', async () => {
  const f = setup();
  expect(f.harness.prepareCampaign()).toBe(true);
  expect(f.game.getState().snapshot).toMatchObject({ globalLevel: 6, mode: 'normal', completion: { status: 'playing' } });
  const attempt = f.game.getState().snapshot!.attemptId;
  const filled = { ...f.game.getState().play!.filled };
  expect(f.currency.getState().coins).toBe(20);
  expect(f.harness.useSimulation()).toBe(true);
  const reward = confirmation(f);
  const pending = f.requestRewarded('hint', reward);
  expect(f.currency.getState().coins).toBe(20);
  f.complete();
  expect(await pending).toBe('rewarded');
  expect(f.currency.getState().coins).toBe(80);
  expect(f.game.getState().play!.filled).toEqual(filled);
  expect(f.game.getState().hintsUsed).toHaveLength(0);
  f.complete();
  expect(f.currency.getState().coins).toBe(80);
  expect(f.currency.getState().spendOnce('qa:explicit-hint', 'coins', 50)).toBe('spent');
  expect(f.game.getState().hint('bulb')).not.toBeNull();
  expect(f.currency.getState().coins).toBe(30);
  expect(f.game.getState().snapshot!.attemptId).toBe(attempt);
  expect(f.game.getState().play!.filled).not.toEqual(filled);
  expect(JSON.parse(f.storage.storage.getString('product-qa.fixture-backup.v1')!).values).not.toHaveProperty(f.storage.KEYS.profile);
  f.harness.stop();
});

test('dismissed simulation creates no reward and owns only its fullscreen lease', async () => {
  const f = setup(); f.harness.prepareCampaign(); f.harness.useSimulation();
  const reward = confirmation(f); const persist = jest.fn(reward.persistGrant); reward.persistGrant = persist;
  const pending = f.requestRewarded('hint', reward);
  expect(require('@/core/fullscreen').getFullscreenSnapshot().owner).toBe('rewarded');
  f.dismiss();
  expect(await pending).toBe('dismissed');
  expect(persist).not.toHaveBeenCalled();
  expect(f.currency.getState().coins).toBe(20);
  expect(mockNativeReceipts).toHaveLength(0);
  expect(require('@/core/fullscreen').getFullscreenSnapshot().owner).toBeNull();
  f.harness.stop();
});

test.each(['unknown', '', {}, null])('malformed simulation state %j installs no wrappers', (state) => {
  const f = setup(); const original = mockAds.showRewarded; const addOnce = f.currency.getState().addOnce;
  expect(f.harness.useSimulation(state)).toBe(false);
  expect(mockAds.showRewarded).toBe(original);
  expect(f.currency.getState().addOnce).toBe(addOnce);
});

test('native guard revocation stops all QA actions and an already open simulation cannot grant', async () => {
  const f = setup(); f.harness.prepareCampaign(); f.harness.useSimulation();
  const pending = f.requestRewarded('hint', confirmation(f));
  f.authorize(false); f.complete();
  expect(await pending).toBe('unavailable');
  expect(f.currency.getState().coins).toBe(20);
  expect(f.harness.prepareCampaign()).toBe(false);
  expect(f.harness.armVendor()).toBe(false);
  expect(f.harness.prepareSmallSpin()).toBe(false);
  expect(f.harness.openFormFixture()).toBe(false);
  f.harness.stop();
});

test('vendor exact reward hold blocks every callback, Game fallback and recovery attempt, while another ID works', async () => {
  const f = setup(); f.harness.prepareCampaign();
  (mockAds.showRewarded as jest.Mock).mockImplementation(async (_placement, reward: RewardConfirmation) => {
    try { reward.persistGrant(reward.rewardId); } catch { /* Mirrors a vendor callback's bounded failed wallet write. */ }
    return 'rewarded';
  });
  f.harness.armVendor(); const reward = confirmation(f);
  expect(await f.requestRewarded('hint', reward)).toBe('rewarded');
  expect(f.currency.getState().coins).toBe(20);
  for (let index = 0; index < 3; index += 1) expect(() => reward.persistGrant(reward.rewardId)).toThrow('qa_reward_commit_deferred');
  mockNativeReceipts = [{ ...reward.receipt!, earnedAtMs: Date.now() }];
  const recovery = await f.recovery.recoverRewardedGrants();
  expect(recovery.pending).toHaveLength(1);
  expect(mockAck).not.toHaveBeenCalled();
  expect(f.currency.getState().addOnce('qa:other-reward', 'coins', 1)).toBe(true);
  expect(f.currency.getState().coins).toBe(21);
  expect(f.harness.snapshot()).toMatchObject({ vendorCallbackObserved: true, heldRewardId: reward.rewardId, nativeDiskEvidence: 'external_required' });
  expect(f.harness.snapshot().deferredAttempts).toBeGreaterThanOrEqual(5);
  expect(await f.harness.releaseHold()).toBe(true);
  expect(f.currency.getState().coins).toBe(81);
  expect(mockAck).toHaveBeenCalledTimes(1);
  f.harness.stop();
});

test('vendor cancellation before earned leaves no held reward or fabricated right', async () => {
  const f = setup(); f.harness.prepareCampaign();
  (mockAds.showRewarded as jest.Mock).mockResolvedValue('dismissed');
  f.harness.armVendor();
  expect(await f.requestRewarded('hint', confirmation(f))).toBe('dismissed');
  expect(f.harness.snapshot()).toMatchObject({ heldRewardId: null, vendorCallbackObserved: false, deferredAttempts: 0 });
  expect(f.currency.getState().coins).toBe(20);
  expect(mockNativeReceipts).toHaveLength(0);
  f.harness.stop();
});

test('process-only hold disappears on cold module reload and mocked native receipt recovers exactly once', async () => {
  const first = setup(); first.harness.prepareCampaign();
  (mockAds.showRewarded as jest.Mock).mockImplementation(async (_placement, reward: RewardConfirmation) => {
    mockNativeReceipts = [{ ...reward.receipt!, earnedAtMs: Date.now() }];
    try { reward.persistGrant(reward.rewardId); } catch { /* Intentionally deferred. */ }
    return 'rewarded';
  });
  first.harness.armVendor(); const reward = confirmation(first);
  await first.requestRewarded('hint', reward);
  expect(first.currency.getState().coins).toBe(20);
  const saved = first.save(); first.harness.stop();
  jest.resetModules();
  const cold = setup(saved);
  expect(cold.harness.snapshot().heldRewardId).toBeNull();
  await cold.recovery.recoverRewardedGrants();
  await cold.recovery.recoverRewardedGrants();
  expect(cold.currency.getState().coins).toBe(80);
  expect(cold.currency.getState().hasApplied(reward.rewardId)).toBe(true);
  expect(mockAck).toHaveBeenCalledTimes(1);
  cold.harness.stop();
});

test('synthetic small free pendingSpin uses actual reducer/storage and selected hold, then settles once after cold reload', () => {
  const first = setup(); first.harness.prepareCampaign();
  expect(first.harness.prepareSmallSpin()).toBe(true);
  const pending = first.wheel.getState().pendingSpin!;
  expect(pending).toMatchObject({ value: 5, viaRewarded: false });
  expect(first.wheel.getState().freeUsed).toBe(true);
  expect(JSON.parse(first.storage.storage.getString(first.storage.KEYS.wheel)!)).toMatchObject({ pendingSpin: { effectId: pending.effectId, value: 5 } });
  expect(() => first.currency.getState().addOnce(pending.effectId, 'coins', 5)).toThrow('qa_reward_commit_deferred');
  const saved = first.save(); first.harness.stop(); jest.resetModules();
  const cold = setup(saved);
  const resumed = cold.wheel.getState().pendingSpin!;
  expect(cold.currency.getState().addOnce(resumed.effectId, 'coins', resumed.value)).toBe(true);
  expect(cold.wheel.getState().claimPending(resumed.effectId)).toBe(true);
  expect(cold.currency.getState().addOnce(resumed.effectId, 'coins', resumed.value)).toBe(false);
  expect(cold.currency.getState().coins).toBe(25);
  expect(cold.wheel.getState().pendingSpin).toBeNull();
  expect(mockNativeReceipts).toHaveLength(0);
  cold.harness.stop();
});

test('stop preserves newer peer wrappers and makes stale owned wrappers delegate without QA callbacks', async () => {
  const f = setup(); f.harness.useSimulation();
  const ownedReward = mockAds.showRewarded;
  const peerReward = jest.fn((...args: Parameters<AdsProvider['showRewarded']>) => ownedReward(...args));
  const ownedAdd = f.currency.getState().addOnce;
  const peerAdd = jest.fn((...args: Parameters<typeof ownedAdd>) => ownedAdd(...args));
  mockAds.showRewarded = peerReward;
  f.currency.setState({ addOnce: peerAdd });
  f.harness.stop();
  expect(mockAds.showRewarded).toBe(peerReward);
  expect(f.currency.getState().addOnce).toBe(peerAdd);
  await mockAds.showRewarded('hint', confirmation(f));
  expect(f.ports.showSimulation).not.toHaveBeenCalled();
  expect(f.currency.getState().addOnce('qa:peer', 'coins', 1)).toBe(true);
  f.harness.useSimulation();
  await ownedReward('hint', confirmation(f));
  expect(f.ports.showSimulation).not.toHaveBeenCalled();
  f.harness.stop();
});

test('form-only loopback fixture blocks checkout transport and restores only its own subscription values', async () => {
  const f = setup(); const original = f.subscription.getState();
  expect(f.harness.openFormFixture()).toBe(true);
  expect(f.subscription.getState().catalog).toMatchObject({ available: true, mode: 'test' });
  await f.subscription.getState().sync();
  expect(await f.subscription.getState().checkout('qa@example.ru', true, true)).toBe(false);
  expect(require('@/core/net').getBackend).not.toHaveBeenCalled();
  expect(f.subscription.getState().hasPendingCheckout).toBe(false);
  const peerSync = jest.fn(async () => {});
  f.subscription.setState({ sync: peerSync });
  f.harness.stop();
  expect(f.subscription.getState().sync).toBe(peerSync);
  expect(f.subscription.getState().checkout).toBe(original.checkout);
  expect(f.subscription.getState().catalog).toBe(original.catalog);
});

test('production URL and malformed backup deny before fixture mutation', () => {
  const f = setup(); f.ports.apiUrl = 'https://production.invalid';
  expect(f.harness.openFormFixture()).toBe(false);
  f.storage.storage.set('product-qa.fixture-backup.v1', '{"version":99}');
  const before = f.currency.getState().coins;
  expect(() => f.harness.prepareCampaign()).toThrow('qa_backup_invalid');
  expect(f.currency.getState().coins).toBe(before);
});

test('unresolved native recovery prevents destructive QA fixture preparation', () => {
  const f = setup(); const before = f.currency.getState().coins;
  f.recovery.useRewardRecovery.setState({ checking: false, readFailed: false, pendingIds: ['existing:earned'] });
  expect(f.harness.prepareCampaign()).toBe(false);
  expect(f.harness.prepareSmallSpin()).toBe(false);
  expect(f.currency.getState().coins).toBe(before);
  expect(f.storage.storage.getString('product-qa.fixture-backup.v1')).toBeUndefined();
});

test('synthetic pending spin preserves the matching technical origin without a treatment assumption', () => {
  const f = setup(); f.harness.prepareCampaign();
  f.ports.matchingHelpContext = () => ({ origin_interaction_id: 'help:control:unknown-history', attemptId: f.game.getState().snapshot!.attemptId,
    requested_hint: 'letter', displayed_cost: 50, balance: 20 });
  expect(f.harness.prepareSmallSpin()).toBe(true);
  expect(f.wheel.getState().pendingSpin?.flowContext).toMatchObject({ origin_interaction_id: 'help:control:unknown-history' });
  expect(f.harness.snapshot().originInteractionId).toBe('help:control:unknown-history');
  f.harness.stop();
});

test('reentrant peer subscription updates during cleanup are preserved', () => {
  const f = setup(); const original = f.subscription.getState();
  f.harness.openFormFixture();
  const ours = f.subscription.getState();
  const peerCheckout = jest.fn(async () => false);
  const peerCatalog = { ...ours.catalog!, available: false };
  let changed = false;
  const unsubscribe = f.subscription.subscribe((state) => {
    if (!changed && state.sync === original.sync) {
      changed = true; f.subscription.setState({ checkout: peerCheckout, catalog: peerCatalog, error: 'network' });
    }
  });
  f.harness.stop(); unsubscribe();
  expect(f.subscription.getState().checkout).toBe(peerCheckout);
  expect(f.subscription.getState().catalog).toBe(peerCatalog);
  expect(f.subscription.getState().error).toBe('network');
});

test.each(['dismissed', 'rejected', 'late_earned'] as const)(
  'R1 stale vendor %s cannot release the next installation hold or erase legitimate old earning', async (settlement) => {
    const f = setup(); f.harness.prepareCampaign();
    const pending: { confirmation: RewardConfirmation; resolve: (result: RewardedResult) => void; reject: (error: Error) => void }[] = [];
    (mockAds.showRewarded as jest.Mock).mockImplementation((_placement, reward: RewardConfirmation) =>
      new Promise<RewardedResult>((resolve, reject) => pending.push({ confirmation: reward, resolve, reject })));
    f.harness.armVendor(); const first = mockAds.showRewarded('hint', confirmation(f, 'qa:old'));
    const oldResult = first.catch(() => 'unavailable' as const);
    f.harness.stop(); f.harness.armVendor();
    const second = mockAds.showRewarded('hint', confirmation(f, 'qa:new'));
    const before = f.harness.snapshot();
    if (settlement === 'late_earned') expect(pending[0].confirmation.persistGrant('qa:old')).toBe(true);
    if (settlement === 'rejected') pending[0].reject(new Error('old show failed'));
    else pending[0].resolve(settlement === 'late_earned' ? 'rewarded' : 'dismissed');
    await oldResult;
    try {
      expect(f.harness.snapshot()).toMatchObject({ heldRewardId: 'qa:new', status: before.status, vendorCallbackObserved: false });
      expect(() => pending[1].confirmation.persistGrant('qa:new')).toThrow('qa_reward_commit_deferred');
      expect(() => f.currency.getState().addOnce('qa:new', 'coins', 60)).toThrow('qa_reward_commit_deferred');
      expect(f.currency.getState().hasApplied('qa:new')).toBe(false);
      expect(f.currency.getState().coins).toBe(settlement === 'late_earned' ? 80 : 20);
    } finally { pending[1].resolve('dismissed'); await second; f.harness.stop(); }
  },
);

test('R1 old vendor settlement after stop alone cannot change stopped status, but late earning remains deliverable', async () => {
  const f = setup(); f.harness.prepareCampaign();
  let captured!: RewardConfirmation; let finish!: (value: RewardedResult) => void;
  (mockAds.showRewarded as jest.Mock).mockImplementation((_placement, reward: RewardConfirmation) => {
    captured = reward; return new Promise<RewardedResult>((resolve) => { finish = resolve; });
  });
  f.harness.armVendor(); const show = mockAds.showRewarded('hint', confirmation(f, 'qa:stopped-earned'));
  f.harness.stop(); const stopped = f.harness.snapshot();
  expect(captured.persistGrant('qa:stopped-earned')).toBe(true);
  finish('rewarded'); await show;
  expect(f.harness.snapshot()).toMatchObject({ mode: 'off', status: stopped.status, heldRewardId: null });
  expect(f.currency.getState().coins).toBe(80);
});

test.each(['fullscreen_acquire', 'status_open', 'readiness_open'] as const)(
  'R1 stop during %s never opens a ghost simulation or grants after mode off', async (boundary) => {
    const f = setup(); f.harness.prepareCampaign(); f.harness.useSimulation();
    const fullscreen = require('@/core/fullscreen') as typeof import('@/core/fullscreen');
    let stopped = false;
    const stop = () => {
      const trigger = boundary === 'fullscreen_acquire' ? fullscreen.getFullscreenSnapshot().owner === 'rewarded'
        : f.harness.snapshot().status === 'simulated_ad_open';
      if (!stopped && trigger) { stopped = true; f.harness.stop(); }
    };
    const unsubscribe = boundary === 'fullscreen_acquire' ? fullscreen.subscribeFullscreen(stop)
      : boundary === 'status_open' ? f.harness.subscribe(stop) : mockAds.subscribeRewardedState!(stop);
    const pending = mockAds.showRewarded('hint', confirmation(f));
    f.complete();
    const result = await pending;
    unsubscribe();
    try {
      expect(stopped).toBe(true);
      expect(f.ports.showSimulation).not.toHaveBeenCalled();
      expect(result).toBe('unavailable');
      expect(f.currency.getState().coins).toBe(20);
      expect(fullscreen.getFullscreenSnapshot().owner).toBeNull();
      expect(f.harness.snapshot().mode).toBe('off');
    } finally { f.harness.stop(); }
  },
);

test('R1 canceling an acquiring simulation releases only its own lease and preserves a newly acquired foreign lease', async () => {
  const f = setup(); f.harness.prepareCampaign(); f.harness.useSimulation();
  const fullscreen = require('@/core/fullscreen') as typeof import('@/core/fullscreen');
  let stopped = false; let foreign: import('@/core/fullscreen').FullscreenLease | null = null;
  const unsubscribe = fullscreen.subscribeFullscreen(() => {
    if (!stopped && fullscreen.getFullscreenSnapshot().owner === 'rewarded') { stopped = true; f.harness.stop(); }
    else if (stopped && !foreign && fullscreen.getFullscreenSnapshot().owner === null) foreign = fullscreen.tryAcquireFullscreen('review');
  });
  const pending = mockAds.showRewarded('hint', confirmation(f));
  f.complete(); const result = await pending; unsubscribe();
  try {
    expect(result).toBe('unavailable');
    expect(f.ports.showSimulation).not.toHaveBeenCalled();
    expect(fullscreen.getFullscreenSnapshot().owner).toBe('review');
    f.harness.stop();
    expect(fullscreen.getFullscreenSnapshot().owner).toBe('review');
  } finally { if (foreign) fullscreen.releaseFullscreen(foreign); }
});

test('R1 stop from vendor armed publication prevents the delegated native show', async () => {
  const f = setup(); f.harness.prepareCampaign();
  const delegate = mockAds.showRewarded as jest.Mock;
  f.harness.armVendor(); let stopped = false;
  const unsubscribe = f.harness.subscribe(() => {
    if (!stopped && f.harness.snapshot().status === 'vendor_show_armed_no_earned_proof') { stopped = true; f.harness.stop(); }
  });
  const result = await mockAds.showRewarded('hint', confirmation(f)); unsubscribe();
  expect(stopped).toBe(true);
  expect(result).toBe('unavailable');
  expect(delegate).not.toHaveBeenCalled();
  expect(f.harness.snapshot()).toMatchObject({ mode: 'off', status: 'qa_wrappers_removed' });
});

test('R1 retained form wrappers stay inert after reopen and peer replacement without backend or status effects', async () => {
  const f = setup(); f.harness.openFormFixture();
  const stale = f.subscription.getState();
  f.harness.stop(); f.harness.openFormFixture();
  const peerCatalog = { ...f.subscription.getState().catalog!, merchantLogin: 'peer', available: false };
  const peerSync = jest.fn(async () => {}); const peerCheckout = jest.fn(async () => false);
  f.subscription.setState({ catalog: peerCatalog, error: 'peer_network', sync: peerSync, checkout: peerCheckout });
  const currentStatus = f.harness.snapshot().status;
  await stale.sync(); await stale.checkout('qa@example.ru', true, true);
  expect(f.subscription.getState()).toMatchObject({ catalog: peerCatalog, error: 'peer_network', sync: peerSync, checkout: peerCheckout });
  expect(f.harness.snapshot().status).toBe(currentStatus);
  expect(peerSync).not.toHaveBeenCalled(); expect(peerCheckout).not.toHaveBeenCalled();
  expect(require('@/core/net').getBackend).not.toHaveBeenCalled();
  f.harness.stop();
  await stale.sync();
  expect(f.subscription.getState().catalog).toBe(peerCatalog);
});

test('R1 completion releasing a lease cannot overwrite a replacement vendor scenario', async () => {
  const f = setup(); f.harness.prepareCampaign();
  let nextReward!: RewardConfirmation; let finishNext!: (value: RewardedResult) => void;
  (mockAds.showRewarded as jest.Mock).mockImplementation((_placement, reward: RewardConfirmation) => {
    nextReward = reward; return new Promise<RewardedResult>((resolve) => { finishNext = resolve; });
  });
  f.harness.useSimulation();
  const fullscreen = require('@/core/fullscreen') as typeof import('@/core/fullscreen');
  let finishing = false; let replaced = false; let next!: Promise<RewardedResult>;
  const unsubscribe = fullscreen.subscribeFullscreen(() => {
    if (finishing && !replaced && fullscreen.getFullscreenSnapshot().owner === null) {
      replaced = true; f.harness.stop(); f.harness.armVendor(); next = mockAds.showRewarded('hint', confirmation(f, 'qa:replacement'));
    }
  });
  const show = mockAds.showRewarded('hint', confirmation(f, 'qa:completed'));
  finishing = true; f.complete(); expect(await show).toBe('rewarded'); unsubscribe();
  try {
    expect(replaced).toBe(true);
    expect(f.harness.snapshot()).toMatchObject({ mode: 'vendor', heldRewardId: 'qa:replacement', status: 'vendor_show_armed_no_earned_proof' });
    expect(() => nextReward.persistGrant('qa:replacement')).toThrow('qa_reward_commit_deferred');
    expect(f.currency.getState().coins).toBe(80);
  } finally { finishNext('dismissed'); await next; f.harness.stop(); }
});

test('R1 installation reentry keeps the current fullscreen readiness subscription', () => {
  const f = setup(); f.harness.prepareCampaign();
  const originalAdd = f.currency.getState().addOnce;
  let reentered = false;
  const unsubscribeWallet = f.currency.subscribe((value) => {
    if (!reentered && value.addOnce !== originalAdd) { reentered = true; f.harness.useSimulation(); }
  });
  f.harness.useSimulation(); unsubscribeWallet();
  const changed = jest.fn(); const unsubscribeReady = mockAds.subscribeRewardedState!(changed);
  const fullscreen = require('@/core/fullscreen') as typeof import('@/core/fullscreen');
  const lease = fullscreen.tryAcquireFullscreen('review');
  try {
    expect(reentered).toBe(true);
    expect(f.harness.snapshot().mode).toBe('simulated');
    expect(mockAds.getRewardedState!()).toBe('fullscreen_busy');
    expect(changed).toHaveBeenCalled();
  } finally { if (lease) fullscreen.releaseFullscreen(lease); unsubscribeReady(); f.harness.stop(); }
});

test('R1 retired wrappers are not recaptured as originals when stop is reentered during lease release', async () => {
  const f = setup(); f.harness.prepareCampaign();
  const originalShow = mockAds.showRewarded; const originalAdd = f.currency.getState().addOnce;
  f.harness.useSimulation();
  const pending = mockAds.showRewarded('hint', confirmation(f));
  const fullscreen = require('@/core/fullscreen') as typeof import('@/core/fullscreen');
  let restarted = false;
  const unsubscribe = fullscreen.subscribeFullscreen(() => {
    if (!restarted && fullscreen.getFullscreenSnapshot().owner === null) { restarted = true; f.harness.useSimulation(); }
  });
  f.harness.stop(); expect(await pending).toBe('unavailable'); unsubscribe();
  expect(restarted).toBe(true);
  expect(f.harness.snapshot().mode).toBe('simulated');
  f.harness.stop();
  expect(mockAds.showRewarded).toBe(originalShow);
  expect(f.currency.getState().addOnce).toBe(originalAdd);
});

test.each(['fullscreen_acquire', 'status_open', 'readiness_open'] as const)(
  'R1 guard revocation during %s cannot open a simulation or grant', async (boundary) => {
    const f = setup(); f.harness.prepareCampaign(); f.harness.useSimulation();
    const fullscreen = require('@/core/fullscreen') as typeof import('@/core/fullscreen');
    const revoke = () => {
      if (boundary === 'fullscreen_acquire' ? fullscreen.getFullscreenSnapshot().owner === 'rewarded'
        : f.harness.snapshot().status === 'simulated_ad_open') f.authorize(false);
    };
    const unsubscribe = boundary === 'fullscreen_acquire' ? fullscreen.subscribeFullscreen(revoke)
      : boundary === 'status_open' ? f.harness.subscribe(revoke) : mockAds.subscribeRewardedState!(revoke);
    const pending = mockAds.showRewarded('hint', confirmation(f)); f.complete();
    expect(await pending).toBe('unavailable'); unsubscribe();
    expect(f.ports.showSimulation).not.toHaveBeenCalled();
    expect(f.currency.getState().coins).toBe(20);
    expect(fullscreen.getFullscreenSnapshot().owner).toBeNull();
    f.harness.stop();
  },
);

test('R1 old simulation complete/dismiss callbacks cannot alter or release a replacement request', async () => {
  const f = setup(); f.harness.prepareCampaign(); f.harness.useSimulation();
  const first = mockAds.showRewarded('hint', confirmation(f, 'qa:old-simulation'));
  const [oldComplete, oldDismiss] = (f.ports.showSimulation as jest.Mock).mock.calls[0] as [() => void, () => void];
  f.harness.stop(); expect(await first).toBe('unavailable'); f.harness.useSimulation();
  const second = mockAds.showRewarded('hint', confirmation(f, 'qa:new-simulation'));
  oldComplete(); oldDismiss();
  expect(f.harness.snapshot()).toMatchObject({ mode: 'simulated', status: 'simulated_ad_open' });
  expect(f.currency.getState().coins).toBe(20);
  expect(require('@/core/fullscreen').getFullscreenSnapshot().owner).toBe('rewarded');
  f.complete(); expect(await second).toBe('rewarded');
  expect(f.currency.getState().coins).toBe(80);
  f.harness.stop();
});

test('R1 release publication cancellation cannot run recovery against a replacement scenario', async () => {
  const f = setup(); f.harness.prepareCampaign();
  (mockAds.showRewarded as jest.Mock).mockImplementation(async (_placement, reward: RewardConfirmation) => {
    try { reward.persistGrant(reward.rewardId); } catch { /* Expected hold. */ }
    return 'rewarded';
  });
  f.harness.armVendor(); await mockAds.showRewarded('hint', confirmation(f));
  const recover = jest.fn(async () => ({ granted: [], pending: [] })); f.ports.recover = recover;
  let restarted = false;
  const unsubscribe = f.harness.subscribe(() => {
    if (!restarted && f.harness.snapshot().status === 'hold_released') { restarted = true; f.harness.stop(); f.harness.useSimulation(); }
  });
  expect(await f.harness.releaseHold()).toBe(false); unsubscribe();
  expect(recover).not.toHaveBeenCalled();
  expect(f.harness.snapshot()).toMatchObject({ mode: 'simulated', status: 'simulated_provider_selected' });
  f.harness.stop();
});

test('R1 awaited old recovery does not publish into a newly installed scenario', async () => {
  const f = setup(); f.harness.prepareCampaign();
  (mockAds.showRewarded as jest.Mock).mockImplementation(async (_placement, reward: RewardConfirmation) => {
    try { reward.persistGrant(reward.rewardId); } catch { /* Expected hold. */ }
    return 'rewarded';
  });
  f.harness.armVendor(); await mockAds.showRewarded('hint', confirmation(f));
  let finish!: (result: { granted: NativeRewardReceipt[]; pending: NativeRewardReceipt[] }) => void;
  f.ports.recover = () => new Promise((resolve) => { finish = resolve; });
  const release = f.harness.releaseHold();
  f.harness.stop(); f.harness.useSimulation();
  const changed = jest.fn(); const unsubscribe = f.harness.subscribe(changed);
  finish({ granted: [], pending: [] }); expect(await release).toBe(false); unsubscribe();
  expect(changed).not.toHaveBeenCalled();
  expect(f.harness.snapshot()).toMatchObject({ mode: 'simulated', status: 'simulated_provider_selected' });
  f.harness.stop();
});

test('R1 form reopened inside cleanup preserves the new activation and later restores the real predecessors', async () => {
  const f = setup(); const original = f.subscription.getState(); f.harness.openFormFixture();
  let reopened = false;
  const unsubscribe = f.subscription.subscribe((value) => {
    if (!reopened && value.sync === original.sync) { reopened = true; f.harness.openFormFixture(); }
  });
  f.harness.stop(); unsubscribe();
  expect(reopened).toBe(true);
  expect(f.harness.snapshot().status).toBe('form_only_no_invoice_no_preflight');
  await f.subscription.getState().sync();
  expect(f.subscription.getState().catalog?.available).toBe(true);
  f.harness.stop();
  expect(f.subscription.getState().sync).toBe(original.sync);
  expect(f.subscription.getState().checkout).toBe(original.checkout);
  expect(f.subscription.getState().catalog).toBe(original.catalog);
});

test.each(['stop', 'stop_reinstall'] as const)(
  'R2 small-spin first installation %s cannot hide or replace a saved pending ticket', (action) => {
    const f = setup(); f.harness.prepareCampaign();
    const original = f.currency.getState().addOnce;
    let cancelled = false;
    const unsubscribe = f.currency.subscribe((value) => {
      if (!cancelled && value.addOnce !== original) {
        cancelled = true; f.harness.stop();
        if (action === 'stop_reinstall') f.harness.useSimulation();
      }
    });
    const first = f.harness.prepareSmallSpin(); unsubscribe();
    const saved = JSON.parse(f.storage.storage.getString(f.storage.KEYS.wheel) ?? 'null');
    const memory = f.wheel.getState().pendingSpin;
    const second = f.harness.prepareSmallSpin();
    const after = JSON.parse(f.storage.storage.getString(f.storage.KEYS.wheel) ?? 'null');
    try {
      expect(first).toBe(false); expect(cancelled).toBe(true);
      expect(memory?.effectId ?? null).toBe(saved?.pendingSpin?.effectId ?? null);
      if (saved?.pendingSpin) {
        expect(second).toBe(false);
        expect(after.pendingSpin.effectId).toBe(saved.pendingSpin.effectId);
      } else expect(second).toBe(true);
    } finally { f.harness.stop(); }
  },
);

test('R2 an already saved ticket is visible, restores its store projection and cannot be overwritten', () => {
  const f = setup(); f.harness.prepareCampaign();
  const attempt = f.game.getState().snapshot!.attemptId;
  f.ports.matchingHelpContext = () => ({ origin_interaction_id: 'help:durable:control', attemptId: attempt,
    requested_hint: 'letter', displayed_cost: 50, balance: 20 });
  f.harness.prepareSmallSpin(); f.harness.stop();
  const saved = f.storage.storage.getString(f.storage.KEYS.wheel)!;
  const ticket = JSON.parse(saved).pendingSpin;
  f.wheel.setState({ pendingSpin: null, freeUsed: false });
  expect(f.harness.snapshot().pendingSpin).toBe(5);
  expect(f.harness.prepareSmallSpin()).toBe(false);
  expect(f.storage.storage.getString(f.storage.KEYS.wheel)).toBe(saved);
  expect(f.wheel.getState().pendingSpin).toMatchObject({ effectId: ticket.effectId, value: 5,
    flowContext: { origin_interaction_id: 'help:durable:control', attemptId: attempt } });
  expect(f.wheel.getState().freeUsed).toBe(true);
  expect(f.harness.prepareCampaign()).toBe(false);
  const coldState = f.save(); f.harness.stop(); jest.resetModules();
  const cold = setup(coldState); const pending = cold.wheel.getState().pendingSpin!;
  expect(pending.effectId).toBe(ticket.effectId);
  expect(cold.currency.getState().addOnce(pending.effectId, 'coins', pending.value)).toBe(true);
  expect(cold.wheel.getState().claimPending(pending.effectId)).toBe(true);
  expect(cold.currency.getState().addOnce(pending.effectId, 'coins', pending.value)).toBe(false);
  expect(cold.currency.getState().coins).toBe(25);
  cold.harness.stop();
});

test('R2 stop during the durable wheel write still projects and protects the committed ticket', () => {
  const f = setup(); f.harness.prepareCampaign();
  const write = f.ports.storage.set.bind(f.ports.storage);
  let cancelled = false;
  const spy = jest.spyOn(f.ports.storage, 'set').mockImplementation((key, value) => {
    write(key, value);
    if (!cancelled && key === f.storage.KEYS.wheel) { cancelled = true; f.harness.stop(); }
  });
  const result = f.harness.prepareSmallSpin(); spy.mockRestore();
  const saved = f.storage.storage.getString(f.storage.KEYS.wheel)!;
  const ticket = JSON.parse(saved).pendingSpin;
  expect(result).toBe(false); expect(cancelled).toBe(true);
  expect(f.wheel.getState().pendingSpin?.effectId).toBe(ticket.effectId);
  expect(f.harness.snapshot().pendingSpin).toBe(5);
  expect(f.harness.prepareSmallSpin()).toBe(false);
  expect(f.storage.storage.getString(f.storage.KEYS.wheel)).toBe(saved);
  expect(f.currency.getState().addOnce(ticket.effectId, 'coins', ticket.value)).toBe(true);
  expect(f.wheel.getState().claimPending(ticket.effectId)).toBe(true);
  expect(f.currency.getState().coins).toBe(25);
  f.harness.stop();
});

test('R2 stop from pending-store publication preserves the committed effect identity', () => {
  const f = setup(); f.harness.prepareCampaign(); let cancelled = false;
  const unsubscribe = f.wheel.subscribe((value) => {
    if (!cancelled && value.pendingSpin) { cancelled = true; f.harness.stop(); }
  });
  const result = f.harness.prepareSmallSpin(); unsubscribe();
  const saved = f.storage.storage.getString(f.storage.KEYS.wheel)!;
  const ticket = JSON.parse(saved).pendingSpin;
  expect(result).toBe(false); expect(cancelled).toBe(true);
  expect(f.wheel.getState().pendingSpin?.effectId).toBe(ticket.effectId);
  expect(f.harness.prepareSmallSpin()).toBe(false);
  expect(f.storage.storage.getString(f.storage.KEYS.wheel)).toBe(saved);
  f.harness.stop();
});

test('R2 QA catalog is readable UTF-8 with explicitly simulated consents and blocked transport', async () => {
  const f = setup(); expect(f.harness.openFormFixture()).toBe(true);
  const plan = f.subscription.getState().catalog!.plan;
  expect(plan.title).toBe('Локальная форма QA');
  expect(plan.consentText).toBe('Локальная симуляция согласия на автопродление (QA, без оплаты).');
  expect(plan.personalDataConsentText).toBe('Локальная симуляция согласия на обработку данных (QA).');
  expect(await f.subscription.getState().checkout('qa@example.ru', true, true)).toBe(false);
  expect(require('@/core/net').getBackend).not.toHaveBeenCalled();
  f.harness.stop();
});

test.each(['not_json', 'null', '{}', '{"day":null,"freeUsed":false,"rewardedUsed":0,"pendingSpin":{"effectId":"unknown","value":5}}'])(
  'R2 malformed saved wheel %s denies replacement instead of inventing an empty right', (saved) => {
    const f = setup(); f.harness.prepareCampaign();
    f.storage.storage.set(f.storage.KEYS.wheel, saved);
    expect(f.harness.prepareSmallSpin()).toBe(false);
    expect(f.storage.storage.getString(f.storage.KEYS.wheel)).toBe(saved);
    expect(f.currency.getState().coins).toBe(20);
    f.harness.stop();
  },
);
