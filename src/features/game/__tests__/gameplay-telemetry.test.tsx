import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { trackOnce, useAnalyticsPrefs } from '@/features/analytics';
import { addGameplayTime } from '@/features/analytics/sessionTelemetry';
import { puzzleIdentity, trackPuzzleCheckpoint, trackPuzzleExited } from '@/features/analytics/puzzleLifecycle';
import { storage, KEYS } from '@/core/storage';
import type { Level } from '@/core/engine/types';
import { purchaseSemanticClue, isSemanticClueUnlocked } from '@/features/hints';
import { useCurrency } from '@/features/currency';
import { useGame } from '../store';
import { loadGameSnapshot, saveGameSnapshot } from '../persistence';
import { settlePuzzleCompletion } from '../settlement';
import { useGameplayClock } from '../useGameplayClock';
import { flushGameSaveSummary } from '../saveTelemetry';

jest.mock('@/features/analytics', () => {
  let optOut = false;
  let consentEpoch: number | null = null;
  type MockPreference = { optOut: boolean };
  const listeners = new Set<(mockNext: MockPreference, mockPrevious: MockPreference) => void>();
  const setOptOut = (value: boolean) => {
    const previous = { optOut };
    optOut = value;
    if (!value && previous.optOut) consentEpoch = Date.now();
    listeners.forEach((listener) => listener({ optOut }, previous));
  };
  return {
    track: jest.fn(), trackOnce: jest.fn(() => 'accepted-event'),
    getAnalyticsSession: () => ({ sessionId: 'session-test', isFirstSession: true }),
    isAnalyticsCollectionEnabled: () => !optOut,
    getAnalyticsConsentEpoch: () => consentEpoch,
    useAnalyticsPrefs: {
      getState: () => ({ optOut, setOptOut }),
      subscribe: (listener: (mockNext: MockPreference, mockPrevious: MockPreference) => void) => {
        listeners.add(listener); return () => listeners.delete(listener);
      },
    },
  };
});
jest.mock('@/features/analytics/sessionTelemetry', () => ({
  addGameplayTime: jest.fn(), flushSessionSummary: jest.fn(), noteSessionAction: jest.fn(),
}));

