/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/features/analytics', () => ({ trackOnce: jest.fn(() => 'e_test') }));
jest.mock('@/features/analytics/sessionTelemetry', () => ({ addAdTime: jest.fn() }));
jest.mock('../entitlements', () => ({ useEntitlements: { getState: () => ({ removeAds: false }), subscribe: jest.fn() } }));
jest.mock('yandex-mobile-ads', () => ({
  MobileAds: { initialize: jest.fn(async () => {}) },
  InterstitialAdLoader: { create: jest.fn() }, RewardedAdLoader: { create: jest.fn() },
}));
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  AppState: { value: { currentState: 'active', addEventListener: jest.fn() } },
}));

type Ad = {
  show: jest.Mock<Promise<void>, []>;
  onAdShown?: () => void; onAdImpression?: () => void; onAdClicked?: () => void;
  onAdDismissed?: () => void; onRewarded?: () => void; onAdFailedToShow?: (error: Error) => void;
};

async function fixture(failedLoad = false) {
  jest.resetModules();
  const analytics = require('@/features/analytics');
  const sdk = require('yandex-mobile-ads');
  const state = require('react-native').AppState;
  const interstitial: Ad = { show: jest.fn(async () => {}) };
  const rewarded: Ad = { show: jest.fn(async () => {}) };
  const interstitialLoad = jest.fn(async () => {
    expect(analytics.trackOnce).toHaveBeenCalledWith('ad_lifecycle', expect.any(String),
      expect.objectContaining({ format: 'interstitial', stage: 'requested' }));
    if (failedLoad) throw new Error('PRIVATE_PROVIDER_RESPONSE');
    return interstitial;
  });
  sdk.InterstitialAdLoader.create.mockResolvedValue({ loadAd: interstitialLoad });
  sdk.RewardedAdLoader.create.mockResolvedValue({ loadAd: jest.fn(async () => rewarded) });
  const { YandexAdsProvider: provider } = require('../yandexAds.native');
  provider.setInterstitialPreloadAllowed(true);
  await provider.init();
  const events = (format: string, stage?: string) => analytics.trackOnce.mock.calls
    .map((call: [string, string, Record<string, unknown>]) => call[2])
    .filter((props: Record<string, unknown>) => props.format === format && (!stage || props.stage === stage));
  return { provider, interstitial, rewarded, analytics, events, state };
}

