/* eslint-disable @typescript-eslint/no-require-imports */
import type { Level } from '@/core/engine';
import type { HelpAnalyticsContext } from '@/features/analytics/helpContext';
import type { AppliedHintPayment } from '../hintJournal';

jest.mock('@/features/analytics', () => ({
  trackOnce: jest.fn(() => 'accepted'), isAnalyticsCollectionEnabled: jest.fn(() => true),
}));

const level: Level = {
  id: 6, globalId: 6, world: 'world1', letters: ['к', 'о', 'т'], difficulty: 1,
  contentVersion: 'test-content-v1', fingerprint: 'private-test-fingerprint',
  grid: { rows: 1, cols: 3, cells: [
    { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
  ] },
  answers: [{ word: 'кот', dir: 'H', cells: [
    { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
  ] }], bonusPool: [],
};

const context: HelpAnalyticsContext = {
  origin_interaction_id: 'flow:original', interaction_id: 'action:original', modal_id: 'modal:original',
  levelKey: 'campaign:6', levelId: 6, requested_hint: 'letter', displayed_cost: 50, balance: 60,
};

function runtime(sharedStorage?: typeof import('@/core/storage')) {
  let loaded!: {
    storageModule: typeof import('@/core/storage');
    useCurrency: typeof import('@/features/currency').useCurrency;
    useGame: typeof import('../store').useGame;
    revealLetter: typeof import('../hintJournal').revealLetter;
    replayPendingLetterHint: typeof import('../hintJournal').replayPendingLetterHint;
    purchaseSemanticClue: typeof import('@/features/hints').purchaseSemanticClue;
    trackOnce: jest.Mock;
  };
  jest.isolateModules(() => {
    if (sharedStorage) jest.doMock('@/core/storage', () => sharedStorage);
    const storageModule = require('@/core/storage');
    if (!sharedStorage) storageModule.storage.clearAll();
    const { useCurrency, flushWalletAnalytics } = require('@/features/currency');
    const { useGame } = require('../store');
    const { revealLetter, replayPendingLetterHint } = require('../hintJournal');
    const { purchaseSemanticClue } = require('@/features/hints');
    const { trackOnce } = require('@/features/analytics');
    flushWalletAnalytics();
    trackOnce.mockClear();
    loaded = { storageModule, useCurrency, useGame, revealLetter, replayPendingLetterHint, purchaseSemanticClue, trackOnce };
  });
  return loaded;
}

beforeEach(() => jest.resetModules());
afterEach(() => { jest.dontMock('@/core/storage'); jest.restoreAllMocks(); });

test('50-coin letter observes only a durable applied cell and its exact debit', () => {
  const { useGame, useCurrency, revealLetter, trackOnce, storageModule: { storage, KEYS } } = runtime();
  useGame.getState().start(level);
  const onApplied = jest.fn<void, [AppliedHintPayment]>();
  expect(revealLetter('campaign:6', context, onApplied)).toBe('applied');
  expect(onApplied).toHaveBeenCalledTimes(1);
  expect(useGame.getState().play?.filled['0,0']).toBe('к');
  expect(JSON.parse(storage.getString(KEYS.gameCurrentNormal)!).filled['0,0']).toBe('к');
  expect(useCurrency.getState().getTransaction(onApplied.mock.calls[0][0].effectId))
    .toEqual(onApplied.mock.calls[0][0].transaction);
  expect(onApplied.mock.calls[0][0]).toMatchObject({ chargedNow: 50, context,
    timeKnown: true, appliedAtMs: expect.any(Number),
    transaction: { delta: -50, balanceBefore: 60, balanceAfter: 10, context } });
  const transactions = trackOnce.mock.calls.filter(([event]) => event === 'wallet_transaction');
  expect(transactions).toHaveLength(1);
  expect(transactions[0][2].transaction_id).toBe(onApplied.mock.calls[0][0].transaction!.id);
  expect(useCurrency.getState().coins).toBe(10);
});

test('restart after debit before cell apply keeps origin, action, modal and transaction without another charge', () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  const first = runtime();
  first.useGame.getState().start(level);
  const { storage, KEYS } = first.storageModule;
  const write = storage.set.bind(storage);
  const failure = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.gameCurrentNormal) throw new Error('snapshot failed');
    write(key, value);
  });
  const failedObserver = jest.fn();
  expect(() => first.revealLetter('campaign:6', context, failedObserver)).toThrow('snapshot failed');
  expect(failedObserver).not.toHaveBeenCalled();
  const intent = JSON.parse(storage.getString(KEYS.pendingHint)!);
  const original = first.useCurrency.getState().getTransaction(intent.effectId)!;
  expect(intent.context).toEqual(context);
  expect(original.occurredAtMs).toBe(1000);
  expect(first.useCurrency.getState().coins).toBe(10);
  expect(first.useGame.getState().play?.filled['0,0']).toBeUndefined();
  failure.mockRestore();
  now.mockReturnValue(8000);
  const second = runtime(first.storageModule);
  second.useGame.getState().start(level);
  const onApplied = jest.fn();
  expect(second.revealLetter('campaign:6', { origin_interaction_id: 'flow:foreign', interaction_id: 'action:foreign' }, onApplied)).toBe('applied');
  expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ effectId: intent.effectId,
    chargedNow: 0, context, transaction: original, appliedAtMs: 8000, timeKnown: true }));
  expect(second.useCurrency.getState().coins).toBe(10);
  expect(second.useGame.getState().hintsUsed).toEqual(['bulb']);
  expect(second.replayPendingLetterHint('campaign:6', onApplied)).toBeNull();
  expect(onApplied).toHaveBeenCalledTimes(1);
});

