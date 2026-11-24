/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/features/analytics', () => ({
  trackOnce: jest.fn(() => 'accepted'), isAnalyticsCollectionEnabled: jest.fn(() => true),
}));

function wallet(sharedStorage?: typeof import('@/core/storage')) {
  let loaded!: {
    storageModule: typeof import('@/core/storage');
    useCurrency: typeof import('../index').useCurrency;
    flushWalletAnalytics: typeof import('../index').flushWalletAnalytics;
    trackOnce: jest.Mock;
    enabled: jest.Mock;
  };
  jest.isolateModules(() => {
    if (sharedStorage) jest.doMock('@/core/storage', () => sharedStorage);
    const storageModule = require('@/core/storage');
    if (!sharedStorage) storageModule.storage.clearAll();
    const { useCurrency, flushWalletAnalytics } = require('../index');
    const { trackOnce, isAnalyticsCollectionEnabled } = require('@/features/analytics');
    flushWalletAnalytics();
    trackOnce.mockClear();
    loaded = { storageModule, useCurrency, flushWalletAnalytics, trackOnce, enabled: isAnalyticsCollectionEnabled };
  });
  return loaded;
}

beforeEach(() => jest.resetModules());
afterEach(() => { jest.dontMock('@/core/storage'); jest.restoreAllMocks(); });

test('a committed debit retains one transaction and frozen bounded context after flush and restart', () => {
  const first = wallet();
  const { useCurrency, trackOnce, storageModule } = first;
  const effectId = 'semantic-clue:campaign:6:private-revision:кот';
  const context = {
    origin_interaction_id: 'flow:original', interaction_id: 'action:original', modal_id: 'modal:original',
    attemptId: 'attempt:6', levelKey: 'campaign:6', levelId: 6, mode: 'campaign' as const,
    requested_hint: 'semantic' as const, displayed_cost: 30, balance: 60,
    content_fingerprint: 'сырой-отпечаток', word: 'кот', email: 'private@example.test',
  };
  expect(useCurrency.getState().spendOnce(effectId, 'coins', 30, context)).toBe('spent');
  const record = useCurrency.getState().getTransaction(effectId)!;
  expect(record).toMatchObject({ delta: -30, balanceBefore: 60, balanceAfter: 30,
    context: { origin_interaction_id: 'flow:original', interaction_id: 'action:original', displayed_cost: 30 } });
  expect(record.context).not.toHaveProperty('word');
  expect(record.context).not.toHaveProperty('email');
  expect(record.context).not.toHaveProperty('content_fingerprint');
  expect(useCurrency.getState().analyticsTransactions).toEqual([]);
  expect(JSON.parse(storageModule.storage.getString(storageModule.KEYS.currency)!).operationTransactions[effectId]).toEqual(record);
  const facts = trackOnce.mock.calls.filter(([event]) => event === 'wallet_transaction');
  expect(facts).toHaveLength(1);
  expect(facts[0][2]).toMatchObject({ transaction_id: record.id, origin_interaction_id: 'flow:original',
    interaction_id: 'action:original', delta: -30, balance_before: 60, balance_after: 30 });
  expect(JSON.stringify(facts)).not.toMatch(/кот|private@example|сырой|semantic-clue/);

  record.context!.origin_interaction_id = 'flow:mutated';
  record.balanceAfter = 999;
  expect(useCurrency.getState().getTransaction(effectId)).toMatchObject({ balanceAfter: 30,
    context: { origin_interaction_id: 'flow:original' } });

  const restarted = wallet(storageModule);
  expect(restarted.useCurrency.getState().coins).toBe(30);
  expect(restarted.useCurrency.getState().spendOnce(effectId, 'coins', 30, {
    origin_interaction_id: 'flow:new', interaction_id: 'action:new',
  })).toBe('already_spent');
  expect(restarted.useCurrency.getState().getTransaction(effectId)).toMatchObject({ id: record.id,
    delta: -30, context: { origin_interaction_id: 'flow:original', interaction_id: 'action:original' } });
  expect(restarted.trackOnce.mock.calls.some(([event]) => event === 'wallet_transaction')).toBe(false);
});

test.each(['throw', 'silent'] as const)('a %s wallet write failure publishes neither debit nor correlation record', (failure) => {
  const { useCurrency, trackOnce, storageModule: { storage, KEYS } } = wallet();
  const effectId = 'hint:failed:0,0';
  const before = storage.getString(KEYS.currency);
  const write = storage.set.bind(storage);
  jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.currency) {
      if (failure === 'throw') throw new Error('write failed');
      return;
    }
    write(key, value);
  });
  expect(() => useCurrency.getState().spendOnce(effectId, 'coins', 50, { origin_interaction_id: 'flow:failed' })).toThrow();
  expect(useCurrency.getState().coins).toBe(60);
  expect(useCurrency.getState().hasApplied(effectId)).toBe(false);
  expect(useCurrency.getState().getTransaction(effectId)).toBeNull();
  expect(storage.getString(KEYS.currency)).toBe(before);
  expect(trackOnce.mock.calls.some(([event]) => event === 'wallet_transaction')).toBe(false);
});

