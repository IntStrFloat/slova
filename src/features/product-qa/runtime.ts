import { ECONOMY } from '@/core/config/economy';
import { getFullscreenSnapshot, releaseFullscreen, subscribeFullscreen, tryAcquireFullscreen, type FullscreenLease } from '@/core/fullscreen';
import type { BillingCatalog } from '@/core/net';
import type { AdsProvider, RewardConfirmation, RewardedPlacement, RewardedResult, RewardedState } from '@/features/monetization/types';

type CurrencyStore = typeof import('@/features/currency').useCurrency;
type WheelStore = typeof import('@/features/wheel').useWheel;
type GameStore = typeof import('@/features/game/store').useGame;
type LevelsStore = typeof import('@/features/levels').useLevels;
type SubscriptionStore = typeof import('@/features/monetization/subscription').useSubscription;
type SubscriptionState = ReturnType<SubscriptionStore['getState']>;
type PendingSpin = NonNullable<ReturnType<WheelStore['getState']>['pendingSpin']>;
type PendingProjection = Partial<Pick<ReturnType<WheelStore['getState']>, 'day' | 'freeUsed' | 'rewardedUsed' | 'preparedReward'>>
  & { pendingSpin: PendingSpin };
type SavedWheel = { kind: 'empty' | 'invalid' | 'prepared' } | { kind: 'pending'; raw: string; projection: PendingProjection };

export interface ProductQaPorts {
  allowed(): boolean;
  active(): boolean;
  ads: AdsProvider;
  currency: CurrencyStore;
  wheel: WheelStore;
  game: GameStore;
  levels: LevelsStore;
  subscription: SubscriptionStore;
  storage: { getString(key: string): string | undefined; set(key: string, value: string): void };
  keys: typeof import('@/core/storage').KEYS;
  clearGameSnapshot: typeof import('@/features/game/persistence').clearGameSnapshot;
  loadGlobalLevel: typeof import('@/features/levels').loadGlobalLevel;
  spinWheel: typeof import('@/features/wheel').spinWheel;
  dayKey(): string;
  apiUrl: string;
  recover: typeof import('@/features/monetization/rewardRecovery').recoverRewardedGrants;
  recoveryState(): { checking: boolean; readFailed: boolean; pendingIds: string[] };
  matchingHelpContext(): Record<string, unknown> | undefined;
  validReceipt: typeof import('@/features/monetization/nativeRewardJournal').isNativeRewardReceipt;
  showSimulation(complete: () => void, dismiss: () => void): void;
}

export interface ProductQaSnapshot {
  mode: 'off' | 'simulated' | 'vendor';
  status: string;
  coins: number | null;
  attemptId: string | null;
  level: number | null;
  heldRewardId: string | null;
  vendorCallbackObserved: boolean;
  deferredAttempts: number;
  pendingSpin: number | null;
  pendingSpinEffectId: string | null;
  /** Wheel MMKV identity, never evidence from the native earned journal. */
  savedPendingEffectId: string | null;
  originInteractionId: string | null;
  nativeDiskEvidence: 'external_required';
}

const SAFE_ID = /^[a-z0-9][a-z0-9_.:-]{0,191}$/i;
const SIMULATED_STATES = new Set<RewardedState>(['ready', 'loading', 'not_ready', 'no_fill', 'network_error']);
const ADS_KEYS = ['init', 'showInterstitial', 'showRewarded', 'isInterstitialReady', 'isRewardedReady',
  'getRewardedState', 'getRewardedFailure', 'subscribeRewardedReady', 'subscribeRewardedState'] as const;
let sequence = 0;