test('replaying an applied cleanup failure preserves application time and payment idempotency', () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(2000);
  const first = runtime();
  first.useGame.getState().start(level);
  const { storage, KEYS } = first.storageModule;
  const remove = storage.remove.bind(storage);
  const failure = jest.spyOn(storage, 'remove').mockImplementation((key) => {
    if (key === KEYS.pendingHint) throw new Error('cleanup failed');
    return remove(key);
  });
  const onApplied = jest.fn();
  expect(first.revealLetter('campaign:6', context, onApplied)).toBe('applied');
  const original = onApplied.mock.calls[0][0];
  expect(JSON.parse(storage.getString(KEYS.pendingHint)!)).toMatchObject({ status: 'applied', appliedAtMs: 2000 });
  failure.mockRestore();
  now.mockReturnValue(9000);
  const second = runtime(first.storageModule);
  second.useGame.getState().start(level);
  expect(second.replayPendingLetterHint('campaign:6', onApplied)).toBe('applied');
  expect(onApplied).toHaveBeenLastCalledWith({ ...original, chargedNow: 0 });
  expect(second.useCurrency.getState().coins).toBe(10);
  expect(second.useGame.getState().hintsUsed).toEqual(['bulb']);
});

test('proven already-filled recovery without an apply timestamp has unknown time', () => {
  const first = runtime();
  first.useGame.getState().start(level);
  const { storage, KEYS } = first.storageModule;
  const write = storage.set.bind(storage);
  const remove = storage.remove.bind(storage);
  const failedSettle = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.pendingHint && JSON.parse(String(value)).status === 'applied') throw new Error('settle failed');
    write(key, value);
  });
  const failedClear = jest.spyOn(storage, 'remove').mockImplementation((key) => {
    if (key === KEYS.pendingHint) throw new Error('clear failed');
    return remove(key);
  });
  expect(first.revealLetter('campaign:6', context)).toBe('applied');
  const pending = JSON.parse(storage.getString(KEYS.pendingHint)!);
  expect(pending).toMatchObject({ initialLetterHintCount: 0, context });
  expect(pending.appliedAtMs).toBeUndefined();
  failedSettle.mockRestore();
  failedClear.mockRestore();
  const second = runtime(first.storageModule);
  second.useGame.getState().start(level);
  const onApplied = jest.fn();
  expect(second.replayPendingLetterHint('campaign:6', onApplied)).toBe('applied');
  expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ chargedNow: 0, timeKnown: false,
    context, transaction: { ...first.useCurrency.getState().getTransaction(pending.effectId) } }));
  expect(onApplied.mock.calls[0][0]).not.toHaveProperty('appliedAtMs');
});

