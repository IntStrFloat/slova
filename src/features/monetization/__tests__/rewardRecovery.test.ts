import { ECONOMY } from '@/core/config/economy';
import { KEYS, storage } from '@/core/storage';
import { dayKey } from '@/core/time';
import { useCurrency } from '@/features/currency';
import { useWheel, type WheelState } from '@/features/wheel';
import { loadGlobalLevel } from '@/features/levels';
import { useGame } from '@/features/game/store';
import { createHelpFlow, useHelpFlows } from '@/features/hints/help-flow';
import { puzzleIdentity } from '@/features/analytics/puzzleLifecycle';
import { applyRewardedHint, hasEarnedRewardedHint, prepareRewardedHint } from '@/features/hints/rewarded-hint';

import { recoverRewardedGrants, useRewardRecovery } from '../rewardRecovery';
import { acknowledgeNativeReward, readNativeEarnedRewards, type NativeRewardReceipt } from '../nativeRewardJournal';

jest.mock('../nativeRewardJournal', () => ({
  acknowledgeNativeReward: jest.fn(async () => {}),
  readNativeEarnedRewards: jest.fn(async () => []),
}));
jest.mock('@/features/analytics', () => ({ trackOnce: jest.fn(() => true), isAnalyticsCollectionEnabled: () => false }));

const read = jest.mocked(readNativeEarnedRewards);
const ack = jest.mocked(acknowledgeNativeReward);
let openingBalance = 0;

beforeEach(() => {
  storage.clearAll();
  useRewardRecovery.setState({ checking: false, readFailed: false, pendingIds: [], revision: 0 });
  useWheel.getState().reset();
  useCurrency.setState({ coins: 20, gems: 0, appliedRewards: {}, analyticsTransactions: [] });
  openingBalance = useCurrency.getState().coins;
  read.mockReset().mockResolvedValue([]);
  ack.mockReset().mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('earned free-hint recovery persists and acknowledges ownership without coins or an unexpected game effect', async () => {
  const level = loadGlobalLevel(6)!;
  useGame.setState({ snapshot: null, play: null });
  useHelpFlows.setState({ flows: {} });
  useGame.getState().start(level);
  const snapshot = useGame.getState().snapshot!;
  const flow = createHelpFlow({ id: 'help:recovery:free', attemptId: snapshot.attemptId,
    levelKey: 'campaign:6', levelId: 6, mode: 'campaign', contentVersion: snapshot.contentVersion,
    contentFingerprint: puzzleIdentity(level, snapshot).content_fingerprint, requestedHint: 'letter', displayedCost: 50,
    balance: openingBalance, entrySource: 'game_help', previouslyCompleted: false,
    initialLetterHintCount: 0 });
  const receipt = prepareRewardedHint(flow, 'rewarded-hint:recovery')!;
  read.mockResolvedValue([receipt]);
  expect((await recoverRewardedGrants()).granted).toEqual([receipt]);
  expect(hasEarnedRewardedHint(flow.id)).toBe(true);
  expect(ack).toHaveBeenCalledWith(receipt.rewardId);
  expect(useCurrency.getState().coins).toBe(openingBalance);
  expect(useCurrency.getState().hasApplied(receipt.rewardId)).toBe(false);
  expect(useGame.getState().snapshot!.hintsUsed).toHaveLength(0);
  expect(applyRewardedHint(flow.id)).toBe('applied');
  await recoverRewardedGrants();
  expect(applyRewardedHint(flow.id)).toBe('applied');
  expect(useGame.getState().snapshot!.hintsUsed).toHaveLength(1);
});

function earnedWheel(): NativeRewardReceipt {
  const receipt = useWheel.getState().prepareRewarded()!;
  expect(receipt).not.toBeNull();
  read.mockResolvedValue([receipt]);
  return receipt;
}

test('pre-show intention and cancellation never consume a daily spin or grant money', async () => {
  const receipt = useWheel.getState().prepareRewarded()!;
  expect(useWheel.getState().rewardedLeft()).toBe(ECONOMY.wheel.maxRewardedSpins);
  expect(useCurrency.getState().coins).toBe(openingBalance);
  expect(useWheel.getState().prepareRewarded()).toBeNull();
  expect(await recoverRewardedGrants({ releaseUnconfirmed: true })).toEqual({ granted: [], pending: [] });
  expect(useWheel.getState().preparedReward).toBeNull();
  expect(useWheel.getState().pendingSpin).toBeNull();
  expect(useWheel.getState().rewardedLeft()).toBe(ECONOMY.wheel.maxRewardedSpins);
  expect(ack).not.toHaveBeenCalledWith(receipt.rewardId);
});

test('earned before dismissal saves the frozen sector; process restart recovery grants it exactly once', async () => {
  const receipt = earnedWheel();
  expect(useWheel.getState().confirmRewarded(receipt)).toBe(true);
  expect(useWheel.getState().confirmRewarded(receipt)).toBe(true);
  const durable = JSON.parse(storage.getString(KEYS.wheel)!) as WheelState;
  expect(durable.pendingSpin).toMatchObject({ effectId: receipt.rewardId, value: receipt.amount, sector: receipt.sector });
  expect(durable.rewardedUsed).toBe(1);
  // Restart discards memory; only the persisted wheel and native earned record remain.
  useWheel.setState(durable);
  await recoverRewardedGrants();
  await recoverRewardedGrants();
  expect(useCurrency.getState().coins).toBe(openingBalance + receipt.amount);
  expect(useCurrency.getState().hasApplied(receipt.rewardId)).toBe(true);
  expect(useWheel.getState().pendingSpin).toBeNull();
  expect(useWheel.getState().rewardedUsed).toBe(1);
});

test('kill before JS callback is recovered from native earned receipt even when no pendingSpin exists', async () => {
  const receipt = earnedWheel();
  expect(useWheel.getState().pendingSpin).toBeNull();
  const result = await recoverRewardedGrants();
  expect(result.granted).toEqual([receipt]);
  expect(useCurrency.getState().coins).toBe(openingBalance + receipt.amount);
  expect(ack).toHaveBeenCalledWith(receipt.rewardId);
});

test('wallet failure remains pending, consumes no second ad, and retries after restart without duplicate', async () => {
  const receipt = earnedWheel();
  const write = storage.set.bind(storage);
  const failure = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.currency) throw new Error('disk unavailable');
    return write(key, value);
  });
  const failed = await recoverRewardedGrants();
  expect(failed.pending).toEqual([receipt]);
  expect(useCurrency.getState().coins).toBe(openingBalance);
  expect(useWheel.getState().pendingSpin?.effectId).toBe(receipt.rewardId);
  expect(ack).not.toHaveBeenCalled();
  failure.mockRestore();
  await recoverRewardedGrants();
  await recoverRewardedGrants();
  expect(useCurrency.getState().coins).toBe(openingBalance + receipt.amount);
  expect(useWheel.getState().rewardedUsed).toBe(1);
});

