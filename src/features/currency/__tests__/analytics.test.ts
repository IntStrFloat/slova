/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/features/analytics', () => ({ trackOnce: jest.fn(() => 'accepted'), isAnalyticsCollectionEnabled: jest.fn(() => true) }));

function fixture() {
  const { storage, KEYS } = require('@/core/storage');
  storage.clearAll();
  const { useCurrency, flushWalletAnalytics } = require('../index');
  const { trackOnce } = require('@/features/analytics');
  flushWalletAnalytics();
  trackOnce.mockClear();
  return { storage, KEYS, useCurrency, flushWalletAnalytics, trackOnce };
}

beforeEach(() => jest.resetModules());

test('wallet facts reflect durable balance changes exactly once and contain no word effect IDs', () => {
  jest.isolateModules(() => {
    const { useCurrency, trackOnce } = fixture();
    const before = useCurrency.getState().coins;
    expect(useCurrency.getState().addOnce('bonus:campaign:9:кот', 'coins', 5)).toBe(true);
    expect(useCurrency.getState().addOnce('bonus:campaign:9:кот', 'coins', 5)).toBe(false);
    const facts = trackOnce.mock.calls.filter(([name]: [string]) => name === 'wallet_transaction');
    expect(facts).toHaveLength(1);
    expect(facts[0][2]).toMatchObject({ currency: 'coins', delta: 5, balance_before: before,
      balance_after: before + 5, source: 'bonus_word', sink: 'none' });
    expect(JSON.stringify(facts)).not.toContain('кот');
    expect(useCurrency.getState().analyticsTransactions).toEqual([]);
  });
});

test('silent storage failure cannot announce or expose an uncommitted credit', () => {
  jest.isolateModules(() => {
    const { storage, KEYS, useCurrency, trackOnce } = fixture();
    const before = useCurrency.getState().coins;
    const original = storage.set.bind(storage);
    const write = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
      if (key !== KEYS.currency) original(key, value);
    });
    try {
      expect(() => useCurrency.getState().addOnce('wheel:test:free', 'coins', 25)).toThrow('not durable');
      expect(useCurrency.getState().coins).toBe(before);
      expect(useCurrency.getState().hasApplied('wheel:test:free')).toBe(false);
      expect(trackOnce.mock.calls.some(([name]: [string]) => name === 'wallet_transaction')).toBe(false);
      expect(trackOnce).toHaveBeenCalledWith('wallet_transaction_failed', expect.any(String), expect.objectContaining({ reason: 'save_failed' }));
    } finally { write.mockRestore(); }
  });
});

test('a pending analytics journal retries with its original transaction and occurrence time', () => {
  jest.isolateModules(() => {
    const { storage, KEYS, useCurrency, flushWalletAnalytics, trackOnce } = fixture();
    trackOnce.mockReturnValue(null);
    useCurrency.getState().addOnce('wheel:test:free', 'coins', 25);
    const saved = JSON.parse(storage.getString(KEYS.currency));
    expect(saved.analyticsTransactions).toHaveLength(1);
    const fact = saved.analyticsTransactions[0];
    trackOnce.mockReturnValue('accepted');
    useCurrency.setState(saved);
    flushWalletAnalytics();
    expect(trackOnce).toHaveBeenCalledWith('wallet_transaction', fact.id, expect.objectContaining({
      transaction_id: fact.id, occurredAtMs: fact.occurredAtMs, delta: 25,
    }));
    expect(useCurrency.getState().analyticsTransactions).toEqual([]);
  });
});

test('opt-out discards pending facts and never journals subsequent money operations', () => {
  jest.isolateModules(() => {
    const { storage, KEYS, useCurrency, flushWalletAnalytics, trackOnce } = fixture();
    trackOnce.mockReturnValue(null);
    useCurrency.getState().addOnce('wheel:test:free', 'coins', 25);
    storage.set(KEYS.analytics, JSON.stringify({ optOut: true }));
    trackOnce.mockClear();
    flushWalletAnalytics();
    useCurrency.getState().spendOnce('hint:test', 'coins', 1);
    expect(useCurrency.getState().analyticsTransactions).toEqual([]);
    expect(trackOnce).not.toHaveBeenCalled();
  });
});


test('QA/off-collection wallet changes never replay after collection becomes enabled', () => {
  jest.isolateModules(() => {
    const { useCurrency, flushWalletAnalytics, trackOnce } = fixture();
    const { isAnalyticsCollectionEnabled } = require('@/features/analytics');
    isAnalyticsCollectionEnabled.mockReturnValue(false);
    const before = useCurrency.getState().coins;
    useCurrency.getState().addOnce('wheel:qa:free', 'coins', 25);
    expect(useCurrency.getState().analyticsTransactions).toEqual([]);
    trackOnce.mockClear();
    isAnalyticsCollectionEnabled.mockReturnValue(true);
    flushWalletAnalytics('analytics_enabled');
    expect(trackOnce.mock.calls.some(([name]: [string]) => name === 'wallet_transaction')).toBe(false);
    expect(trackOnce).toHaveBeenCalledWith('wallet_balance_observed', 'opening:coins:1', expect.objectContaining({
      balance: before + 25, source: 'analytics_enabled', currency: 'coins',
    }));
  });
});