const level: Level = {
  id: 7, globalId: 7, world: 'world1', contentVersion: 'test-content-v1',
  fingerprint: '7:кот:кот,ток', letters: ['к', 'о', 'т'], difficulty: 1,
  grid: { rows: 2, cols: 3, cells: [
    { row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' },
    { row: 1, col: 0, ch: 'т' }, { row: 1, col: 1, ch: 'о' }, { row: 1, col: 2, ch: 'к' },
  ] },
  answers: [
    { word: 'кот', dir: 'H', cells: [{ row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' }] },
    { word: 'ток', dir: 'H', cells: [{ row: 1, col: 0, ch: 'т' }, { row: 1, col: 1, ch: 'о' }, { row: 1, col: 2, ch: 'к' }] },
  ], bonusPool: [],
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-25T10:00:00.000Z'));
  storage.clearAll();
  useAnalyticsPrefs.getState().setOptOut(false);
  useCurrency.setState({ coins: 60, appliedRewards: {} });
  useGame.setState({ play: null, level: null, snapshot: null, completion: { status: 'playing' } });
  jest.mocked(trackOnce).mockClear();
  jest.mocked(addGameplayTime).mockClear();
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('semantic-only help survives restart, charges once and makes the real completion assisted', () => {
  useGame.getState().start(level, 'normal');
  const attempt = useGame.getState().snapshot!.attemptId;
  expect(isSemanticClueUnlocked('campaign:7', level.fingerprint!, 'кот')).toBe(false);
  expect(purchaseSemanticClue('campaign:7', level.fingerprint!, 'кот')).toBe('unlocked');
  expect(useCurrency.getState().coins).toBe(30);
  expect(isSemanticClueUnlocked('campaign:7', level.fingerprint!, 'кот')).toBe(true);
  expect(purchaseSemanticClue('campaign:7', level.fingerprint!, 'кот')).toBe('unlocked');
  expect(useCurrency.getState().coins).toBe(30);
  useGame.setState({ snapshot: null, play: null });
  useGame.getState().start(level, 'normal');
  expect(useGame.getState().snapshot).toMatchObject({ attemptId: attempt, semanticHelpUsed: true });
  expect(useGame.getState().hintsUsed).toEqual([]);
  useGame.getState().submit('кот');
  useGame.getState().submit('ток');
  settlePuzzleCompletion(level, 'normal', useGame.getState().snapshot!, false);
  const completed = jest.mocked(trackOnce).mock.calls.find(([name]) => name === 'puzzle_completed');
  expect(completed?.[2]).toMatchObject({ assisted: true, assistanceType: 'semantic', attemptId: attempt });
});

test('a classification write interruption retries without charging the semantic clue twice', () => {
  useGame.getState().start(level, 'normal');
  const write = storage.set.bind(storage);
  const failure = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.gameCurrentNormal) throw new Error('snapshot unavailable');
    write(key, value);
  });
  expect(() => purchaseSemanticClue('campaign:7', level.fingerprint!, 'кот')).toThrow();
  expect(useCurrency.getState().coins).toBe(30);
  failure.mockRestore();
  purchaseSemanticClue('campaign:7', level.fingerprint!, 'кот');
  expect(useCurrency.getState().coins).toBe(30);
  expect(loadGameSnapshot()?.semanticHelpUsed).toBe(true);
});

test('only persisted visible deltas contribute session time and restored attempts retain that total', () => {
  useGame.getState().start(level);
  const attempt = useGame.getState().snapshot!.attemptId;
  useGame.getState().recordVisibleTime('another-attempt', 5000);
  useGame.getState().recordVisibleTime(attempt, 1250);
  expect(addGameplayTime).toHaveBeenCalledTimes(1);
  expect(addGameplayTime).toHaveBeenCalledWith(1250);
  expect(loadGameSnapshot()?.activeTimeMs).toBe(1250);
  useGame.getState().start(level);
  expect(useGame.getState().snapshot).toMatchObject({ attemptId: attempt, activeTimeMs: 1250 });
});

test('a periodic saved checkpoint and pause describe the same durable attempt without background time', () => {
  useGame.getState().start(level);
  const attempt = useGame.getState().snapshot!.attemptId;
  let listener!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    listener = callback;
    return { remove: jest.fn() };
  });
  function Clock({ active }: { active: boolean }) { useGameplayClock(active, attempt, 'ad'); return null; }
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<Clock active />); });
  act(() => jest.advanceTimersByTime(60000));
  const interval = jest.mocked(trackOnce).mock.calls.find(([name]) => name === 'puzzle_checkpoint');
  expect(interval?.[2]).toMatchObject({ attemptId: attempt, activeTimeMs: 60000, reason: 'interval' });
  act(() => listener('background'));
  const before = loadGameSnapshot()?.activeTimeMs;
  act(() => jest.advanceTimersByTime(30000));
  expect(loadGameSnapshot()?.activeTimeMs).toBe(before);
  act(() => { listener('active'); jest.advanceTimersByTime(1000); tree.update(<Clock active={false} />); });
  expect(loadGameSnapshot()?.activeTimeMs).toBe(61000);
  const pauses = jest.mocked(trackOnce).mock.calls.filter(([name]) => name === 'puzzle_paused');
  expect(pauses.map(([, , props]) => props?.reason)).toEqual(['background', 'ad']);
  act(() => tree.unmount());
});