test('spin save failure after earned is recoverable, and success is acknowledged only after both writes', async () => {
  const receipt = earnedWheel();
  const failure = jest.spyOn(storage, 'set').mockImplementationOnce(() => { throw new Error('wheel write failure'); });
  expect((await recoverRewardedGrants()).pending).toEqual([receipt]);
  expect(ack).not.toHaveBeenCalled();
  failure.mockRestore();
  await recoverRewardedGrants();
  expect(useCurrency.getState().coins).toBe(openingBalance + receipt.amount);
  expect(ack).toHaveBeenCalledWith(receipt.rewardId);
});

test('failed native acknowledgment and concurrent recoveries do not duplicate a grant', async () => {
  const receipt = earnedWheel();
  ack.mockRejectedValueOnce(new Error('ack failure'));
  const first = recoverRewardedGrants();
  expect(recoverRewardedGrants()).toBe(first);
  await first;
  await recoverRewardedGrants();
  expect(useCurrency.getState().coins).toBe(openingBalance + receipt.amount);
  expect(useWheel.getState().rewardedUsed).toBe(1);
});

test('earned previous-day spin is honored without consuming the new day allowance', async () => {
  const receipt = { ...earnedWheel(), offerDay: '2026-01-01' };
  expect(dayKey()).not.toBe(receipt.offerDay);
  read.mockResolvedValue([receipt]);
  await recoverRewardedGrants();
  expect(useCurrency.getState().coins).toBe(openingBalance + receipt.amount);
  expect(useWheel.getState().rewardedLeft()).toBe(ECONOMY.wheel.maxRewardedSpins);
});

test('direct guaranteed coin receipt recovers independently of the wheel', async () => {
  const receipt: NativeRewardReceipt = { version: 1, rewardId: 'rewarded-coins:test:earned',
    kind: 'coins', offerDay: dayKey(), createdAtMs: Date.now(), amount: ECONOMY.rewardedCoins };
  read.mockResolvedValue([receipt]);
  await recoverRewardedGrants();
  await recoverRewardedGrants();
  expect(useCurrency.getState().coins).toBe(openingBalance + ECONOMY.rewardedCoins);
  expect(useWheel.getState().rewardedUsed).toBe(0);
});

