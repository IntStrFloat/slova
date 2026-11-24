/* eslint-disable @typescript-eslint/no-require-imports */
import type { Level } from '@/core/engine';
const cells = [{ row: 0, col: 0, ch: 'к' }, { row: 0, col: 1, ch: 'о' }, { row: 0, col: 2, ch: 'т' }];
const level: Level = { id: 1, globalId: 1, world: 'world1', letters: ['к', 'о', 'т'], difficulty: 1,
  grid: { rows: 1, cols: 3, cells }, answers: [{ word: 'кот', dir: 'H', cells }], bonusPool: [] };
function fixture() {
  jest.resetModules();
  const { storage, KEYS } = require('@/core/storage') as typeof import('@/core/storage'); storage.clearAll();
  const { useGame } = require('@/features/game/store') as typeof import('@/features/game/store');
  const recovery = (require('@/features/monetization/rewardRecovery') as typeof import('@/features/monetization/rewardRecovery')).useRewardRecovery;
  const wheel = (require('@/features/wheel') as typeof import('@/features/wheel')).useWheel;
  const safe = (require('../safePoint') as typeof import('../safePoint')).isSavedUpdateSafePoint;
  useGame.getState().start(level); useGame.getState().submit('кот');
  return { useGame, recovery, wheel, safe, storage, KEYS };
}
test('only the actual durable saved reward_claimed result is admitted, never a pending result or changed disk revision', () => {
  const f = fixture(); expect(f.safe(true)).toBe(false);
  f.useGame.getState().markRewardClaimed(); expect(f.safe(true)).toBe(true); expect(f.safe(false)).toBe(false);
  const saved = JSON.parse(f.storage.getString(f.KEYS.gameCurrentNormal)!); saved.revision += 1;
  f.storage.set(f.KEYS.gameCurrentNormal, JSON.stringify(saved)); expect(f.safe(true)).toBe(false);
});
test.each([{ checking: true }, { readFailed: true }, { pendingIds: ['earned-awaiting-wallet'] }])('recovery %p blocks and no game/wallet key is changed by admission', (state) => {
  const f = fixture(); f.useGame.getState().markRewardClaimed(); f.recovery.setState(state);
  const before = f.storage.getAllKeys().map((key) => [key, f.storage.getString(key)]);
  expect(f.safe(true)).toBe(false); expect(f.storage.getAllKeys().map((key) => [key, f.storage.getString(key)])).toEqual(before);
});
