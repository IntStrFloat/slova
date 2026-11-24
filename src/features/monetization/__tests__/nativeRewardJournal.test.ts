import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

import { ECONOMY } from '@/core/config/economy';
import { useWheel } from '@/features/wheel';

import {
  acknowledgeNativeReward, hasActiveNativeRewardedShow, isNativeRewardJournalAvailable, isNativeRewardReceipt,
  prepareNativeReward, readNativeEarnedRewards, type NativeRewardReceipt,
} from '../nativeRewardJournal';

const receiptSector = ECONOMY.wheel.sectors.indexOf(15);
const receipt: NativeRewardReceipt = {
  version: 1, rewardId: 'wheel:2026-11-04:rewarded:1', kind: 'wheel',
  createdAtMs: 1793786400000, offerDay: '2026-11-04', sector: receiptSector, amount: ECONOMY.wheel.sectors[receiptSector],
  flowContext: { attemptId: 'attempt:42', requested_hint: 'letter', displayed_cost: 50 },
};

let originalOS: typeof Platform.OS;
let originalBridge: unknown;
let originalEmitter: unknown;
const nativeBridge: { prepareReward: jest.Mock; listEarnedRewards: jest.Mock; ackReward: jest.Mock; disposeAd: jest.Mock; hasActiveRewardedShow: jest.Mock } = {
  prepareReward: jest.fn(), listEarnedRewards: jest.fn(), ackReward: jest.fn(), disposeAd: jest.fn(), hasActiveRewardedShow: jest.fn(),
};

interface ActualSdkAd {
  prepareRewardSession: (value: string) => Promise<void>;
  dispose: () => Promise<void>;
  onRewarded?: (value?: unknown) => void;
  onAdShown?: () => void;
  onAdClicked?: () => void;
  onAdDismissed?: () => void;
  onAdFailedToShow?: (value?: unknown) => void;
  onAdImpression?: (value?: unknown) => void;
}

function actualRewardedAdClass(): { create: (id: string) => Promise<ActualSdkAd> } {
  return jest.requireActual('yandex-mobile-ads/lib/commonjs/rewarded/RewardedAd').RewardedAd;
}

beforeEach(() => {
  originalOS = Platform.OS;
  originalBridge = NativeModules.YandexRewardedAdModule;
  originalEmitter = NativeModules.YandexEventEmitter;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  nativeBridge.prepareReward.mockReset().mockResolvedValue(undefined);
  nativeBridge.listEarnedRewards.mockReset().mockResolvedValue([]);
  nativeBridge.ackReward.mockReset().mockResolvedValue(undefined);
  nativeBridge.disposeAd.mockReset().mockResolvedValue(undefined);
  nativeBridge.hasActiveRewardedShow.mockReset().mockResolvedValue(false);
  NativeModules.YandexRewardedAdModule = nativeBridge;
  NativeModules.YandexEventEmitter = { addListener: jest.fn(), removeListeners: jest.fn() };
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  NativeModules.YandexRewardedAdModule = originalBridge;
  NativeModules.YandexEventEmitter = originalEmitter;
});

test('freezes the valid offer into the exact ad wrapper before show', async () => {
  const ad = { prepareRewardSession: jest.fn(async () => {}) };
  await prepareNativeReward(ad, receipt);
  expect(ad.prepareRewardSession).toHaveBeenCalledWith(JSON.stringify(receipt));
  expect(isNativeRewardJournalAvailable()).toBe(true);
});

test('a free-hint receipt is one entitlement and cannot masquerade as a currency amount or wheel sector', async () => {
  const hint: NativeRewardReceipt = { version: 1, kind: 'hint', rewardId: 'rewarded-hint:test',
    createdAtMs: receipt.createdAtMs, offerDay: receipt.offerDay, amount: 1,
    flowContext: { origin_interaction_id: 'flow:hint', attemptId: 'attempt:42', requested_hint: 'letter' } };
  expect(isNativeRewardReceipt(hint)).toBe(true);
  expect(isNativeRewardReceipt({ ...hint, amount: 60 })).toBe(false);
  expect(isNativeRewardReceipt({ ...hint, sector: 0 })).toBe(false);
  expect(isNativeRewardReceipt({ ...hint, flowContext: undefined })).toBe(false);
  expect(isNativeRewardReceipt({ ...hint, flowContext: { ...hint.flowContext, requested_hint: 'unknown' } })).toBe(false);
  const ad = { prepareRewardSession: jest.fn(async () => {}) };
  await prepareNativeReward(ad, hint);
  expect(ad.prepareRewardSession).toHaveBeenCalledWith(JSON.stringify(hint));
});

