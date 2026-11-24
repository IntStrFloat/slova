import { type Level } from '@/core/engine/types';
import { DEFAULT_POLICY, getRuntimePolicy, resetRuntimePolicy, setConfiguredPolicy, setRuntimePolicyGuard } from '@/core/config/runtimePolicy';
import { KEYS, storage } from '@/core/storage';
import { useGame } from '@/features/game/store';
import { getFeatureGates, ensureDay, makeInitialSnapshot } from '@/features/retention/model';
import { createRemoteConfigCoordinator } from '../coordinator';

const level: Level = { id: 1, globalId: 1, world: 'world1', letters: ['к', 'о', 'т'], difficulty: 1,
  grid: { rows: 1, cols: 3, cells: [{ row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' }] },
  answers: [{ word: 'кот', dir: 'H', cells: [{ row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' }] }], bonusPool: ['ток'] };
const candidate = (seconds: number) => ({ ...DEFAULT_POLICY, configVersion: `ad_delay_${seconds}`, profileScope: 'profile_a',
  assignment: { experiment_id: 'ad_delay', assignment_id: 'assignment_a', variant: 'candidate', allocation_version: 1 },
  parameter: 'ads_interstitial_interval_seconds' as const, values: { ...DEFAULT_POLICY.values, ads_interstitial_interval_seconds: seconds } });
beforeEach(() => {
  storage.clearAll(); resetRuntimePolicy(); setRuntimePolicyGuard(() => true);
  useGame.setState({ play: null, level: null, snapshot: null, completion: { status: 'playing' } });
});

test('paused attempt and claimed reward restore the original immutable policy after a newer config applies', () => {
  setConfiguredPolicy(candidate(600)); useGame.getState().start(level); useGame.getState().submit('кот');
  const saved = JSON.parse(storage.getString(KEYS.gameCurrentNormal)!);
  const before = { attemptId: saved.attemptId, coins: saved.coinsEarned, completion: saved.completion };
  useGame.getState().finish(); setConfiguredPolicy(candidate(900));
  useGame.getState().start({ ...level, id: 2, globalId: 2 });
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(900);
  storage.set(KEYS.gameCurrentNormal, JSON.stringify(saved));
  storage.set(KEYS.gameCurrentNormalBackup, JSON.stringify(saved));
  useGame.getState().start(level);
  expect(getRuntimePolicy().values.ads_interstitial_interval_seconds).toBe(600);
  expect(useGame.getState().snapshot).toMatchObject({ attemptId: before.attemptId, coinsEarned: before.coins, completion: before.completion,
    runtimePolicy: { configVersion: 'ad_delay_600' } });
});

test('a legacy attempt stays control and failed opening cannot replace the previous board policy', () => {
  setConfiguredPolicy(candidate(600)); useGame.getState().start(level);
  const legacy = JSON.parse(storage.getString(KEYS.gameCurrentNormal)!); delete legacy.runtimePolicy;
  storage.set(KEYS.gameCurrentNormal, JSON.stringify(legacy)); storage.set(KEYS.gameCurrentNormalBackup, JSON.stringify(legacy));
  useGame.getState().start(level);
  expect(getRuntimePolicy().values).toEqual(DEFAULT_POLICY.values);
  setConfiguredPolicy(candidate(900));
  const write = jest.spyOn(storage, 'set').mockImplementationOnce(() => { throw Error('local disk failed'); });
  try { expect(() => useGame.getState().start({ ...level, id: 2, globalId: 2 })).toThrow('local disk failed'); }
  finally { write.mockRestore(); }
  expect(getRuntimePolicy().values).toEqual(DEFAULT_POLICY.values);
  expect(useGame.getState().level?.globalId).toBe(1);
});

test('foreign or refused assignment cannot transfer through an otherwise valid saved board', () => {
  let scope = 'profile_a'; setRuntimePolicyGuard((snapshot) => snapshot.profileScope === scope);
  setConfiguredPolicy(candidate(600)); useGame.getState().start(level);
  const id = useGame.getState().snapshot!.attemptId;
  scope = 'profile_b'; useGame.getState().start(level);
  expect(getRuntimePolicy().values).toEqual(DEFAULT_POLICY.values);
  expect(useGame.getState().snapshot!.attemptId).toBe(id);
  setRuntimePolicyGuard(() => false);
  expect(getRuntimePolicy().values).toEqual(DEFAULT_POLICY.values);
});

test('retention consumes the selected threshold while already started quests and earned state remain intact', () => {
  let snapshot = makeInitialSnapshot({ newProfile: false });
  snapshot.campaignCompletions = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [String(index + 1), '2026-09-26']));
  snapshot = ensureDay(snapshot, { actionDay: '2026-09-26', remainingNewPuzzles: 30, availableBonusWords: 30, availableManualWords: 30 });
  expect(getFeatureGates(snapshot).quests).toBe(true);
  setConfiguredPolicy({ ...candidate(300), configVersion: 'quest_delay_20', parameter: 'retention_quests_unlock_wins',
    values: { ...DEFAULT_POLICY.values, retention_quests_unlock_wins: 20 } });
  const unchanged = JSON.stringify(snapshot);
  expect(getFeatureGates(snapshot).quests).toBe(true);
  const fresh = { ...snapshot, questInstances: {} };
  expect(getFeatureGates(fresh).quests).toBe(false);
  expect(JSON.stringify(snapshot)).toBe(unchanged);
  expect(getFeatureGates(snapshot).daily).toBe(true);
});

test('durable historical ownership restores a paused attempt after window expiry; a new attempt is control', () => {
  setConfiguredPolicy(candidate(600)); useGame.getState().start(level);
  const saved = JSON.parse(storage.getString(KEYS.gameCurrentNormal)!);
  resetRuntimePolicy(); // New JS process: configured policy and previous in-memory pin are gone.
  const controller = createRemoteConfigCoordinator({ enabled: true, now: Date.now, scope: () => 'profile_a', consent: () => true,
    assignment: () => null, // The current experiment window ended while the board was paused.
    pinnedAssignment: (assignment) => assignment.assignment_id === 'assignment_a',
    fetch: async () => ({ status: 'unavailable', reason: 'offline' }), read: () => null, write: () => true,
    remove: () => {}, event: () => {}, exposure: () => true });
  controller.start();
  storage.set(KEYS.gameCurrentNormal, JSON.stringify(saved)); storage.set(KEYS.gameCurrentNormalBackup, JSON.stringify(saved));
  useGame.getState().start(level);
  expect(getRuntimePolicy()).toMatchObject({ configVersion: 'ad_delay_600', values: { ads_interstitial_interval_seconds: 600 },
    assignment: { assignment_id: 'assignment_a' } });
  useGame.getState().finish();
  useGame.getState().start({ ...level, id: 2, globalId: 2 });
  expect(getRuntimePolicy()).toEqual(DEFAULT_POLICY);
});
