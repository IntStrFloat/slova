/* eslint-disable @typescript-eslint/no-require-imports */
import type { Level } from '@/core/engine/types';
import type { HelpAnalyticsContext } from '@/features/analytics/helpContext';
import type { AppliedHintPayment } from '@/features/game/hintJournal';

const mockReport = jest.fn<boolean, unknown[]>(() => true);
jest.mock('@/core/native/appmetrica', () => ({
  reportEvent: (...args: unknown[]) => mockReport(...args), isAppMetricaAvailable: () => true,
  isAppMetricaTestDevice: () => false, setDataSendingEnabled: () => true, getDataSendingPreference: () => null,
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
const context: HelpAnalyticsContext = { origin_interaction_id: 'help:original', interaction_id: 'action:original',
  modal_id: 'modal:original', attemptId: 'attempt:original', levelId: 6, levelKey: 'campaign:6', mode: 'campaign',
  requested_hint: 'letter', displayed_cost: 50, balance: 60, entry_source: 'no_coins' };

function runtime() {
  let loaded!: {
    saved: typeof import('@/core/storage'); analytics: typeof import('@/features/analytics');
    currency: typeof import('@/features/currency'); game: typeof import('@/features/game/store');
    journal: typeof import('@/features/game/hintJournal'); hints: typeof import('@/features/hints');
    trackAppliedHelp: typeof import('../help-telemetry').trackAppliedHelp;
  };
  jest.isolateModules(() => {
    const saved = require('@/core/storage') as typeof import('@/core/storage');
    saved.storage.clearAll();
    saved.storage.set(saved.KEYS.currency, JSON.stringify({ version: 2, coins: 60, gems: 0, newProfile: false,
      appliedRewards: { 'starter:coins': 1 } }));
    loaded = { saved, analytics: require('@/features/analytics'), currency: require('@/features/currency'),
      game: require('@/features/game/store'), journal: require('@/features/game/hintJournal'),
      hints: require('@/features/hints'), trackAppliedHelp: require('../help-telemetry').trackAppliedHelp };
  });
  loaded.game.useGame.getState().start(level);
  mockReport.mockClear();
  return loaded;
}
function events(name: string): Record<string, unknown>[] {
  return mockReport.mock.calls.filter(([event]) => event === name).map(([, properties]) => properties as Record<string, unknown>);
}
function inAttempt(app: ReturnType<typeof runtime>, overrides: HelpAnalyticsContext = {}): HelpAnalyticsContext {
  return { ...context, attemptId: app.game.useGame.getState().snapshot!.attemptId, ...overrides };
}
beforeEach(() => {
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
  jest.resetModules(); jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-04T09:00:00Z'));
  mockReport.mockReset().mockReturnValue(true);
});
afterEach(() => {
  jest.restoreAllMocks(); jest.useRealTimers();
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: true });
});

test('real letter fulfillment joins its durable wallet debit and repeats one analytics fact', () => {
  const app = runtime();
  let payment!: AppliedHintPayment;
  expect(app.journal.revealLetter('campaign:6', inAttempt(app), (value) => { payment = value; })).toBe('applied');
  const snapshot = app.game.useGame.getState().snapshot!;
  expect(snapshot.hintsUsed).toEqual(['bulb']);
  expect(app.saved.getJSON<{ filled?: Record<string, string> }>(app.saved.KEYS.gameCurrentNormal, {}).filled).toEqual(snapshot.filled);
  app.trackAppliedHelp(level, snapshot, payment, { kind: 'letter', displayedCost: 50 });
  app.trackAppliedHelp(level, snapshot, { ...payment, chargedNow: 0 }, { kind: 'letter', recovery: true });
  const debit = events('wallet_transaction');
  expect(debit).toHaveLength(1);
  expect(debit[0]).toMatchObject({ transaction_id: payment.transaction!.id, delta: -50,
    balance_before: 60, balance_after: 10, origin_interaction_id: 'help:original' });
  expect(events('help_used')).toHaveLength(1);
  expect(events('hint_used')).toHaveLength(1);
  expect(events('help_used')[0]).toMatchObject({ transaction_id: debit[0].transaction_id,
    charged_amount: 50, balance_before: 60, balance_after: 10,
    interaction_id: context.interaction_id, modal_id: context.modal_id, origin_interaction_id: context.origin_interaction_id });
  expect(app.currency.useCurrency.getState().coins).toBe(10);
  expect(JSON.stringify(mockReport.mock.calls)).not.toContain(payment.effectId);
  expect(JSON.stringify(mockReport.mock.calls)).not.toContain('кот');
});

test('a semantic classification retry links the original debit once without implying a new charge', () => {
  const app = runtime();
  const original = inAttempt(app, { requested_hint: 'semantic', displayed_cost: 30 });
  const write = app.saved.storage.set.bind(app.saved.storage);
  const failure = jest.spyOn(app.saved.storage, 'set').mockImplementation((key, value) => {
    if (key === app.saved.KEYS.gameCurrentNormal) throw new Error('classification failed');
    return write(key, value);
  });
  const observer = jest.fn<void, [AppliedHintPayment]>();
  expect(() => app.hints.purchaseSemanticClue('campaign:6', level.fingerprint!, 'кот', original, observer))
    .toThrow('classification failed');
  expect(observer).not.toHaveBeenCalled();
  expect(events('help_used')).toEqual([]);
  const effectId = `semantic-clue:campaign:6:${level.fingerprint}:кот`;
  const debit = app.currency.useCurrency.getState().getTransaction(effectId)!;
  failure.mockRestore();
  jest.advanceTimersByTime(1000);
  const retry = { ...original, interaction_id: 'action:retry', displayed_cost: 0, balance: 30 };
  expect(app.hints.purchaseSemanticClue('campaign:6', level.fingerprint!, 'кот', retry, observer)).toBe('unlocked');
  const payment = observer.mock.calls[0][0];
  expect(payment).toMatchObject({ chargedNow: 0, transaction: debit, context: retry });
  app.trackAppliedHelp(level, app.game.useGame.getState().snapshot!, payment, {
    kind: 'semantic', alreadyOwned: true, displayedCost: 0,
  });
  expect(events('wallet_transaction')).toHaveLength(1);
  expect(events('help_used')).toHaveLength(1);
  expect(events('help_used')[0]).toMatchObject({ transaction_id: debit.id, charged_amount: 30,
    displayed_cost: 0, balance_before: 60, balance_after: 30, interaction_id: 'action:retry',
    origin_interaction_id: original.origin_interaction_id });
  expect(app.currency.useCurrency.getState().coins).toBe(30);
});

test('an unrelated already-owned semantic open reports zero and does not adopt another origin debit', () => {
  const app = runtime();
  const observer = jest.fn<void, [AppliedHintPayment]>();
  const original = inAttempt(app, { requested_hint: 'semantic', displayed_cost: 30 });
  app.hints.purchaseSemanticClue('campaign:6', level.fingerprint!, 'кот', original, observer);
  const first = observer.mock.calls[0][0];
  app.trackAppliedHelp(level, app.game.useGame.getState().snapshot!, first, { kind: 'semantic', displayedCost: 30 });
  const unrelated = { ...original, origin_interaction_id: 'help:unrelated', interaction_id: 'action:unrelated', displayed_cost: 0 };
  app.hints.purchaseSemanticClue('campaign:6', level.fingerprint!, 'кот', unrelated, observer);
  const second = observer.mock.calls[1][0];
  expect(second.transaction?.id).toBe(first.transaction?.id);
  app.trackAppliedHelp(level, app.game.useGame.getState().snapshot!, second, {
    kind: 'semantic', alreadyOwned: true, displayedCost: 0,
  });
  expect(events('wallet_transaction')).toHaveLength(1);
  expect(events('help_used')).toHaveLength(2);
  const reopened = events('help_used')[1];
  expect(reopened).toMatchObject({ charged_amount: 0, paidWith: 'owned', displayed_cost: 0,
    interaction_id: 'action:unrelated', origin_interaction_id: 'help:unrelated' });
  for (const key of ['transaction_id', 'balance_before', 'balance_after']) expect(reopened).not.toHaveProperty(key);
  expect(app.currency.useCurrency.getState().coins).toBe(30);
});

test('free help records fulfillment without creating a debit or invented transaction ID', () => {
  const app = runtime();
  app.trackAppliedHelp(level, app.game.useGame.getState().snapshot!, {
    effectId: 'private:free', transaction: null, chargedNow: 0,
    context: inAttempt(app, { displayed_cost: 0 }), appliedAtMs: Date.now(), timeKnown: true,
  }, { kind: 'letter', displayedCost: 0 });
  expect(events('help_used')).toHaveLength(1);
  expect(events('help_used')[0]).toMatchObject({ charged_amount: 0, paidWith: 'free', cost: 0 });
  expect(events('help_used')[0]).not.toHaveProperty('transaction_id');
  expect(events('wallet_transaction')).toEqual([]);
  expect(app.currency.useCurrency.getState().coins).toBe(60);
});

test('an explicit owned open after a consent boundary cannot disclose its historical debit', () => {
  const app = runtime();
  const observer = jest.fn<void, [AppliedHintPayment]>();
  const original = inAttempt(app, { requested_hint: 'semantic', displayed_cost: 30 });
  app.hints.purchaseSemanticClue('campaign:6', level.fingerprint!, 'кот', original, observer);
  const originalDebit = observer.mock.calls[0][0].transaction!;
  jest.advanceTimersByTime(1000);
  app.saved.setJSON('analytics.consent-epoch.v1', { version: 1, startedAtMs: Date.now() });
  mockReport.mockClear();
  app.hints.purchaseSemanticClue('campaign:6', level.fingerprint!, 'кот', {
    ...original, interaction_id: 'action:after-consent', displayed_cost: 0,
  }, observer);
  const payment = observer.mock.calls[1][0];
  expect(payment.transaction!.id).toBe(originalDebit.id);
  app.trackAppliedHelp(level, app.game.useGame.getState().snapshot!, payment, {
    kind: 'semantic', alreadyOwned: true, displayedCost: 0,
  });
  expect(events('help_used')).toHaveLength(1);
  expect(events('help_used')[0]).toMatchObject({ charged_amount: 0, paidWith: 'owned' });
  for (const key of ['transaction_id', 'balance_before', 'balance_after']) expect(events('help_used')[0]).not.toHaveProperty(key);
  expect(events('wallet_transaction')).toEqual([]);
});

test('restart does not invent an apply time and a known original time remains original', () => {
  const app = runtime();
  const snapshot = app.game.useGame.getState().snapshot!;
  const unknown: AppliedHintPayment = { effectId: 'private:legacy', transaction: null, chargedNow: 0,
    context: inAttempt(app), timeKnown: false };
  app.trackAppliedHelp(level, snapshot, unknown, { kind: 'letter', recovery: true });
  expect(events('help_used')).toEqual([]);
  const appliedAtMs = Date.now();
  jest.advanceTimersByTime(60_000);
  app.trackAppliedHelp(level, snapshot, { ...unknown, timeKnown: true, appliedAtMs }, { kind: 'letter', recovery: true });
  expect(events('help_used')).toHaveLength(1);
  expect(events('help_used')[0]).toMatchObject({ occurred_at: new Date(appliedAtMs).toISOString(), recovery: true, timeKnown: true });
  expect(events('help_used')[0].occurred_at).not.toBe(new Date().toISOString());
});

test('an original recovery before the consent epoch stays suppressed at transport', () => {
  const app = runtime();
  const appliedAtMs = Date.now();
  jest.advanceTimersByTime(1000);
  app.saved.setJSON('analytics.consent-epoch.v1', { version: 1, startedAtMs: Date.now() });
  app.trackAppliedHelp(level, app.game.useGame.getState().snapshot!, {
    effectId: 'private:legacy', transaction: null, chargedNow: 0, context: inAttempt(app), appliedAtMs, timeKnown: true,
  }, { kind: 'letter', recovery: true });
  expect(events('help_used')).toEqual([]);
  expect(events('hint_used')).toEqual([]);
});

test('optional measurement failure never changes the committed help or balance', () => {
  const app = runtime();
  let payment!: AppliedHintPayment;
  app.journal.revealLetter('campaign:6', inAttempt(app), (value) => { payment = value; });
  jest.spyOn(app.analytics, 'trackOnce').mockImplementation(() => { throw new Error('measurement failed'); });
  expect(() => app.trackAppliedHelp(level, app.game.useGame.getState().snapshot!, payment, { kind: 'letter' })).not.toThrow();
  expect(app.currency.useCurrency.getState().coins).toBe(10);
  expect(app.game.useGame.getState().snapshot?.hintsUsed).toEqual(['bulb']);
});

test.each([
  { attemptId: 'attempt:foreign' }, { levelKey: 'campaign:7' }, { levelId: 7 }, { mode: 'daily' as const },
  { contentVersion: 'different-content' }, { content_fingerprint: 'fp_0000000000000000' },
])('conflicting saved help identity %p cannot relabel a real applied hint', (conflict) => {
  const app = runtime();
  let payment!: AppliedHintPayment;
  app.journal.revealLetter('campaign:6', inAttempt(app, conflict), (value) => { payment = value; });
  expect(payment.transaction).not.toBeNull();
  expect(app.currency.useCurrency.getState().coins).toBe(10);
  app.trackAppliedHelp(level, app.game.useGame.getState().snapshot!, payment, { kind: 'letter' });
  expect(events('help_used')).toEqual([]);
  expect(events('hint_used')).toEqual([]);
  expect(app.game.useGame.getState().snapshot?.hintsUsed).toEqual(['bulb']);
});