test('checkpoint and explicit exit never claim a finished puzzle or leak legacy answer fingerprints', () => {
  useGame.getState().start(level);
  const saved = useGame.getState().snapshot!;
  expect(puzzleIdentity(level, saved).content_fingerprint).toMatch(/^fp_[a-f0-9]{16}$/);
  trackPuzzleCheckpoint(level, saved, 'menu');
  trackPuzzleExited(level, saved, 'exit-a', 'menu_home', 'invalid');
  expect(jest.mocked(trackOnce).mock.calls.at(-1)?.[2]).toMatchObject({ exit_id: 'exit-a', exit_reason: 'menu_home' });
  jest.mocked(trackOnce).mockClear();
  const finished = { ...saved, completion: { status: 'reward_claimed' as const } };
  trackPuzzleCheckpoint(level, finished, 'menu');
  trackPuzzleExited(level, finished, 'exit-b', 'menu_home');
  expect(trackOnce).not.toHaveBeenCalled();
});

test('save accounting includes successful attempts and rejects silently dropped writes', () => {
  useGame.getState().start(level);
  const saved = useGame.getState().snapshot!;
  const write = storage.set.bind(storage);
  const dropped = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key !== KEYS.gameCurrentNormal) write(key, value);
  });
  expect(() => saveGameSnapshot('normal', { ...saved, revision: saved.revision + 1 })).toThrow('Gameplay save was not persisted');
  dropped.mockRestore();
  saveGameSnapshot('normal', saved);
  flushGameSaveSummary(true);
  const summary = jest.mocked(trackOnce).mock.calls.filter(([name, , props]) => name === 'technical_operation' && props?.stage === 'summary').at(-1)?.[2];
  expect(summary).toMatchObject({ operation: 'game_save' });
  expect(summary?.attempts).toBe(Number(summary?.successes) + Number(summary?.failures));
  expect(Number(summary?.successes)).toBeGreaterThan(0);
  expect(Number(summary?.failures)).toBeGreaterThan(0);
});

test('off-period save attempts and failures never reappear after a later opt-in', () => {
  useGame.getState().start(level);
  const saved = useGame.getState().snapshot!;
  flushGameSaveSummary(true);
  const previousId = jest.mocked(trackOnce).mock.calls.filter(([, , props]) => props?.stage === 'summary').at(-1)?.[2]?.summary_id;
  useAnalyticsPrefs.getState().setOptOut(true);
  jest.mocked(trackOnce).mockClear();
  saveGameSnapshot('normal', saved);
  const write = storage.set.bind(storage);
  const failed = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === KEYS.gameCurrentNormal) throw new Error('off-period failure');
    write(key, value);
  });
  expect(() => saveGameSnapshot('normal', saved)).toThrow('off-period failure');
  failed.mockRestore();
  saveGameSnapshot('normal', saved);
  expect(trackOnce).not.toHaveBeenCalled();
  useAnalyticsPrefs.getState().setOptOut(false);
  saveGameSnapshot('normal', saved);
  flushGameSaveSummary(true);
  const summaries = jest.mocked(trackOnce).mock.calls.filter(([, , props]) => props?.stage === 'summary');
  expect(summaries.at(-1)?.[2]).toMatchObject({ attempts: 1, successes: 1, failures: 0 });
  expect(summaries.at(-1)?.[2]?.summary_id).not.toBe(previousId);
  expect(jest.mocked(trackOnce).mock.calls.some(([, , props]) => props?.stage === 'recovered')).toBe(false);
});

test('a mixed-consent saved attempt keeps game progress but omits historical timing aggregates', () => {
  useGame.getState().start(level);
  const attemptId = useGame.getState().snapshot!.attemptId;
  useGame.getState().recordVisibleTime(attemptId, 1000);
  useAnalyticsPrefs.getState().setOptOut(true);
  useGame.getState().recordVisibleTime(attemptId, 2000);
  jest.advanceTimersByTime(1);
  useAnalyticsPrefs.getState().setOptOut(false);
  jest.mocked(trackOnce).mockClear();
  const saved = useGame.getState().snapshot!;
  expect(saved.activeTimeMs).toBe(3000);
  trackPuzzleCheckpoint(level, saved, 'menu');
  const props = jest.mocked(trackOnce).mock.calls.at(-1)?.[2];
  expect(props?.time_coverage).toBe('mixed_consent');
  expect(props).not.toHaveProperty('activeTimeMs');
});