/** Pure factory. Installation and all business mutations require an explicit guarded action. */
export function createProductQaHarness(ports: ProductQaPorts) {
  if (!ports.allowed()) return null;
  type AddOnce = ReturnType<CurrencyStore['getState']>['addOnce'];
  type Installation = { active: boolean; previousAds: AdsProvider; ownedAds: Partial<AdsProvider>;
    previousAddOnce: AddOnce; addOnce: AddOnce; ready: Set<() => void>; unsubscribe?: () => void };
  type Hold = { id: string; epoch: number; attempts: number; owner: object };
  type VendorRequest = { installation: Installation; epoch: number; id: string; observed: boolean };
  type Simulation = { installation: Installation; epoch: number; lease: FullscreenLease | null;
    settled: boolean; finish(result: RewardedResult): void };
  type Form = { active: boolean; catalog: BillingCatalog; previousCatalog: BillingCatalog | null; previousError: string | null;
    previousSync: SubscriptionState['sync']; previousCheckout: SubscriptionState['checkout'];
    sync: SubscriptionState['sync']; checkout: SubscriptionState['checkout'] };
  let installation: Installation | null = null;
  let form: Form | null = null;
  let fake: Simulation | null = null;
  let vendor: VendorRequest | null = null;
  let hold: Hold | null = null;
  let epoch = 0;
  let mode: ProductQaSnapshot['mode'] = 'off';
  let status = 'not_started';
  let state: RewardedState = 'ready';
  let vendorArmed: number | null = null;
  const listeners = new Set<() => void>();
  const methodOwners = new WeakMap<object, Installation>();
  const formSyncBase = new WeakMap<SubscriptionState['sync'], SubscriptionState['sync']>();
  const formCheckoutBase = new WeakMap<SubscriptionState['checkout'], SubscriptionState['checkout']>();
  const formCatalogBase = new WeakMap<BillingCatalog, { catalog: BillingCatalog | null; error: string | null }>();
  const canAct = () => ports.allowed() && ports.active();
  const live = (token: number) => epoch === token && canAct();
  const ownsInstallation = (value: Installation) => installation === value && value.active;
  const enabled = (value: Installation) => ownsInstallation(value) && ports.allowed();
  const blocked = () => fake !== null || getFullscreenSnapshot().owner !== null;
  function emit(callbacks: Iterable<() => void>, token: number) {
    for (const listener of [...callbacks]) {
      if (epoch !== token) return;
      try { listener(); } catch { /* Observers cannot take ownership of an operation. */ }
    }
  }
  const publish = (token: number) => emit(listeners, token);
  const notifyReady = (value: Installation, token: number) => { if (enabled(value)) emit(value.ready, token); };
  function snapshot(): ProductQaSnapshot {
    if (!ports.allowed()) return { mode: 'off', status: 'qa_unavailable', coins: null, attemptId: null, level: null,
      heldRewardId: null, vendorCallbackObserved: false, deferredAttempts: 0, pendingSpin: null,
      pendingSpinEffectId: null, savedPendingEffectId: null, originInteractionId: null, nativeDiskEvidence: 'external_required' };
    const game = ports.game.getState().snapshot;
    const saved = savedWheel();
    const durable = saved.kind === 'pending' ? saved.projection.pendingSpin : null;
    const pending = ports.wheel.getState().pendingSpin ?? durable;
    const origin = pending?.flowContext?.origin_interaction_id;
    return { mode, status: saved.kind === 'invalid' ? 'qa_saved_wheel_invalid' : saved.kind === 'prepared' ? 'qa_saved_prepared_reward' : status,
      coins: ports.currency.getState().coins, attemptId: game?.attemptId ?? null,
      level: game?.globalLevel ?? null, heldRewardId: hold?.id ?? null, vendorCallbackObserved: vendor?.observed ?? false,
      deferredAttempts: hold?.attempts ?? 0, pendingSpin: pending?.value ?? null,
      pendingSpinEffectId: pending && SAFE_ID.test(pending.effectId) ? pending.effectId : null,
      savedPendingEffectId: durable?.effectId ?? null,
      originInteractionId: typeof origin === 'string' && SAFE_ID.test(origin) ? origin : null, nativeDiskEvidence: 'external_required' };
  }
  function confirmationValid(value: RewardConfirmation | undefined): value is RewardConfirmation {
    return Boolean(value && typeof value.rewardId === 'string' && SAFE_ID.test(value.rewardId)
      && typeof value.persistGrant === 'function' && ports.validReceipt(value.receipt)
      && value.receipt.rewardId === value.rewardId && value.receipt.earnedAtMs === undefined);
  }
  function releaseSimulationLease(request: Simulation) {
    const lease = request.lease;
    request.lease = null;
    if (lease) releaseFullscreen(lease);
  }
  function currentSimulation(request: Simulation) {
    return !request.settled && fake === request && enabled(request.installation) && live(request.epoch)
      && mode === 'simulated' && request.lease !== null && getFullscreenSnapshot().owner === 'rewarded';
  }
  function simulate(owner: Installation, placement: RewardedPlacement, confirmation?: RewardConfirmation): Promise<RewardedResult> {
    if (!enabled(owner) || mode !== 'simulated' || !canAct() || blocked() || state !== 'ready' || placement !== 'hint'
      || !confirmationValid(confirmation) || confirmation.receipt?.kind !== 'coins'
      || confirmation.receipt.amount !== ECONOMY.rewardedCoins) return Promise.resolve('unavailable');
    const token = ++epoch;
    vendorArmed = null;
    return new Promise((resolve) => {
      const request: Simulation = { installation: owner, epoch: token, lease: null, settled: false,
        finish(result) {
          if (request.settled) { releaseSimulationLease(request); return; }
          const current = fake === request && ownsInstallation(owner) && epoch === token;
          request.settled = true;
          if (fake === request) fake = null;
          // Releasing publishes synchronously: callbacks may stop/reinstall before it returns.
          releaseSimulationLease(request);
          if (current && enabled(owner) && live(token) && fake === null) {
            status = result === 'rewarded' ? 'simulated_grant_committed' : 'simulation_dismissed';
            publish(token);
            if (enabled(owner) && live(token)) notifyReady(owner, token);
          }
          resolve(result);
        } };
      // Reservation precedes acquisition, whose synchronous observers may cancel this request.
      fake = request;
      request.lease = tryAcquireFullscreen('rewarded');
      if (!currentSimulation(request)) { request.finish('unavailable'); return; }
      status = 'simulated_ad_open'; publish(token);
      if (!currentSimulation(request)) { request.finish('unavailable'); return; }
      notifyReady(owner, token);
      if (!currentSimulation(request)) { request.finish('unavailable'); return; }
      try {
        ports.showSimulation(() => {
          if (!currentSimulation(request)) { request.finish('unavailable'); return; }
          try { request.finish(confirmation.persistGrant(confirmation.rewardId) === true ? 'rewarded' : 'unavailable'); }
          catch { request.finish('unavailable'); }
        }, () => request.finish(currentSimulation(request) ? 'dismissed' : 'unavailable'));
        if (!currentSimulation(request)) request.finish('unavailable');
      } catch { request.finish('unavailable'); }
    });
  }
  function ownsVendor(request: VendorRequest) {
    return vendor === request && hold?.owner === request && ownsInstallation(request.installation) && epoch === request.epoch;
  }
  function install(token: number): Installation | null {
    if (!live(token)) return null;
    if (installation?.active) return installation;
    const previousAds = { ...ports.ads };
    for (const key of ADS_KEYS) {
      const method = previousAds[key];
      const retired = typeof method === 'function' ? methodOwners.get(method) : undefined;
      if (retired && !retired.active) Object.assign(previousAds, { [key]: retired.previousAds[key] });
    }
    const currentAddOnce = ports.currency.getState().addOnce;
    const retiredWallet = methodOwners.get(currentAddOnce);
    const previousAddOnce = retiredWallet && !retiredWallet.active ? retiredWallet.previousAddOnce : currentAddOnce;
    const owner: Installation = { active: true, previousAds, previousAddOnce, addOnce: previousAddOnce,
      ownedAds: {}, ready: new Set() };
    const delegateState = () => previousAds.getRewardedState?.call(ports.ads) ?? (previousAds.isRewardedReady.call(ports.ads) ? 'ready' : 'not_ready');
    const subscribe = (listener: () => void, kind: 'subscribeRewardedReady' | 'subscribeRewardedState') => {
      if (!enabled(owner)) return previousAds[kind]?.call(ports.ads, listener) ?? (() => {});
      owner.ready.add(listener);
      const unsubscribe = previousAds[kind]?.call(ports.ads, listener);
      if (!enabled(owner)) { owner.ready.delete(listener); unsubscribe?.(); return () => {}; }
      return () => { owner.ready.delete(listener); unsubscribe?.(); };
    };
    owner.ownedAds = {
      init: () => enabled(owner) && mode === 'simulated' ? Promise.resolve() : previousAds.init.call(ports.ads),
      showInterstitial: (placement) => enabled(owner) && mode === 'simulated' ? Promise.resolve('unavailable') : previousAds.showInterstitial.call(ports.ads, placement),
      isInterstitialReady: () => enabled(owner) && mode === 'simulated' ? false : previousAds.isInterstitialReady.call(ports.ads),
      isRewardedReady: () => enabled(owner) && mode === 'simulated' ? state === 'ready' && !blocked() : previousAds.isRewardedReady.call(ports.ads),
      getRewardedState: () => enabled(owner) && mode === 'simulated' ? blocked() ? 'fullscreen_busy' : state : delegateState(),
      getRewardedFailure: () => enabled(owner) && mode === 'simulated' ? state === 'ready' ? null : state : previousAds.getRewardedFailure?.call(ports.ads) ?? null,
      subscribeRewardedReady: (listener) => subscribe(listener, 'subscribeRewardedReady'),
      subscribeRewardedState: (listener) => subscribe(listener, 'subscribeRewardedState'),
      showRewarded: async (placement, confirmation, observation) => {
        if (!enabled(owner)) return previousAds.showRewarded.call(ports.ads, placement, confirmation, observation);
        if (mode === 'simulated') return simulate(owner, placement, confirmation);
        if (vendorArmed !== epoch) return previousAds.showRewarded.call(ports.ads, placement, confirmation, observation);
        if (!canAct() || !confirmationValid(confirmation)) return 'unavailable';
        const request: VendorRequest = { installation: owner, epoch: ++epoch, id: confirmation.rewardId, observed: false };
        vendor = request; hold = { id: request.id, epoch: request.epoch, attempts: 0, owner: request }; vendorArmed = null;
        status = 'vendor_show_armed_no_earned_proof'; publish(request.epoch);
        if (!ownsVendor(request) || !enabled(owner) || !live(request.epoch)) return 'unavailable';
        try {
          return await previousAds.showRewarded.call(ports.ads, placement, { ...confirmation, persistGrant: (id) => {
            if (id === request.id) request.observed = true;
            if (ownsVendor(request) && enabled(owner) && canAct()) {
              status = 'vendor_callback_wallet_held_disk_proof_required'; publish(request.epoch);
            }
            // A stale QA callback still delivers its real earned right to the original domain handler.
            return confirmation.persistGrant(id);
          } }, observation);
        } finally {
          if (ownsVendor(request) && !request.observed) {
            vendor = null; hold = null; status = 'vendor_no_callback_observed'; publish(request.epoch);
          }
        }
      },
    };
    owner.addOnce = (...args) => {
      const selected = hold;
      if (enabled(owner) && selected && args[0] === selected.id) {
        selected.attempts += 1;
        if (epoch === selected.epoch) { status = 'wallet_commit_deferred'; publish(selected.epoch); }
        throw new Error('qa_reward_commit_deferred');
      }
      return previousAddOnce(...args);
    };
    for (const key of ADS_KEYS) {
      const method = owner.ownedAds[key];
      if (typeof method === 'function') methodOwners.set(method, owner);
    }
    methodOwners.set(owner.addOnce, owner);
    installation = owner;
    // Register owned resources before the first store publication can reenter installation.
    owner.unsubscribe = subscribeFullscreen(() => notifyReady(owner, epoch));
    Object.assign(ports.ads, owner.ownedAds);
    if (!enabled(owner) || !live(token)) return null;
    ports.currency.setState({ addOnce: owner.addOnce });
    if (!enabled(owner) || !live(token)) return null;
    return enabled(owner) && live(token) ? owner : null;
  }
  function backup() {
    const key = 'product-qa.fixture-backup.v1';
    const keys = [ports.keys.gameCurrentNormal, ports.keys.gameCurrentNormalBackup, ports.keys.levelsProgress,
      ports.keys.levelsProgressBackup, ports.keys.currency, ports.keys.currencyBackup, ports.keys.wheel];
    const existing = ports.storage.getString(key);
    if (existing !== undefined) {
      let decoded: { version?: unknown; values?: unknown };
      try { decoded = JSON.parse(existing); } catch { throw new Error('qa_backup_invalid'); }
      const values = decoded?.values;
      if (existing.length > 1_048_576 || decoded?.version !== 1 || !values || typeof values !== 'object' || Array.isArray(values)
        || Object.keys(values).length !== keys.length || !Object.entries(values).every(([name, value]) => keys.includes(name as typeof keys[number])
          && (value === null || typeof value === 'string'))) throw new Error('qa_backup_invalid');
      return;
    }
    const value = JSON.stringify({ version: 1, values: Object.fromEntries(keys.map((name) => [name, ports.storage.getString(name) ?? null])) });
    if (value.length > 1_048_576) throw new Error('qa_backup_too_large');
    ports.storage.set(key, value);
    if (ports.storage.getString(key) !== value) throw new Error('qa_backup_unconfirmed');
  }
  function savedWheel(): SavedWheel {
    try {
      const raw = ports.storage.getString(ports.keys.wheel);
      if (raw === undefined) return { kind: 'empty' };
      if (raw.length > 1_048_576) return { kind: 'invalid' };
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || !(value.day === null || typeof value.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.day))
        || typeof value.freeUsed !== 'boolean'
        || value.rewardedUsed !== undefined && (!Number.isSafeInteger(value.rewardedUsed) || value.rewardedUsed < 0)) return { kind: 'invalid' };
      if (value.preparedReward != null) return { kind: 'prepared' };
      const spin = value.pendingSpin;
      if (spin == null) return { kind: value.rewardedUsed === undefined ? 'invalid' : 'empty' };
      if (!spin || typeof spin !== 'object' || Array.isArray(spin) || typeof spin.effectId !== 'string' || !SAFE_ID.test(spin.effectId)
        || !Number.isSafeInteger(spin.sector) || spin.sector < 0 || spin.sector >= ECONOMY.wheel.sectors.length
        || spin.value !== ECONOMY.wheel.sectors[spin.sector]
        || spin.createdAtMs !== undefined && (!Number.isSafeInteger(spin.createdAtMs) || spin.createdAtMs < 0)
        || spin.viaRewarded !== undefined && typeof spin.viaRewarded !== 'boolean'
        || spin.flowContext !== undefined && (!spin.flowContext || typeof spin.flowContext !== 'object' || Array.isArray(spin.flowContext))) return { kind: 'invalid' };
      return { kind: 'pending', raw, projection: { day: value.day, freeUsed: value.freeUsed, pendingSpin: spin,
        preparedReward: null, ...(value.rewardedUsed === undefined ? {} : { rewardedUsed: value.rewardedUsed }) } };
    } catch { return { kind: 'invalid' }; }
  }
  function projectSavedPending(saved: Extract<SavedWheel, { kind: 'pending' }>): boolean {
    if (!ports.allowed() || ports.storage.getString(ports.keys.wheel) !== saved.raw) return false;
    const pending = ports.wheel.getState().pendingSpin;
    if (pending) return pending.effectId === saved.projection.pendingSpin.effectId;
    // This mirrors an already committed right, even if stop cancelled the originating QA action.
    // Never replace a different in-memory right or write the stored ticket again.
    ports.wheel.setState(saved.projection);
    return ports.wheel.getState().pendingSpin?.effectId === saved.projection.pendingSpin.effectId;
  }
  function idleMutation() {
    if (!canAct() || blocked() || hold !== null || ports.wheel.getState().pendingSpin || ports.wheel.getState().preparedReward) return false;
    const saved = savedWheel();
    if (saved.kind !== 'empty') {
      if (saved.kind === 'pending') projectSavedPending(saved);
      return false;
    }
    const recovery = ports.recoveryState();
    return recovery?.checking === false && recovery.readFailed === false && Array.isArray(recovery.pendingIds) && recovery.pendingIds.length === 0;
  }
  function currentForm(value: Form) {
    return form === value && value.active && ports.allowed();
  }
  function stop() {
    const token = ++epoch;
    const oldInstallation = installation;
    const oldForm = form;
    const oldFake = fake;
    const ready = oldInstallation ? [...oldInstallation.ready] : [];
    // Invalidate every current identity BEFORE release/setState/publication can reenter.
    installation = null; form = null; fake = null; vendor = null; hold = null; vendorArmed = null;
    mode = 'off'; status = 'qa_wrappers_removed';
    if (oldInstallation) oldInstallation.active = false;
    if (oldForm) oldForm.active = false;
    oldFake?.finish('unavailable');
    oldInstallation?.unsubscribe?.();
    if (oldInstallation) {
      for (const key of ADS_KEYS) if (ports.ads[key] === oldInstallation.ownedAds[key]) Object.assign(ports.ads, { [key]: oldInstallation.previousAds[key] });
      if (ports.currency.getState().addOnce === oldInstallation.addOnce) ports.currency.setState({ addOnce: oldInstallation.previousAddOnce });
      oldInstallation.ready.clear();
    }
    if (oldForm) {
      if (ports.subscription.getState().sync === oldForm.sync) ports.subscription.setState({ sync: oldForm.previousSync });
      if (ports.subscription.getState().checkout === oldForm.checkout) ports.subscription.setState({ checkout: oldForm.previousCheckout });
      if (ports.subscription.getState().catalog === oldForm.catalog) ports.subscription.setState({ catalog: oldForm.previousCatalog,
        ...(ports.subscription.getState().error === null ? { error: oldForm.previousError } : {}) });
    }
    if (epoch === token) { publish(token); emit(ready, token); }
  }
  return {
    snapshot,
    subscribe(listener: () => void) { if (!ports.allowed()) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    prepareCampaign() {
      if (!idleMutation()) return false;
      const token = ++epoch; vendorArmed = null;
      backup(); if (!live(token)) return false;
      ports.levels.getState().reset(); if (!live(token)) return false;
      for (let id = 1; id <= 5; id += 1) { ports.levels.getState().completeLevel(id); if (!live(token)) return false; }
      ports.clearGameSnapshot('normal'); if (!live(token)) return false;
      const level = ports.loadGlobalLevel(6);
      if (!live(token)) return false;
      if (!level) throw new Error('qa_level_unavailable');
      ports.game.getState().start(level, 'normal'); if (!live(token)) return false;
      const wallet = ports.currency.getState();
      if (wallet.coins > 20) { if (!wallet.spend('coins', wallet.coins - 20)) throw new Error('qa_wallet_unconfirmed'); }
      else if (wallet.coins < 20) wallet.add('coins', 20 - wallet.coins);
      if (!live(token)) return false;
      if (ports.currency.getState().coins !== 20 || ports.game.getState().snapshot?.globalLevel !== 6) throw new Error('qa_fixture_unconfirmed');
      status = 'campaign6_wallet20_prepared'; publish(token); return live(token);
    },
    useSimulation(value: unknown = 'ready') {
      if (!idleMutation() || typeof value !== 'string' || !SIMULATED_STATES.has(value as RewardedState)) return false;
      const token = ++epoch;
      const owner = install(token); if (!owner || !live(token)) return false;
      mode = 'simulated'; vendorArmed = null; state = value as RewardedState; status = 'simulated_provider_selected'; publish(token);
      if (!live(token) || !enabled(owner)) return false;
      notifyReady(owner, token); return live(token) && enabled(owner);
    },
    armVendor() {
      if (!idleMutation()) return false;
      const token = ++epoch;
      const owner = install(token); if (!owner || !live(token)) return false;
      mode = 'vendor'; vendorArmed = token; status = 'vendor_next_reward_hold_armed'; publish(token);
      if (!live(token) || !enabled(owner)) return false;
      notifyReady(owner, token); return live(token) && enabled(owner);
    },
    prepareSmallSpin() {
      if (!idleMutation()) return false;
      const token = ++epoch; vendorArmed = null;
      backup(); if (!live(token)) return false;
      // Setup can publish currency state and be cancelled. It must finish before any ticket commit.
      const owner = install(token); if (!owner || !live(token) || !idleMutation()) return false;
      const current = ports.wheel.getState();
      const today = ports.dayKey();
      let result: ReturnType<ProductQaPorts['spinWheel']> | null = null;
      for (let seed = 0; seed < 10_000; seed += 1) {
        const candidate = ports.spinWheel({ ...current, day: today, freeUsed: false }, today, false, seed);
        if (!('error' in candidate) && candidate.value === 5) { result = candidate; break; }
      }
      if (!live(token)) return false;
      if (!result || 'error' in result) throw new Error('qa_small_sector_unavailable');
      sequence += 1;
      const effectId = `qa:free:${Date.now().toString(36)}:${sequence.toString(36)}`;
      const context = ports.matchingHelpContext();
      if (!live(token)) return false;
      const pendingSpin = { ...result.state.pendingSpin!, effectId, createdAtMs: Date.now(), viaRewarded: false,
        ...(context ? { flowContext: context } : {}) };
      const next = { ...result.state, preparedReward: null, pendingSpin };
      const value = JSON.stringify(next);
      if (!live(token) || !enabled(owner) || !idleMutation()) return false;
      ports.storage.set(ports.keys.wheel, value);
      const saved = savedWheel();
      if (saved.kind === 'pending') {
        if (saved.raw === value && live(token) && enabled(owner)) { vendor = null; hold = { id: effectId, epoch: token, attempts: 0, owner: {} }; }
        projectSavedPending(saved);
      }
      if (!live(token) || !enabled(owner)) return false;
      if (saved.kind !== 'pending' || saved.raw !== value || ports.wheel.getState().pendingSpin?.effectId !== effectId) throw new Error('qa_spin_unconfirmed');
      status = 'synthetic_free_spin5_wallet_held'; publish(token); return live(token);
    },
    async releaseHold() {
      if (!canAct() || blocked() || !hold) return false;
      const token = ++epoch;
      hold = null; vendor = null; vendorArmed = null; status = 'hold_released'; publish(token);
      if (!live(token)) return false;
      await ports.recover();
      if (!live(token)) return false;
      publish(token); return live(token);
    },
    openFormFixture() {
      if (!idleMutation()) return false;
      let url: URL;
      try { url = new URL(ports.apiUrl); } catch { return false; }
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname)
        || url.username || url.password || url.port !== '18788' || url.pathname !== '/' || url.search || url.hash) return false;
      const billing = ports.subscription.getState();
      if (billing.busy || billing.hasPendingCheckout || billing.status?.autoRenew || billing.status?.active) return false;
      if (form) return currentForm(form) && billing.sync === form.sync && billing.checkout === form.checkout && billing.catalog === form.catalog;
      const token = ++epoch; vendorArmed = null;
      const catalog: BillingCatalog = { provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: 'local_qa_only', mode: 'test', available: true,
        plan: { id: 'local_qa_only', title: 'Локальная форма QA', amount: '99.00', currency: 'RUB', periodDays: 30,
          consentVersion: 'qa-only-v1', termsVersion: 'qa-only-v1', privacyVersion: 'qa-only-v1', userAgreementVersion: 'qa-only-v1',
          personalDataConsentVersion: 'qa-only-v1', consentText: 'Локальная симуляция согласия на автопродление (QA, без оплаты).',
          personalDataConsentText: 'Локальная симуляция согласия на обработку данных (QA).' } };
      // Cleanup can be reentered halfway through restoration: unwrap only our known retired functions/catalogs.
      const previousSync = formSyncBase.get(billing.sync) ?? billing.sync;
      const previousCheckout = formCheckoutBase.get(billing.checkout) ?? billing.checkout;
      const previous = billing.catalog ? formCatalogBase.get(billing.catalog) : undefined;
      const value: Form = { active: true, catalog, previousSync, previousCheckout,
        previousCatalog: previous ? previous.catalog : billing.catalog,
        previousError: billing.error === null && previous ? previous.error : billing.error,
        sync: async () => { /* Display-only fixture: even current sync needs no catalog write or backend call. */ },
        checkout: async () => {
          if (currentForm(value) && canAct() && !blocked() && hold === null && ports.subscription.getState().checkout === value.checkout) {
            const action = ++epoch; status = 'form_only_checkout_transport_blocked'; publish(action);
          }
          return false;
        } };
      formSyncBase.set(value.sync, previousSync); formCheckoutBase.set(value.checkout, previousCheckout);
      formCatalogBase.set(catalog, { catalog: value.previousCatalog, error: value.previousError });
      form = value;
      ports.subscription.setState({ catalog, error: null, sync: value.sync, checkout: value.checkout });
      if (!currentForm(value) || !live(token)) return false;
      status = 'form_only_no_invoice_no_preflight'; publish(token); return currentForm(value) && live(token);
    },
    stop,
  };
}

export type ProductQaHarness = NonNullable<ReturnType<typeof createProductQaHarness>>;
