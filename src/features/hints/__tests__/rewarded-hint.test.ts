/* eslint-disable @typescript-eslint/no-require-imports */
import type { Level } from '@/core/engine';

const level: Level = {
  id: 6, globalId: 6, world: 'world1', letters: ['к', 'о', 'т'], difficulty: 1,
  contentVersion: 'reward-test-v1', fingerprint: 'reward-test-content',
  grid: { rows: 1, cols: 3, cells: [
    { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
  ] },
  answers: [{ word: 'кот', dir: 'H', cells: [
    { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
  ] }], bonusPool: [],
};

function runtime(shared?: typeof import('@/core/storage')) {
  if (shared) jest.doMock('@/core/storage', () => shared);
  const storageModule = require('@/core/storage') as typeof import('@/core/storage');
  if (!shared) storageModule.storage.clearAll();
  const { useCurrency } = require('@/features/currency') as typeof import('@/features/currency');
  const { useGame } = require('@/features/game/store') as typeof import('@/features/game/store');
  const hints = require('../rewarded-hint') as typeof import('../rewarded-hint');
  const flowModule = require('../help-flow') as typeof import('../help-flow');
  const semantic = require('../index') as typeof import('../index');
  const { puzzleIdentity } = require('@/features/analytics/puzzleLifecycle') as typeof import('@/features/analytics/puzzleLifecycle');
  useCurrency.setState({ coins: 7, gems: 0, appliedRewards: {}, operationTransactions: {} });
  useGame.getState().start(level);
  const snapshot = useGame.getState().snapshot!;
  const flow = flowModule.createHelpFlow({ id: 'flow:reward:letter', attemptId: snapshot.attemptId,
    levelKey: 'campaign:6', levelId: 6, mode: 'campaign', contentVersion: snapshot.contentVersion,
    contentFingerprint: puzzleIdentity(level, snapshot).content_fingerprint, requestedHint: 'letter', displayedCost: 50,
    balance: 7, entrySource: 'game_help', previouslyCompleted: false,
    initialLetterHintCount: 0 });
  return { storageModule, useCurrency, useGame, flow, snapshot, ...hints, ...semantic, ...flowModule };
}

beforeEach(() => { jest.resetModules(); jest.dontMock('@/core/storage'); });
afterEach(() => { jest.restoreAllMocks(); jest.dontMock('@/core/storage'); });

test('preparing, cancelling or retrying an offer grants neither a hint nor coins', () => {
  const f = runtime();
  const before = f.useGame.getState().snapshot;
  const receipt = f.prepareRewardedHint(f.flow, 'rewarded-hint:first')!;
  expect(receipt).toMatchObject({ kind: 'hint', amount: 1 });
  expect(f.prepareRewardedHint(f.flow, 'rewarded-hint:retry')).toEqual(receipt);
  expect(f.applyRewardedHint(f.flow.id)).toBe('unavailable');
  expect(f.hasEarnedRewardedHint(f.flow.id)).toBe(false);
  expect(f.rewardedHintCountForDay()).toBe(0);
  expect(f.useGame.getState().snapshot).toBe(before);
  expect(f.useCurrency.getState().coins).toBe(7);
});

test('one confirmed reward reveals the selected letter once and never spends existing coins', () => {
  const f = runtime();
  const receipt = f.prepareRewardedHint(f.flow, 'rewarded-hint:first')!;
  expect(f.persistRewardedHint(receipt)).toBe(true);
  expect(f.persistRewardedHint(receipt)).toBe(true);
  const applied = jest.fn();
  expect(f.applyRewardedHint(f.flow.id, applied)).toBe('applied');
  expect(f.applyRewardedHint(f.flow.id, applied)).toBe('applied');
  expect(f.useGame.getState().play!.filled).toEqual({ '0,0': 'к' });
  expect(f.useGame.getState().snapshot!.hintsUsed).toEqual(['bulb']);
  expect(f.useCurrency.getState().coins).toBe(7);
  expect(f.useCurrency.getState().appliedRewards).toEqual({});
  expect(applied).toHaveBeenCalledTimes(1);
  expect(applied.mock.calls[0][0]).toMatchObject({ chargedNow: 0, transaction: null, timeKnown: true });
  expect(f.rewardedHintCountForDay()).toBe(1);
});

test('receipt origin and offer identity must match the durable pre-show request', () => {
  const f = runtime();
  const receipt = f.prepareRewardedHint(f.flow, 'rewarded-hint:first')!;
  expect(f.persistRewardedHint({ ...receipt, amount: 60 })).toBe(false);
  expect(f.persistRewardedHint({ ...receipt, createdAtMs: receipt.createdAtMs + 1 })).toBe(false);
  expect(f.persistRewardedHint({ ...receipt, flowContext: { ...receipt.flowContext, attemptId: 'foreign' } })).toBe(false);
  expect(f.persistRewardedHint({ ...receipt, rewardId: 'missing' })).toBe(false);
  expect(f.hasEarnedRewardedHint(f.flow.id)).toBe(false);
});

test('the actual Game privacy fingerprint and help-flow context authorize the same frozen puzzle', () => {
  const f = runtime();
  const { puzzleIdentity } = require('@/features/analytics/puzzleLifecycle') as typeof import('@/features/analytics/puzzleLifecycle');
  const { selectHelpContext } = require('@/features/analytics/helpContext') as typeof import('@/features/analytics/helpContext');
  const identity = puzzleIdentity(level, f.snapshot);
  expect(f.flow.contentFingerprint).toBe(identity.content_fingerprint);
  expect(f.flow.contentFingerprint).not.toBe(f.snapshot.levelFingerprint);
  const context = selectHelpContext({ ...identity, ...f.helpFlowProperties(f.flow), entry_source: 'no_coins' });
  const receipt = f.prepareRewardedHint(f.flow, 'rewarded-hint:actual-context', context);
  expect(receipt).not.toBeNull();
  expect(receipt!.flowContext?.content_fingerprint).toBe(identity.content_fingerprint);
  expect(f.persistRewardedHint(receipt!)).toBe(true);
  expect(f.applyRewardedHint(f.flow.id)).toBe('applied');
  expect(f.useGame.getState().snapshot!.hintsUsed).toEqual(['bulb']);
  const foreign = { ...f.flow, id: 'flow:foreign:content', contentFingerprint: 'fp_wrong' };
  expect(f.prepareRewardedHint(foreign, 'rewarded-hint:foreign')).toBeNull();
});

test('earned entitlement survives cold restart and can be applied without another ad', () => {
  const first = runtime();
  const receipt = first.prepareRewardedHint(first.flow, 'rewarded-hint:first')!;
  first.persistRewardedHint(receipt);
  const shared = first.storageModule;
  jest.resetModules();
  const second = runtime(shared);
  expect(second.hasEarnedRewardedHint(first.flow.id)).toBe(true);
  expect(second.getEarnedRewardedHintFlow(first.snapshot.attemptId)?.id).toBe(first.flow.id);
  expect(second.applyRewardedHint(first.flow.id)).toBe('applied');
  expect(second.useGame.getState().snapshot!.hintsUsed).toEqual(['bulb']);
  expect(second.useCurrency.getState().coins).toBe(7);
});

test('game save failure keeps earned entitlement retryable without charging the wallet', () => {
  const f = runtime();
  f.persistRewardedHint(f.prepareRewardedHint(f.flow, 'rewarded-hint:first')!);
  const { storage, KEYS } = f.storageModule;
  const write = storage.set.bind(storage);
  const failed = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.gameCurrentNormal) throw new Error('game write failed');
    write(key, value);
  });
  expect(() => f.applyRewardedHint(f.flow.id)).toThrow('game write failed');
  expect(f.hasEarnedRewardedHint(f.flow.id)).toBe(true);
  expect(f.useGame.getState().play!.filled).toEqual({});
  failed.mockRestore();
  expect(f.applyRewardedHint(f.flow.id)).toBe('applied');
  expect(f.useCurrency.getState().coins).toBe(7);
});