test('explicit completion history survives the actual ad wrapper receipt without altering reward authority', async () => {
  const ad = await actualRewardedAdClass().create('native-history-flag');
  const contextual = { ...receipt, flowContext: { ...receipt.flowContext, previously_completed: false } };
  expect(isNativeRewardReceipt(contextual)).toBe(true);
  await prepareNativeReward(ad, contextual);
  expect(nativeBridge.prepareReward).toHaveBeenCalledWith('native-history-flag', JSON.stringify(contextual));
  expect(contextual.earnedAtMs).toBeUndefined();
  await ad.dispose();
});

test.each(ECONOMY.wheel.sectors.map((amount, sector) => ({ amount, sector })))(
  'actual wheel sector $sector / $amount survives prepareRewarded → SDK wrapper → native bridge', async ({ amount, sector }) => {
    const adId = `native-economy-sector-${sector}`;
    const ad = await actualRewardedAdClass().create(adId);
    const now = jest.spyOn(Date, 'now');
    let prepared: NativeRewardReceipt | null = null;
    useWheel.getState().reset();
    try {
      // Exercise the real store/RNG/ECONOMY path; advance time until this sector is drawn.
      for (let offset = 0; offset < 512; offset += 1) {
        now.mockReturnValue(receipt.createdAtMs + offset);
        const candidate = useWheel.getState().prepareRewarded();
        if (!candidate) throw new Error('Real rewarded preparation unexpectedly unavailable');
        if (candidate.sector === sector) { prepared = candidate; break; }
        useWheel.getState().releasePrepared(candidate.rewardId);
      }
      expect(prepared).toMatchObject({ sector, amount });
      await prepareNativeReward(ad, prepared!);
      expect(nativeBridge.prepareReward).toHaveBeenCalledTimes(1);
      const [actualAdId, serialized] = nativeBridge.prepareReward.mock.calls[0];
      expect(actualAdId).toBe(adId);
      expect(JSON.parse(serialized)).toMatchObject({ rewardId: prepared!.rewardId, sector, amount });
      expect(useWheel.getState().rewardedUsed).toBe(0);
      const wrongAmount = ECONOMY.wheel.sectors[(sector + 1) % ECONOMY.wheel.sectors.length];
      await expect(prepareNativeReward(ad, { ...prepared!, amount: wrongAmount }))
        .rejects.toMatchObject({ code: 'reward_snapshot_invalid' });
      expect(nativeBridge.prepareReward).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
      useWheel.getState().reset();
      DeviceEventEmitter.emit('RNYandexMobileAds-Rewarded-onAdDeleted', { adId });
    }
  },
);

test('an old native binary or unpatched ad cannot silently start an unprotected offer', async () => {
  await expect(prepareNativeReward({}, receipt)).rejects.toMatchObject({ code: 'reward_journal_unavailable' });
  delete NativeModules.YandexRewardedAdModule;
  expect(isNativeRewardJournalAvailable()).toBe(false);
  const ad = { prepareRewardSession: jest.fn(async () => {}) };
  await expect(prepareNativeReward(ad, receipt)).rejects.toMatchObject({ code: 'reward_journal_unavailable' });
  expect(ad.prepareRewardSession).not.toHaveBeenCalled();
});

test('failed native prepare rejects, so the caller cannot announce readiness or a grant', async () => {
  const failure = new Error('disk failure');
  await expect(prepareNativeReward({ prepareRewardSession: jest.fn(async () => { throw failure; }) }, receipt))
    .rejects.toBe(failure);
});

