/* eslint-disable @typescript-eslint/no-require-imports */
import { MARATHON } from '@/core/config/marathon';
import type { MarathonSnapshot } from '../model';

const action = { mode: 'campaign' as const, puzzleKey: '1', actionDay: MARATHON.startDay, completedAtMs: MARATHON.startAtMs };
const retention = { campaignCompletions: { '1': MARATHON.startDay }, dailyCompletions: {} };

describe('marathon durable progress and coin outbox', () => {
  beforeEach(() => jest.resetModules());

  function fixture() {
    const { storage } = require('@/core/storage') as typeof import('@/core/storage');
    storage.clearAll();
    const marathon = require('../index') as typeof import('../index');
    return { storage, ...marathon };
  }

  test('the first reward is durable before display, and restoring or replaying cannot pay it twice', () => {
    const { storage, useMarathon, recordMarathonCompletion, reconcileMarathonRewards, loadMarathonSnapshot, MARATHON_STORAGE_KEYS } = fixture();
    const { useCurrency } = require('@/features/currency') as typeof import('@/features/currency');
    const before = useCurrency.getState().coins;
    const first = recordMarathonCompletion(action, retention);
    expect(first.accepted).toBe(true);
    expect(JSON.parse(storage.getString(MARATHON_STORAGE_KEYS.primary)!)).toMatchObject({
      completions: { 'campaign:1': MARATHON.startDay }, pendingCoinGrants: { [first.effects[0].id]: 10 },
    });
    expect(reconcileMarathonRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount))).toBe(1);
    expect(useCurrency.getState().coins).toBe(before + 10);
    useMarathon.setState(loadMarathonSnapshot());
    expect(recordMarathonCompletion(action, retention)).toEqual({ accepted: false, effects: first.effects });
    expect(reconcileMarathonRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount))).toBe(0);
    expect(useCurrency.getState().coins).toBe(before + 10);
  });

  test('a crash between retention settlement and marathon settlement recovers after the event', () => {
    const { useMarathon, recoverMarathonProgress, recordMarathonCompletion, getMarathonStatus } = fixture();
    const recovered = recoverMarathonProgress(retention);
    expect(recovered.accepted).toBe(true);
    expect(useMarathon.getState().pendingCoinGrants[recovered.effects[0].id]).toBe(10);
    expect(getMarathonStatus(useMarathon.getState(), MARATHON.endAtMs + 1).completionCount).toBe(1);
    expect(recordMarathonCompletion(action, retention)).toEqual({ accepted: false, effects: recovered.effects });
  });

  test('a crash after the wallet commit leaves the outbox payable once on retry', () => {
    const { useMarathon, recordMarathonCompletion, reconcileMarathonRewards, loadMarathonSnapshot } = fixture();
    const { useCurrency } = require('@/features/currency') as typeof import('@/features/currency');
    const before = useCurrency.getState().coins;
    const first = recordMarathonCompletion(action, retention);
    expect(() => reconcileMarathonRewards((id, amount) => {
      useCurrency.getState().addOnce(id, 'coins', amount);
      throw new Error('killed after wallet write');
    })).toThrow('killed after wallet write');
    useMarathon.setState(loadMarathonSnapshot());
    expect(useMarathon.getState().pendingCoinGrants[first.effects[0].id]).toBe(10);
    expect(useCurrency.getState().coins).toBe(before + 10);
    expect(reconcileMarathonRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount))).toBe(1);
    expect(useCurrency.getState().coins).toBe(before + 10);
    expect(useMarathon.getState().pendingCoinGrants).toEqual({});
  });

  test('recovering all seven stages pays exactly 150 coins and subsequent recovery pays nothing', () => {
    const { useMarathon, recoverMarathonProgress, recordMarathonCompletion, reconcileMarathonRewards, loadMarathonSnapshot, decodeMarathonSnapshot } = fixture();
    const { useCurrency } = require('@/features/currency') as typeof import('@/features/currency');
    const completed = { campaignCompletions: Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [String(index + 1), MARATHON.startDay]),
    ), dailyCompletions: {} };
    const before = useCurrency.getState().coins;
    expect(recoverMarathonProgress(completed).effects).toHaveLength(8);
    const replay = recordMarathonCompletion({ ...action, puzzleKey: '21' }, completed);
    expect(replay.effects.reduce((sum, effect) => sum + (effect.amount ?? 0), 0)).toBe(90);
    useMarathon.setState(loadMarathonSnapshot());
    expect(decodeMarathonSnapshot(JSON.stringify(useMarathon.getState()))).not.toBeNull();
    expect(reconcileMarathonRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount))).toBe(8);
    expect(useCurrency.getState().coins).toBe(before + 150);
    expect(recoverMarathonProgress(completed)).toEqual({ accepted: false, effects: [] });
    expect(reconcileMarathonRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount))).toBe(0);
    expect(useCurrency.getState().coins).toBe(before + 150);
  });

  test.each(['throw', 'silent'] as const)('a %s progress write fails before in-memory progress or any wallet reward', (failure) => {
    const { storage, useMarathon, recordMarathonCompletion, MARATHON_STORAGE_KEYS } = fixture();
    const original = storage.set.bind(storage);
    const write = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
      if (key === MARATHON_STORAGE_KEYS.primary) {
        if (failure === 'throw') throw new Error('disk full');
        return;
      }
      original(key, value);
    });
    try {
      expect(() => recordMarathonCompletion(action, retention)).toThrow(failure === 'throw' ? 'disk full' : 'not durable');
      expect(useMarathon.getState().completions).toEqual({});
      expect(useMarathon.getState().pendingCoinGrants).toEqual({});
    } finally { write.mockRestore(); }
    expect(recordMarathonCompletion(action, retention).accepted).toBe(true);
  });

  test('wallet and outbox-ack failures preserve the pending reward and recover without a duplicate', () => {
    const { storage, useMarathon, recordMarathonCompletion, reconcileMarathonRewards, MARATHON_STORAGE_KEYS } = fixture();
    const { useCurrency } = require('@/features/currency') as typeof import('@/features/currency');
    const first = recordMarathonCompletion(action, retention);
    expect(() => reconcileMarathonRewards(() => { throw new Error('wallet failure'); })).toThrow('wallet failure');
    expect(useMarathon.getState().pendingCoinGrants[first.effects[0].id]).toBe(10);
    const before = useCurrency.getState().coins;
    const original = storage.set.bind(storage);
    const write = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
      if (key === MARATHON_STORAGE_KEYS.primary) throw new Error('ack failure');
      original(key, value);
    });
    try {
      expect(() => reconcileMarathonRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount))).toThrow('ack failure');
      expect(useCurrency.getState().coins).toBe(before + 10);
      expect(useMarathon.getState().pendingCoinGrants[first.effects[0].id]).toBe(10);
    } finally { write.mockRestore(); }
    expect(reconcileMarathonRewards((id, amount) => useCurrency.getState().addOnce(id, 'coins', amount))).toBe(1);
    expect(useCurrency.getState().coins).toBe(before + 10);
  });

  test('a corrupt primary recovers from backup and retention repairs any newer progress', () => {
    const { storage, useMarathon, recordMarathonCompletion, loadMarathonSnapshot, recoverMarathonProgress, MARATHON_STORAGE_KEYS } = fixture();
    const first = recordMarathonCompletion(action, retention);
    const secondAction = { ...action, puzzleKey: '2' };
    const secondProof = { ...retention, campaignCompletions: { ...retention.campaignCompletions, '2': MARATHON.startDay } };
    recordMarathonCompletion(secondAction, secondProof);
    storage.set(MARATHON_STORAGE_KEYS.primary, '{bad');
    const loaded = loadMarathonSnapshot();
    expect(loaded.completions).toEqual({ 'campaign:1': MARATHON.startDay });
    expect(storage.getString(MARATHON_STORAGE_KEYS.primary)).toBe(JSON.stringify(loaded));
    useMarathon.setState(loaded);
    expect(recoverMarathonProgress(secondProof).accepted).toBe(true);
    expect(Object.keys(useMarathon.getState().completions)).toHaveLength(2);
    expect(Object.values(useMarathon.getState().rewardGrants)).toEqual(first.effects);
  });

  test('unreadable saves and read errors are preserved instead of minting a fresh reward', () => {
    const { storage, loadMarathonSnapshot, MARATHON_STORAGE_KEYS } = fixture();
    storage.set(MARATHON_STORAGE_KEYS.primary, '{broken-primary');
    storage.set(MARATHON_STORAGE_KEYS.backup, '{broken-backup');
    expect(() => loadMarathonSnapshot()).toThrow('preserving it for recovery');
    expect(storage.getString(MARATHON_STORAGE_KEYS.primary)).toBe('{broken-primary');
    expect(storage.getString(MARATHON_STORAGE_KEYS.backup)).toBe('{broken-backup');
    const read = jest.spyOn(storage, 'getString').mockImplementation(() => { throw new Error('read failure'); });
    try { expect(() => loadMarathonSnapshot()).toThrow('read failure'); } finally { read.mockRestore(); }
  });

  test('the decoder rejects inconsistent reward amounts, duplicate effects and fabricated progress', () => {
    const { recordMarathonCompletion, useMarathon, decodeMarathonSnapshot } = fixture();
    const first = recordMarathonCompletion(action, retention);
    const copy = () => JSON.parse(JSON.stringify(useMarathon.getState())) as MarathonSnapshot;
    const wrongAmount = copy();
    wrongAmount.rewardGrants[first.effects[0].id].amount = 150;
    expect(decodeMarathonSnapshot(JSON.stringify(wrongAmount))).toBeNull();
    const wrongDay = copy();
    wrongDay.completions['campaign:1'] = 'legacy';
    expect(decodeMarathonSnapshot(JSON.stringify(wrongDay))).toBeNull();
    const duplicate = copy();
    duplicate.completionEffectIds['campaign:1'].push(first.effects[0].id);
    expect(decodeMarathonSnapshot(JSON.stringify(duplicate))).toBeNull();
    expect(decodeMarathonSnapshot(JSON.stringify(copy()))).not.toBeNull();
  });
});


test('late valid completion recovery corrects expiry once with a higher final status revision', () => {
  jest.useFakeTimers().setSystemTime(MARATHON.endAtMs + 10_000);
  try {
    jest.isolateModules(() => {
      const { storage } = require('@/core/storage');
      storage.clearAll();
      const { useMarathon, recoverMarathonProgress, recordMarathonCompletion } = require('../index');
      recoverMarathonProgress({ campaignCompletions: {}, dailyCompletions: {} });
      expect(useMarathon.getState().terminalStatus).toMatchObject({ result: 'expired', revision: 1 });
      const proof = { campaignCompletions: {} as Record<string, string>, dailyCompletions: {} };
      for (let id = 1; id <= 21; id++) {
        proof.campaignCompletions[String(id)] = MARATHON.startDay;
        recordMarathonCompletion({ ...action, puzzleKey: String(id) }, proof);
      }
      expect(useMarathon.getState().terminalStatus).toMatchObject({ result: 'completed', revision: 2,
        occurredAtMs: MARATHON.startAtMs });
      recoverMarathonProgress(proof);
      expect(useMarathon.getState().terminalStatus.revision).toBe(2);
    });
  } finally { jest.useRealTimers(); }
});