beforeEach(() => { jest.useFakeTimers().setSystemTime(1_800_000_000_000); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('request precedes SDK load, and impression is only the real deduplicated callback', async () => {
  const { provider, interstitial, events, analytics } = await fixture();
  expect(events('interstitial').map((e: { stage: string }) => e.stage)).toEqual(['requested', 'loaded']);
  const pending = provider.showInterstitial('level_complete');
  expect(events('interstitial', 'impression')).toHaveLength(0);
  interstitial.onAdShown?.(); interstitial.onAdShown?.();
  interstitial.onAdImpression?.(); interstitial.onAdImpression?.();
  interstitial.onAdClicked?.(); interstitial.onAdDismissed?.();
  await expect(pending).resolves.toBe('shown');
  const firstCycle = events('interstitial').slice(0, 7);
  expect(firstCycle.map((e: { stage: string }) => e.stage)).toEqual([
    'requested', 'loaded', 'eligible', 'shown', 'impression', 'click', 'closed',
  ]);
  expect(new Set(firstCycle.map((e: { request_id: string }) => e.request_id)).size).toBe(1);
  expect(analytics.trackOnce.mock.calls.some((call: [string]) => call[0] === 'interstitial_shown')).toBe(false);
});

test('reward confirmation, successful persistence and dismissal are distinct facts', async () => {
  const { provider, rewarded, events } = await fixture();
  const persistGrant = jest.fn().mockReturnValueOnce(false).mockReturnValue(true);
  const pending = provider.showRewarded('hint', { rewardId: 'stable-reward', persistGrant });
  rewarded.onRewarded?.();
  expect(events('rewarded', 'reward')).toHaveLength(1);
  expect(events('rewarded', 'grant_persisted')).toHaveLength(0);
  expect(events('rewarded', 'closed')).toHaveLength(0);
  rewarded.onRewarded?.(); rewarded.onRewarded?.();
  expect(persistGrant).toHaveBeenCalledTimes(2);
  expect(events('rewarded', 'reward')).toHaveLength(1);
  expect(events('rewarded', 'grant_persisted')).toHaveLength(1);
  expect(events('rewarded', 'impression')).toHaveLength(0);
  rewarded.onAdDismissed?.();
  await expect(pending).resolves.toBe('rewarded');
});

test('dismissal without reward stays unearned and ignores a late reward callback', async () => {
  const { provider, rewarded, events } = await fixture();
  const persistGrant = jest.fn(() => true);
  const pending = provider.showRewarded('wheel', { rewardId: 'closed-first', persistGrant });
  rewarded.onAdDismissed?.();
  await expect(pending).resolves.toBe('dismissed');
  rewarded.onRewarded?.();
  expect(persistGrant).not.toHaveBeenCalled();
  expect(events('rewarded', 'reward')).toHaveLength(0);
  expect(events('rewarded', 'closed')).toHaveLength(1);
});

test('load failure has no loaded/impression fact and cannot leak provider response', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { events, analytics } = await fixture(true);
  expect(events('interstitial', 'error')).toEqual([expect.objectContaining({ reason: 'load_failed' })]);
  expect(events('interstitial', 'loaded')).toHaveLength(0);
  expect(events('interstitial', 'impression')).toHaveLength(0);
  expect(JSON.stringify(analytics.trackOnce.mock.calls)).not.toContain('PRIVATE_PROVIDER_RESPONSE');
});

test('counts fullscreen time only after shown and pauses the clock in background', async () => {
  const { provider, interstitial, state } = await fixture();
  const pending = provider.showInterstitial('level_complete');
  jest.advanceTimersByTime(2_000);
  interstitial.onAdShown?.();
  jest.advanceTimersByTime(1_000);
  state.currentState = 'background'; state.addEventListener.mock.calls[0][1]('background');
  jest.advanceTimersByTime(10_000);
  interstitial.onAdDismissed?.();
  await pending;
  expect(require('@/features/analytics/sessionTelemetry').addAdTime).toHaveBeenCalledWith(1_000);
});

test('extracts only a bounded SDK code from RN wrapped load errors', () => {
  const { safeAdErrorProperties } = require('../adTelemetry');
  expect(safeAdErrorProperties(new Error(JSON.stringify({ code: 2,
    description: 'PRIVATE_PROVIDER_BODY', adUnitId: 'PRIVATE_AD_UNIT' })))).toEqual({ error_code: 2 });
  expect(safeAdErrorProperties({ code: 'PRIVATE_TEXT', message: 'PRIVATE_RESPONSE' })).toEqual({});
});

test('telemetry failure never hides an earned reward or blocks dismissal', async () => {
  const { provider, rewarded, analytics } = await fixture();
  analytics.trackOnce.mockImplementation(() => { throw new Error('optional analytics unavailable'); });
  const persistGrant = jest.fn(() => true);
  const pending = provider.showRewarded('hint', { rewardId: 'earned-without-telemetry', persistGrant });
  expect(() => rewarded.onRewarded?.()).not.toThrow();
  expect(() => rewarded.onAdDismissed?.()).not.toThrow();
  await expect(pending).resolves.toBe('rewarded');
  expect(persistGrant).toHaveBeenCalledTimes(1);
});

test('accepted show intent freezes the tap and origin through native preparation, reward and wallet confirmation', async () => {
  const { provider, rewarded, events } = await fixture();
  const journal = require('../nativeRewardJournal') as typeof import('../nativeRewardJournal');
  const prepare = jest.spyOn(journal, 'prepareNativeReward').mockResolvedValue(undefined);
  const context = { origin_interaction_id: 'origin1', interaction_id: 'tap1', modal_id: 'modal1',
    attemptId: 'attempt1', levelKey: 'campaign:6', levelId: 6, mode: 'campaign', requested_hint: 'letter',
    displayed_cost: 50, balance: 20, entry_source: 'no_coins', raw_word: 'PRIVATE_WORD' };
  expect(events('rewarded').every((event: { operation: string }) => event.operation === 'load')).toBe(true);
  expect(events('rewarded', 'show_intent')).toHaveLength(0);
  const pending = provider.showRewarded('hint', { rewardId: 'reward1', persistGrant: () => true,
    receipt: { version: 1, kind: 'coins', rewardId: 'reward1', createdAtMs: Date.now(),
      offerDay: '2027-01-15', amount: 60, flowContext: context } });
  await Promise.resolve();
  const accepted = events('rewarded', 'show_intent')[0];
  expect(accepted).toMatchObject({ operation: 'show', outcome: 'accepted', operation_id: 'tap1',
    origin_interaction_id: 'origin1', interaction_id: 'tap1', modal_id: 'modal1', placement: 'hint' });
  expect(prepare.mock.calls[0][1].flowContext).toMatchObject({ opportunity_id: accepted.opportunity_id,
    request_id: accepted.request_id, interaction_id: 'tap1', origin_interaction_id: 'origin1', attemptId: 'attempt1' });
  rewarded.onRewarded?.(); rewarded.onAdDismissed?.();
  await expect(pending).resolves.toBe('rewarded');
  for (const stage of ['reward', 'grant_persisted', 'closed']) {
    expect(events('rewarded', stage)[0]).toMatchObject({ request_id: accepted.request_id,
      operation_id: 'tap1', origin_interaction_id: 'origin1', interaction_id: 'tap1', rewardId: 'reward1' });
  }
  const { validateEventProperties } = require('@/features/analytics/schema') as typeof import('@/features/analytics/schema');
  for (const event of events('rewarded')) expect(validateEventProperties('ad_lifecycle', event))
    .toMatchObject({ valid: true, rejected: 0 });
  expect(JSON.stringify(prepare.mock.calls)).not.toContain('PRIVATE_WORD');
  expect(JSON.stringify(events('rewarded'))).not.toContain('PRIVATE_WORD');
});

test('native prepare failure remains in accepted show denominator with the original request and safe cause', async () => {
  const { provider, rewarded, events } = await fixture();
  const journal = require('../nativeRewardJournal') as typeof import('../nativeRewardJournal');
  jest.spyOn(journal, 'prepareNativeReward').mockRejectedValue(new Error('PRIVATE_STORAGE_EXCEPTION'));
  await expect(provider.showRewarded('wheel', { rewardId: 'prepare1', persistGrant: () => true,
    receipt: { version: 1, kind: 'coins', rewardId: 'prepare1', createdAtMs: Date.now(),
      offerDay: '2027-01-15', amount: 60, flowContext: { interaction_id: 'tap2', origin_interaction_id: 'origin2' } } }))
    .resolves.toBe('unavailable');
  const accepted = events('rewarded', 'show_intent')[0];
  expect(events('rewarded', 'show_intent')).toHaveLength(1);
  expect(events('rewarded', 'error')[0]).toMatchObject({ request_id: accepted.request_id,
    operation_id: 'tap2', operation: 'show', normalized_reason: 'offer_save_failed', outcome: 'failed' });
  expect(rewarded.show).not.toHaveBeenCalled();
  expect(JSON.stringify(events('rewarded'))).not.toContain('PRIVATE_STORAGE_EXCEPTION');
});

test('fullscreen rejection is a separate blocked action and never another accepted show intent', async () => {
  const { provider, rewarded, events } = await fixture();
  const pending = provider.showRewarded('hint', { rewardId: 'first1', persistGrant: () => true });
  await expect(provider.showRewarded('wheel', { rewardId: 'blocked2', persistGrant: () => true,
    receipt: { flowContext: { interaction_id: 'blocked_tap', origin_interaction_id: 'origin2' } } }))
    .resolves.toBe('unavailable');
  expect(events('rewarded', 'show_intent')).toHaveLength(1);
  expect(events('rewarded', 'skipped')[0]).toMatchObject({ operation: 'show', interaction_id: 'blocked_tap',
    origin_interaction_id: 'origin2', blocked_reason: 'fullscreen_busy', normalized_reason: 'fullscreen_busy' });
  rewarded.onAdDismissed?.(); await pending;
});