test.each([
  { ...receipt, amount: 200 }, { ...receipt, sector: 8 }, { ...receipt, amount: -1 },
  { ...receipt, rewardId: 'private@example.com' }, { ...receipt, createdAtMs: NaN },
  { ...receipt, flowContext: { nested: { attemptId: 'attempt:1' } } },
  { ...receipt, flowContext: { typed_word: 'введённое слово' } },
  { ...receipt, extra: 'unexpected' },
])('rejects a malformed or changed frozen offer %#', async (invalid) => {
  expect(isNativeRewardReceipt(invalid)).toBe(false);
  const ad = { prepareRewardSession: jest.fn(async () => {}) };
  await expect(prepareNativeReward(ad, invalid as NativeRewardReceipt)).rejects.toMatchObject({ code: 'reward_snapshot_invalid' });
  expect(ad.prepareRewardSession).not.toHaveBeenCalled();
});

test('reads only valid earned receipts and deduplicates an identical native delivery', async () => {
  nativeBridge.listEarnedRewards.mockResolvedValue([JSON.stringify(receipt), JSON.stringify(receipt)]);
  await expect(readNativeEarnedRewards()).resolves.toEqual([receipt]);
  expect(nativeBridge.ackReward).not.toHaveBeenCalled();
});

test('preserves native earned time through replay and rejects it as a new prepared proof', async () => {
  const earnedReceipt = { ...receipt, earnedAtMs: receipt.createdAtMs + 42_000 };
  nativeBridge.listEarnedRewards.mockResolvedValue([JSON.stringify(earnedReceipt)]);
  await expect(readNativeEarnedRewards()).resolves.toEqual([earnedReceipt]);
  await expect(prepareNativeReward({ prepareRewardSession: jest.fn() }, earnedReceipt))
    .rejects.toMatchObject({ code: 'reward_snapshot_invalid' });
});

test.each([null, ['bad json'], [JSON.stringify({ ...receipt, amount: 200 })]])(
  'fails closed on unreadable earned evidence instead of dropping it %#', async (raw) => {
    nativeBridge.listEarnedRewards.mockResolvedValue(raw);
    await expect(readNativeEarnedRewards()).rejects.toMatchObject({ code: 'reward_journal_invalid' });
    expect(nativeBridge.ackReward).not.toHaveBeenCalled();
  },
);

test('conflicting native receipts with one reward ID cannot choose a new sector', async () => {
  const otherSector = (receiptSector + 1) % ECONOMY.wheel.sectors.length;
  nativeBridge.listEarnedRewards.mockResolvedValue([
    JSON.stringify(receipt), JSON.stringify({ ...receipt, sector: otherSector, amount: ECONOMY.wheel.sectors[otherSector] }),
  ]);
  await expect(readNativeEarnedRewards()).rejects.toMatchObject({ code: 'reward_journal_conflict' });
});

test('acknowledgment is explicit and native failure stays retryable', async () => {
  const failure = new Error('ack write failed');
  nativeBridge.ackReward.mockRejectedValueOnce(failure);
  await expect(acknowledgeNativeReward(receipt.rewardId)).rejects.toBe(failure);
  await acknowledgeNativeReward(receipt.rewardId);
  expect(nativeBridge.ackReward).toHaveBeenCalledTimes(2);
});

test('web shim never invents native earned receipts', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  delete NativeModules.YandexRewardedAdModule;
  await expect(prepareNativeReward({}, receipt)).resolves.toBeUndefined();
  await expect(readNativeEarnedRewards()).resolves.toEqual([]);
  await expect(acknowledgeNativeReward(receipt.rewardId)).resolves.toBeUndefined();
  await expect(hasActiveNativeRewardedShow()).resolves.toBe(false);
});

test('active-show queries remain separate from earned evidence and fail closed on a broken bridge response', async () => {
  nativeBridge.hasActiveRewardedShow.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(undefined);
  await expect(hasActiveNativeRewardedShow()).resolves.toBe(true);
  await expect(hasActiveNativeRewardedShow()).resolves.toBe(false);
  await expect(hasActiveNativeRewardedShow()).rejects.toMatchObject({ code: 'reward_journal_invalid' });
  expect(nativeBridge.listEarnedRewards).not.toHaveBeenCalled();
});