test('crash after hint persistence but before applied marker cannot reveal a second letter', () => {
  const f = runtime();
  f.persistRewardedHint(f.prepareRewardedHint(f.flow, 'rewarded-hint:first')!);
  const { storage } = f.storageModule;
  const write = storage.set.bind(storage);
  const failed = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === 'game.rewarded-hint-entitlements.v1') throw new Error('marker write failed');
    write(key, value);
  });
  expect(() => f.applyRewardedHint(f.flow.id)).toThrow('marker write failed');
  expect(f.useGame.getState().snapshot!.hintsUsed).toEqual(['bulb']);
  failed.mockRestore();
  expect(f.applyRewardedHint(f.flow.id)).toBe('applied');
  expect(f.useGame.getState().play!.filled).toEqual({ '0,0': 'к' });
  expect(f.useGame.getState().snapshot!.hintsUsed).toEqual(['bulb']);
});

test('a different attempt retains the earned hint and receives no free effect', () => {
  const f = runtime();
  f.persistRewardedHint(f.prepareRewardedHint(f.flow, 'rewarded-hint:first')!);
  const original = f.useGame.getState();
  f.useGame.setState({ snapshot: { ...original.snapshot!, attemptId: 'new-attempt' } });
  expect(f.applyRewardedHint(f.flow.id)).toBe('pending');
  expect(f.hasEarnedRewardedHint(f.flow.id)).toBe(true);
  expect(f.useGame.getState().play!.filled).toEqual({});
  f.useGame.setState({ snapshot: original.snapshot });
  expect(f.applyRewardedHint(f.flow.id)).toBe('applied');
});

