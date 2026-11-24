/* eslint-disable @typescript-eslint/no-require-imports */
import type { HelpFlowInput } from '../help-flow';

function fixture(balance = 20, levelId = 6) {
  const storageModule = require('@/core/storage') as typeof import('@/core/storage');
  storageModule.storage.clearAll();
  storageModule.storage.set(storageModule.KEYS.currency, JSON.stringify({ coins: balance, gems: 0 }));
  const { loadGlobalLevel } = require('@/features/levels') as typeof import('@/features/levels');
  const { useGame } = require('@/features/game/store') as typeof import('@/features/game/store');
  const { useCurrency } = require('@/features/currency') as typeof import('@/features/currency');
  const flowModule = require('../help-flow') as typeof import('../help-flow');
  const level = loadGlobalLevel(levelId)!;
  useGame.getState().start(level, 'normal');
  const snapshot = useGame.getState().snapshot!;
  const input: HelpFlowInput = { id: 'help:test:origin', attemptId: snapshot.attemptId,
    levelKey: `campaign:${levelId}`, levelId, mode: 'campaign', contentVersion: snapshot.contentVersion,
    requestedHint: 'letter', displayedCost: 50, balance, entrySource: 'no_coins', previouslyCompleted: false,
    initialLetterHintCount: snapshot.hintsUsed.length };
  return { ...storageModule, ...flowModule, useCurrency, useGame, level, snapshot, input };
}