test('the actual patched SDK wrapper preserves exact-ad late earned after quarantine until terminal deletion', async () => {
  // Exercise shipped CommonJS code instead of mirroring the new method in a mock.
  const RewardedAd = actualRewardedAdClass();
  const first = await RewardedAd.create('native-ad-one');
  const second = await RewardedAd.create('native-ad-two');
  await prepareNativeReward(first, receipt);
  await prepareNativeReward(second, { ...receipt, rewardId: 'wheel:2026-11-04:rewarded:2' });
  expect(nativeBridge.prepareReward.mock.calls.map(([id]) => id)).toEqual(['native-ad-one', 'native-ad-two']);
  await first.dispose();
  expect(nativeBridge.disposeAd).toHaveBeenCalledWith('native-ad-one');
  DeviceEventEmitter.emit('RNYandexMobileAds-Rewarded-onAdDeleted', { adId: 'native-ad-one' });
  await first.dispose();
  expect(nativeBridge.disposeAd).toHaveBeenCalledTimes(1);
  DeviceEventEmitter.emit('RNYandexMobileAds-Rewarded-onAdDeleted', { adId: 'native-ad-two' });

  const prefix = 'RNYandexMobileAds-Rewarded-';
  const deletedEvent = `${prefix}onAdDeleted`;
  const earnedEvent = `${prefix}onAdDidReward`;
  const baselineDeleted = DeviceEventEmitter.listenerCount(deletedEvent);
  const baselineEarned = DeviceEventEmitter.listenerCount(earnedEvent);
  const late = await RewardedAd.create('native-late-earned');
  const another = await RewardedAd.create('native-another-ad');
  const recovered = jest.fn();
  const otherReward = jest.fn();
  const visual = jest.fn();
  late.onRewarded = recovered;
  another.onRewarded = otherReward;
  late.onAdShown = visual;
  late.onAdClicked = visual;
  late.onAdDismissed = visual;
  late.onAdFailedToShow = visual;
  late.onAdImpression = visual;
  DeviceEventEmitter.emit(deletedEvent, { adId: 'native-late-earned', retainRewardListener: true });
  DeviceEventEmitter.emit(deletedEvent, { adId: 'native-late-earned', retainRewardListener: true });
  for (const name of ['onAdShown', 'onAdClicked', 'onAdDismissed', 'onAdFailedToShow', 'onAdImpression']) {
    DeviceEventEmitter.emit(`${prefix}${name}`, { adId: 'native-late-earned' });
  }
  expect(visual).not.toHaveBeenCalled();
  expect(DeviceEventEmitter.listenerCount(earnedEvent)).toBe(baselineEarned + 2);
  expect(DeviceEventEmitter.listenerCount(deletedEvent)).toBe(baselineDeleted + 2);
  DeviceEventEmitter.emit(earnedEvent, { adId: 'native-another-ad', reward: { amount: 60, type: 'coins' } });
  expect(otherReward).toHaveBeenCalledTimes(1);
  expect(recovered).not.toHaveBeenCalled();
  DeviceEventEmitter.emit(earnedEvent, { adId: 'native-late-earned', reward: { amount: 15, type: 'coins' } });
  expect(recovered).toHaveBeenCalledTimes(1);
  expect(recovered).toHaveBeenCalledWith({ amount: 15, type: 'coins' });
  DeviceEventEmitter.emit(deletedEvent, { adId: 'native-late-earned', retainRewardListener: false });
  DeviceEventEmitter.emit(earnedEvent, { adId: 'native-late-earned', reward: { amount: 15, type: 'coins' } });
  expect(recovered).toHaveBeenCalledTimes(1);
  await late.dispose();
  expect(nativeBridge.disposeAd).toHaveBeenCalledTimes(1);
  DeviceEventEmitter.emit(deletedEvent, { adId: 'native-another-ad', retainRewardListener: false });
  expect(DeviceEventEmitter.listenerCount(earnedEvent)).toBe(baselineEarned);
  expect(DeviceEventEmitter.listenerCount(deletedEvent)).toBe(baselineDeleted);
});