test('late native earned during an older pass forces a fresh read before recovery unblocks', async () => {
  const firstReceipt: NativeRewardReceipt = { version: 1, kind: 'coins', rewardId: 'rewarded-coins:test:first',
    offerDay: dayKey(), createdAtMs: Date.now(), amount: 60 };
  const lateReceipt = { ...firstReceipt, rewardId: 'rewarded-coins:test:late' };
  let finishAck!: () => void;
  ack.mockImplementationOnce(() => new Promise<void>((resolve) => { finishAck = resolve; }));
  read.mockResolvedValueOnce([firstReceipt]).mockResolvedValue([lateReceipt]);
  const first = recoverRewardedGrants();
  await Promise.resolve(); await Promise.resolve();
  expect(ack).toHaveBeenCalledWith(firstReceipt.rewardId);
  expect(recoverRewardedGrants()).toBe(first);
  expect(useRewardRecovery.getState().checking).toBe(true);
  finishAck();
  const result = await first;
  expect(read).toHaveBeenCalledTimes(2);
  expect(result.granted.map((receipt) => receipt.rewardId)).toEqual([firstReceipt.rewardId, lateReceipt.rewardId]);
  expect(useCurrency.getState().coins).toBe(openingBalance + 120);
  expect(useRewardRecovery.getState()).toMatchObject({ checking: false, pendingIds: [] });
});

test('failed wheel finalization remains pending even after wallet confirmation', async () => {
  const receipt = earnedWheel();
  const write = storage.set.bind(storage);
  const failure = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.wheel && typeof value === 'string' && JSON.parse(value).grantedSpins?.[receipt.rewardId]) {
      throw new Error('claim finalization failed');
    }
    return write(key, value);
  });
  expect((await recoverRewardedGrants()).pending).toEqual([receipt]);
  expect(useCurrency.getState().hasApplied(receipt.rewardId)).toBe(true);
  expect(useRewardRecovery.getState().pendingIds).toEqual([receipt.rewardId]);
  expect(ack).not.toHaveBeenCalled();
  failure.mockRestore();
  expect((await recoverRewardedGrants()).pending).toEqual([]);
  expect(useCurrency.getState().coins).toBe(openingBalance + receipt.amount);
});

test('journal read failure is an unknown check failure, not a fabricated earned entitlement', async () => {
  read.mockRejectedValueOnce(new Error('journal unavailable'));
  await expect(recoverRewardedGrants()).rejects.toThrow('journal unavailable');
  expect(useRewardRecovery.getState()).toMatchObject({ readFailed: true, checking: false, pendingIds: [] });
  expect(useCurrency.getState().coins).toBe(openingBalance);
});

test('recovery forwards only frozen bounded help context to the real wallet and ages pending from earned time', async () => {
  const analytics = jest.requireMock('@/features/analytics') as { trackOnce: jest.Mock };
  const receipt: NativeRewardReceipt = { version: 1, kind: 'coins', rewardId: 'earned-context', offerDay: dayKey(),
    createdAtMs: Date.now() - 60_000, earnedAtMs: Date.now() - 2_000, amount: 60,
    flowContext: { origin_interaction_id: 'origin1', interaction_id: 'tap1', attemptId: 'attempt1',
      requested_hint: 'letter', displayed_cost: 50, raw_word: 'PRIVATE_WORD' } };
  read.mockResolvedValue([receipt]);
  const original = useCurrency.getState().addOnce;
  const add = jest.fn(original);
  useCurrency.setState({ addOnce: add });
  const write = storage.set.bind(storage);
  const failure = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.currency) throw new Error('save unavailable');
    return write(key, value);
  });
  try {
    expect((await recoverRewardedGrants()).pending).toEqual([receipt]);
    expect(add).toHaveBeenCalledWith(receipt.rewardId, 'coins', 60, {
      origin_interaction_id: 'origin1', interaction_id: 'tap1', attemptId: 'attempt1',
      requested_hint: 'letter', displayed_cost: 50,
    });
    expect(analytics.trackOnce).toHaveBeenCalledWith('reward_grant_failed', expect.any(String),
      expect.objectContaining({ pending_age_ms: expect.any(Number), normalized_reason: 'save_failed', origin_interaction_id: 'origin1' }));
    const failureEvent = analytics.trackOnce.mock.calls.filter((call) => call[0] === 'reward_grant_failed').at(-1)[2];
    expect(failureEvent.pending_age_ms).toBeGreaterThanOrEqual(2_000);
    expect(failureEvent.pending_age_ms).toBeLessThan(5_000);
    expect(JSON.stringify(failureEvent)).not.toContain('PRIVATE_WORD');
  } finally { failure.mockRestore(); useCurrency.setState({ addOnce: original }); }
});