beforeEach(() => { jest.resetModules(); jest.dontMock('@/core/storage'); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('explicit request identity and private initial hint count survive a cold module restart', () => {
  const first = fixture();
  const flow = first.createHelpFlow(first.input);
  first.markHelpFlowReturned(flow.id);
  expect(JSON.parse(first.storage.getString(first.KEYS.helpFlows)!)[flow.id]).toMatchObject({
    attemptId: first.snapshot.attemptId, displayedCost: 50, balance: 20, status: 'returned', initialLetterHintCount: 0,
  });
  const sharedStorage = { storage: first.storage, KEYS: first.KEYS,
    getJSON: first.getJSON, getString: first.getString, setJSON: first.setJSON,
    setString: first.setString, removeKey: first.removeKey };
  jest.resetModules();
  jest.doMock('@/core/storage', () => sharedStorage);
  const cold = require('../help-flow') as typeof import('../help-flow');
  const restored = cold.getHelpFlow(flow.id)!;
  expect(restored).toMatchObject({ id: flow.id, attemptId: flow.attemptId, status: 'returned' });
  expect(cold.currentHelpQuote(restored)).toMatchObject({ price: 50, balance: 20, deficit: 30, canResume: true });
  expect(cold.helpFlowProperties(restored)).not.toHaveProperty('initialLetterHintCount');
  expect(cold.helpFlowProperties(restored)).not.toHaveProperty('previously_completed');
});

test('prior completion is frozen at the help request and exported explicitly', () => {
  const f = fixture();
  const flow = f.createHelpFlow({ ...f.input, previouslyCompleted: true });
  expect(f.helpFlowProperties(flow).previously_completed).toBe(true);
  expect(JSON.parse(f.storage.getString(f.KEYS.helpFlows)!)[flow.id].previouslyCompleted).toBe(true);
  expect(f.helpFlowProperties(flow)).not.toHaveProperty('first_eligible_request');
});

test('small and sufficient rewards update the actual deficit without buying a hint', () => {
  const f = fixture();
  const flow = f.createHelpFlow(f.input);
  const before = JSON.stringify(f.useGame.getState().snapshot);
  expect(f.currentHelpQuote(flow)).toMatchObject({ price: 50, balance: 20, deficit: 30 });
  f.useCurrency.getState().addOnce('wheel:test:small', 'coins', 10);
  expect(f.currentHelpQuote(flow)).toMatchObject({ balance: 30, deficit: 20 });
  f.useCurrency.getState().addOnce('wheel:test:enough', 'coins', 50);
  expect(f.currentHelpQuote(flow)).toMatchObject({ balance: 80, deficit: 0 });
  expect(JSON.stringify(f.useGame.getState().snapshot)).toBe(before);
  expect(Object.keys(f.useCurrency.getState().appliedRewards).filter((id) => id.startsWith('hint:'))).toEqual([]);
});

test('an identical puzzle restarted under another attempt never satisfies the original return', () => {
  const f = fixture();
  const flow = f.createHelpFlow(f.input);
  const { clearGameSnapshot } = require('@/features/game/persistence') as typeof import('@/features/game/persistence');
  clearGameSnapshot('normal');
  f.useGame.getState().start(f.level, 'normal');
  expect(f.useGame.getState().snapshot!.attemptId).not.toBe(flow.attemptId);
  expect(f.canResumeHelpFlow(flow)).toBe(false);
  expect(f.currentHelpQuote(flow)).toMatchObject({ canResume: false, helpAvailable: false });
});

test('quote charges the current configured price and reopens an already owned semantic clue for zero', () => {
  const f = fixture(60);
  const flow = f.createHelpFlow({ ...f.input, requestedHint: 'semantic', displayedCost: 999 });
  expect(f.currentHelpQuote(flow)).toMatchObject({ price: 30, deficit: 0, helpAvailable: true, alreadyOwned: false });
  const { purchaseSemanticClue } = require('../index') as typeof import('../index');
  expect(purchaseSemanticClue(flow.levelKey, f.snapshot.levelFingerprint, f.level.answers[0].word)).toBe('unlocked');
  expect(f.currentHelpQuote(flow)).toMatchObject({ price: 0, balance: 30, deficit: 0, alreadyOwned: true, helpAvailable: true });
  expect(f.useCurrency.getState().coins).toBe(30);
});

test('assigned introductory help stays a direct free action', () => {
  const { storage, KEYS } = require('@/core/storage') as typeof import('@/core/storage');
  storage.clearAll(); storage.set(KEYS.currency, JSON.stringify({ coins: 0, gems: 0 }));
  const { assignIntroPackForCurrentProfile, getIntroLevel } = require('@/features/onboarding/introPack') as typeof import('@/features/onboarding/introPack');
  assignIntroPackForCurrentProfile();
  const { useGame } = require('@/features/game/store') as typeof import('@/features/game/store');
  const { createHelpFlow, currentHelpQuote } = require('../help-flow') as typeof import('../help-flow');
  const level = getIntroLevel(3)!;
  useGame.getState().start(level, 'normal');
  const snapshot = useGame.getState().snapshot!;
  const flow = createHelpFlow({ id: 'help:test:free', attemptId: snapshot.attemptId, levelKey: 'campaign:3', levelId: 3,
    mode: 'campaign', contentVersion: snapshot.contentVersion, requestedHint: 'letter', displayedCost: 0,
    balance: 0, entrySource: 'game_hint', previouslyCompleted: false });
  expect(currentHelpQuote(flow)).toMatchObject({ free: true, price: 0, balance: 0, deficit: 0 });
});

test('a committed letter makes its old request stale even if flow metadata was never marked applied', () => {
  const f = fixture(60);
  const flow = f.createHelpFlow(f.input);
  const { revealLetter } = require('@/features/game/hintJournal') as typeof import('@/features/game/hintJournal');
  expect(revealLetter(flow.levelKey)).toBe('applied');
  expect(f.getHelpFlow(flow.id)?.status).toBe('requested');
  expect(f.currentHelpQuote(flow)).toMatchObject({ canResume: true, helpAvailable: false });
  f.useGame.setState({ snapshot: null, level: null, play: null });
  expect(f.currentHelpQuote(flow)).toMatchObject({ canResume: true, helpAvailable: false });
  expect(f.useCurrency.getState().coins).toBe(10);
});

test('daily return remains pinned across midnight while a different daily is active', () => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-03T20:55:00Z'));
  const f = fixture();
  const { useDailyPuzzle } = require('@/features/dailypuzzle') as typeof import('@/features/dailypuzzle');
  const first = useDailyPuzzle.getState().getOrStartDaily()!;
  f.useGame.getState().start(first.level, 'daily', first.dateKey);
  const snapshot = f.useGame.getState().snapshot!;
  const flow = f.createHelpFlow({ ...f.input, id: 'help:test:daily', attemptId: snapshot.attemptId,
    levelKey: `daily:${first.dateKey}`, levelId: snapshot.globalLevel, mode: 'daily', dateKey: first.dateKey,
    contentVersion: snapshot.contentVersion });
  jest.setSystemTime(new Date('2026-11-04T00:10:00+03:00'));
  const next = useDailyPuzzle.getState().getOrStartDaily()!;
  expect(next.dateKey).not.toBe(first.dateKey);
  f.useGame.getState().start(next.level, 'daily', next.dateKey);
  expect(f.canResumeHelpFlow(flow)).toBe(true);
  expect(f.helpFlowGameHref(flow).params).toMatchObject({ mode: 'daily', date: first.dateKey, helpFlowId: flow.id });
  expect(f.getHelpFlow(flow.id)?.attemptId).toBe(snapshot.attemptId);
  const controlled = f.createHelpFlow({ ...flow, id: 'help:test:daily-control', uxVariant: 'control' });
  f.setHelpFlowVariantResolver((item) => item.id === flow.id ? 'clarity' : 'control');
  expect(f.latestResumableHelpFlow()?.id).toBe(flow.id);
  expect(f.latestResumableHelpFlow()?.dateKey).toBe(first.dateKey);
  expect(f.latestResumableHelpFlow(controlled.attemptId)?.id).toBe(flow.id);
});

test('unconfirmed flow writes do not publish a context that navigation could trust', () => {
  const f = fixture();
  const write = f.storage.set.bind(f.storage);
  jest.spyOn(f.storage, 'set').mockImplementation((key, value) => {
    if (key === f.KEYS.helpFlows) throw new Error('save failed');
    return write(key, value);
  });
  expect(() => f.createHelpFlow(f.input)).toThrow('save failed');
  expect(f.getHelpFlow(f.input.id)).toBeNull();
});

test('flow persistence rejects free-text identities and never includes raw puzzle text in receipt context', () => {
  const f = fixture();
  expect(() => f.createHelpFlow({ ...f.input, attemptId: 'сырой текст слова' })).toThrow('Invalid help request');
  expect(() => f.createHelpFlow({ ...f.input, levelKey: 'campaign:999' })).toThrow('Invalid help request');
  const flow = f.createHelpFlow(Object.assign({}, f.input, { raw_word: 'секрет', email: 'private@example.test' }));
  expect(f.helpFlowProperties(flow)).toMatchObject({ origin_interaction_id: flow.id, requested_hint: 'letter', displayed_cost: 50 });
  expect(f.helpFlowProperties(flow)).not.toHaveProperty('word');
  expect(f.helpFlowProperties(flow)).not.toHaveProperty('answers');
  expect(f.storage.getString(f.KEYS.helpFlows)).not.toContain('секрет');
  expect(f.storage.getString(f.KEYS.helpFlows)).not.toContain('private@example.test');
  expect(f.getHelpFlow('constructor')).toBeNull();
  f.markHelpFlowApplied(flow.id);
  f.markHelpFlowReturned(flow.id);
  expect(f.getHelpFlow(flow.id)?.status).toBe('applied');
});

test('home recovery uses resolved assignments and ignores closed, applied, control and changed attempts', () => {
  const f = fixture();
  jest.spyOn(Date, 'now').mockReturnValue(1_793_786_592_000);
  const first = f.createHelpFlow(f.input);
  const latest = f.createHelpFlow({ ...f.input, id: 'help:test:latest' });
  f.setHelpFlowVariantResolver((flow) => [first.id, latest.id].includes(flow.id) ? 'clarity' : 'control');
  f.createHelpFlow({ ...f.input, id: 'help:test:control', uxVariant: 'control' });
  expect(f.latestResumableHelpFlow()?.id).toBe(latest.id);
  expect(f.latestResumableHelpFlow('foreign-attempt')).toBeNull();
  f.closeHelpFlow(latest.id);
  expect(f.latestResumableHelpFlow()?.id).toBe(first.id);
  f.markHelpFlowApplied(first.id);
  expect(f.latestResumableHelpFlow()).toBeNull();
  expect(f.getHelpFlow('constructor')).toBeNull();
});