test('earned semantic hint unlocks its frozen word and later reopen spends no coins', () => {
  const f = runtime();
  const flow = f.createHelpFlow({ ...f.flow, id: 'flow:reward:semantic', requestedHint: 'semantic', displayedCost: 30 });
  const receipt = f.prepareRewardedHint(flow, 'rewarded-hint:semantic')!;
  f.persistRewardedHint(receipt);
  expect(f.applyRewardedHint(flow.id)).toBe('applied');
  expect(f.isSemanticClueUnlocked(flow.levelKey, f.snapshot.levelFingerprint, 'кот')).toBe(true);
  expect(f.purchaseSemanticClue(flow.levelKey, f.snapshot.levelFingerprint, 'кот')).toBe('unlocked');
  expect(f.useGame.getState().snapshot!.semanticHelpUsed).toBe(true);
  expect(f.useCurrency.getState().coins).toBe(7);
  expect(f.useCurrency.getState().appliedRewards).toEqual({});
});

test('daily entitlement is bound to its date, including across midnight', () => {
  const f = runtime();
  f.useGame.getState().start(level, 'daily', '2026-11-16');
  const snapshot = f.useGame.getState().snapshot!;
  const flow = f.createHelpFlow({ ...f.flow, id: 'flow:reward:daily', attemptId: snapshot.attemptId,
    mode: 'daily', dateKey: '2026-11-16', levelKey: 'daily:2026-11-16' });
  const receipt = f.prepareRewardedHint(flow, 'rewarded-hint:daily')!;
  expect(receipt).not.toBeNull();
  f.persistRewardedHint(receipt);
  f.useGame.setState({ snapshot: { ...snapshot, dailyId: '2026-11-17' } });
  expect(f.applyRewardedHint(flow.id)).toBe('pending');
  f.useGame.setState({ snapshot });
  expect(f.applyRewardedHint(flow.id)).toBe('applied');
});

test('corrupt ledger selectors fail closed without erasing pending evidence or crashing render', () => {
  const f = runtime();
  f.storageModule.storage.set('game.rewarded-hint-entitlements.v1', '{corrupt');
  expect(f.hasEarnedRewardedHint(f.flow.id)).toBe(false);
  expect(f.getEarnedRewardedHintFlow(f.snapshot.attemptId)).toBeNull();
  expect(f.rewardedHintCountForDay()).toBe(3);
  expect(() => f.prepareRewardedHint(f.flow, 'rewarded-hint:new')).toThrow();
  expect(f.storageModule.storage.getString('game.rewarded-hint-entitlements.v1')).toBe('{corrupt');
});

test('an applied marker whose UI flow was not finalized can resume without a second effect', () => {
  const f = runtime();
  f.persistRewardedHint(f.prepareRewardedHint(f.flow, 'rewarded-hint:first')!);
  f.applyRewardedHint(f.flow.id);
  expect(f.getEarnedRewardedHintFlow(f.snapshot.attemptId)?.id).toBe(f.flow.id);
  expect(f.applyRewardedHint(f.flow.id)).toBe('applied');
  expect(f.useGame.getState().snapshot!.hintsUsed).toEqual(['bulb']);
  f.markHelpFlowApplied(f.flow.id);
  expect(f.getEarnedRewardedHintFlow(f.snapshot.attemptId)).toBeNull();
});

test('an unreadable rewarded-clue ledger never falls back to charging the player', () => {
  const f = runtime();
  f.useCurrency.setState({ coins: 80 });
  f.storageModule.storage.set('game.semantic-clues.rewarded-v1', '{corrupt');
  expect(() => f.purchaseSemanticClue('campaign:6', f.snapshot.levelFingerprint, 'кот')).toThrow();
  expect(f.useCurrency.getState().coins).toBe(80);
  expect(f.storageModule.storage.getString('game.semantic-clues.rewarded-v1')).toBe('{corrupt');
});