test('a legacy filled intent without actual hint evidence cannot publish a help callback', () => {
  const { useGame, replayPendingLetterHint, storageModule: { storage, KEYS } } = runtime();
  useGame.getState().start(level);
  const attempt = useGame.getState().snapshot!.attemptId;
  useGame.getState().submit('кот');
  storage.set(KEYS.pendingHint, JSON.stringify({ version: 1, puzzleKey: 'campaign:6', cell: '0,0',
    effectId: `hint:campaign:6:${attempt}:0,0`, payment: 'coins' }));
  const onApplied = jest.fn();
  expect(replayPendingLetterHint('campaign:6', onApplied)).toBe('applied');
  expect(onApplied).not.toHaveBeenCalled();
});

test('semantic classification failure retries with the original debit while unrelated owned opens charge zero', () => {
  const first = runtime();
  first.useGame.getState().start(level);
  const semanticContext = { ...context, requested_hint: 'semantic' as const, displayed_cost: 30 };
  const { storage, KEYS } = first.storageModule;
  const write = storage.set.bind(storage);
  const failure = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.gameCurrentNormal) throw new Error('classification failed');
    write(key, value);
  });
  const onApplied = jest.fn();
  expect(() => first.purchaseSemanticClue('campaign:6', level.fingerprint!, 'кот', semanticContext, onApplied))
    .toThrow('classification failed');
  expect(onApplied).not.toHaveBeenCalled();
  const effectId = `semantic-clue:campaign:6:${level.fingerprint}:кот`;
  const original = first.useCurrency.getState().getTransaction(effectId)!;
  expect(original).toMatchObject({ delta: -30, balanceBefore: 60, balanceAfter: 30, context: semanticContext });
  failure.mockRestore();
  const second = runtime(first.storageModule);
  second.useGame.getState().start(level);
  expect(second.purchaseSemanticClue('campaign:6', level.fingerprint!, 'кот', semanticContext, onApplied)).toBe('unlocked');
  expect(onApplied).toHaveBeenLastCalledWith(expect.objectContaining({ effectId, chargedNow: 0,
    context: semanticContext, transaction: original, timeKnown: true }));
  expect(second.useGame.getState().snapshot?.semanticHelpUsed).toBe(true);
  const newContext = { ...semanticContext, origin_interaction_id: 'flow:unrelated', interaction_id: 'action:unrelated' };
  expect(second.purchaseSemanticClue('campaign:6', level.fingerprint!, 'кот', newContext, onApplied)).toBe('unlocked');
  expect(onApplied).toHaveBeenLastCalledWith(expect.objectContaining({ chargedNow: 0,
    context: newContext, transaction: original }));
  expect(second.useCurrency.getState().coins).toBe(30);
  expect(second.useCurrency.getState().getTransaction(effectId)?.context?.origin_interaction_id).toBe('flow:original');
  expect(JSON.stringify(first.trackOnce.mock.calls)).not.toContain('кот');
  expect(second.trackOnce.mock.calls.some(([event]) => event === 'wallet_transaction')).toBe(false);
});

test('free intro help and optional observer exceptions do not create wallet transactions or failures', () => {
  const { useGame, useCurrency, revealLetter, purchaseSemanticClue, storageModule } = runtime();
  let intro!: Level;
  jest.isolateModules(() => {
    jest.doMock('@/core/storage', () => storageModule);
    const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack');
    assignIntroPackForCurrentProfile();
    intro = getIntroLevel(2);
  });
  useGame.getState().start(intro);
  const onApplied = jest.fn<void, [AppliedHintPayment]>(() => { throw new Error('optional observer failed'); });
  const walletBefore = { ...useCurrency.getState().appliedRewards };
  expect(revealLetter('campaign:2', context, onApplied)).toBe('applied');
  expect(purchaseSemanticClue('campaign:2', intro.fingerprint!, intro.answers[0].word, context, onApplied)).toBe('unlocked');
  expect(onApplied).toHaveBeenCalledTimes(2);
  for (const [payment] of onApplied.mock.calls) {
    expect(payment).toMatchObject({ chargedNow: 0, transaction: null, timeKnown: true });
  }
  expect(useCurrency.getState().coins).toBe(60);
  expect(useCurrency.getState().appliedRewards).toEqual(walletBefore);
});