test('legacy applied operations never fabricate records and malformed optional metadata does not reset money', () => {
  const { storageModule } = wallet();
  const { storage, KEYS } = storageModule;
  const record = { id: 'wallet:old:1', currency: 'coins', delta: -30, balanceBefore: 115,
    balanceAfter: 85, occurredAtMs: 1000, source: 'hint_semantic', rewardId: 'private@example.test',
    context: { origin_interaction_id: 'flow:old', word: 'кот', levelId: 1.5, balance: -1,
      content_fingerprint: 'сырой-отпечаток' } };
  storage.set(KEYS.currency, JSON.stringify({ version: 2, coins: 85, gems: 4, newProfile: false,
    appliedRewards: { legacy: 1, broken: 1, valid: 1 },
    operationTransactions: { broken: { ...record, delta: 'invalid' }, valid: record },
    analyticsTransactions: [null, { ...record, source: 'raw_private_word' }] }));
  const { useCurrency } = wallet(storageModule);
  expect(useCurrency.getState()).toMatchObject({ coins: 85, gems: 4 });
  expect(useCurrency.getState().getTransaction('legacy')).toBeNull();
  expect(useCurrency.getState().spendOnce('legacy', 'coins', 50, { origin_interaction_id: 'flow:new' })).toBe('already_spent');
  expect(useCurrency.getState().getTransaction('legacy')).toBeNull();
  expect(useCurrency.getState().getTransaction('broken')).toBeNull();
  expect(useCurrency.getState().getTransaction('valid')).toMatchObject({ id: record.id,
    context: { origin_interaction_id: 'flow:old' } });
  expect(useCurrency.getState().getTransaction('valid')?.context).toEqual({ origin_interaction_id: 'flow:old' });
  expect(useCurrency.getState().getTransaction('valid')).not.toHaveProperty('rewardId');
});

test.each(['opt_out', 'collection_disabled', 'collection_error'] as const)(
  '%s creates no private or pending analytics record and cannot backfill on enable', (disabled) => {
    const { useCurrency, flushWalletAnalytics, trackOnce, enabled, storageModule: { storage, KEYS } } = wallet();
    if (disabled === 'opt_out') storage.set(KEYS.analytics, JSON.stringify({ optOut: true }));
    else if (disabled === 'collection_disabled') enabled.mockReturnValue(false);
    else enabled.mockImplementation(() => { throw new Error('optional analytics unavailable'); });
    expect(useCurrency.getState().spendOnce('hint:disabled', 'coins', 50, { origin_interaction_id: 'flow:disabled' })).toBe('spent');
    expect(useCurrency.getState().coins).toBe(10);
    expect(useCurrency.getState().getTransaction('hint:disabled')).toBeNull();
    expect(useCurrency.getState().analyticsTransactions).toEqual([]);
    storage.set(KEYS.analytics, JSON.stringify({ optOut: false }));
    enabled.mockImplementation(() => true);
    trackOnce.mockClear();
    flushWalletAnalytics('analytics_enabled');
    expect(useCurrency.getState().spendOnce('hint:disabled', 'coins', 50, { origin_interaction_id: 'flow:later' })).toBe('already_spent');
    expect(useCurrency.getState().getTransaction('hint:disabled')).toBeNull();
    expect(trackOnce.mock.calls.some(([event]) => event === 'wallet_transaction')).toBe(false);
  },
);

test('optional context and analytics failures cannot change committed wallet results', () => {
  const { useCurrency, trackOnce } = wallet();
  const context = Object.defineProperty({}, 'origin_interaction_id', {
    enumerable: true, get() { throw new Error('optional context unavailable'); },
  });
  trackOnce.mockImplementation(() => { throw new Error('optional analytics unavailable'); });
  expect(useCurrency.getState().spendOnce('hint:optional', 'coins', 50, context)).toBe('spent');
  expect(useCurrency.getState().coins).toBe(10);
  expect(useCurrency.getState().getTransaction('hint:optional')).toMatchObject({ delta: -50, context: {} });
});

test('content-derived ASCII effect IDs are private even when they pass the identifier alphabet', () => {
  const { useCurrency, trackOnce } = wallet();
  const effectId = 'semantic-clue:campaign:6:revision:privateword';
  expect(useCurrency.getState().spendOnce(effectId, 'coins', 30,
    { origin_interaction_id: 'flow:ascii', word: 'privateword' })).toBe('spent');
  expect(useCurrency.getState().getTransaction(effectId)).not.toHaveProperty('rewardId');
  expect(JSON.stringify(trackOnce.mock.calls)).not.toContain('privateword');
});

test('grant correlation preserves the original reward id and does not adopt a later flow', () => {
  const { useCurrency, trackOnce } = wallet();
  const effectId = 'wheel:spin:free';
  expect(useCurrency.getState().addOnce(effectId, 'coins', 25,
    { origin_interaction_id: 'flow:earned', interaction_id: 'action:earned' })).toBe(true);
  const original = useCurrency.getState().getTransaction(effectId)!;
  expect(original).toMatchObject({ delta: 25, balanceBefore: 60, balanceAfter: 85,
    rewardId: effectId, context: { origin_interaction_id: 'flow:earned', interaction_id: 'action:earned' } });
  expect(useCurrency.getState().addOnce(effectId, 'coins', 25, { origin_interaction_id: 'flow:later' })).toBe(false);
  expect(useCurrency.getState().getTransaction(effectId)).toEqual(original);
  expect(trackOnce.mock.calls.filter(([event]) => event === 'wallet_transaction')).toHaveLength(1);
});
