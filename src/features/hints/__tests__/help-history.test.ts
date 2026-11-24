/* eslint-disable @typescript-eslint/no-require-imports */
beforeEach(() => { jest.resetModules(); });
function storageFixture() {
  const store = require('@/core/storage') as typeof import('@/core/storage'); store.storage.clearAll();
  return store;
}
test('fresh declared local history has a usable negative proof, but reset invalidates it', () => {
  const store = storageFixture(); store.setJSON(store.KEYS.currency, { coins: 20, gems: 0, newProfile: true });
  const { useLevels, getCampaignPriorCompletion } = require('@/features/levels/store') as typeof import('@/features/levels/store');
  expect(getCampaignPriorCompletion(6)).toBe(false);
  useLevels.getState().completeLevel(6); expect(getCampaignPriorCompletion(6)).toBe(true); expect(getCampaignPriorCompletion(7)).toBe(false);
  useLevels.getState().reset(); expect(getCampaignPriorCompletion(6)).toBeNull();
});
test('missing coverage and repaired campaign history cannot fabricate never-completed', () => {
  const store = storageFixture();
  store.setJSON(store.KEYS.levelsProgress, { currentLevel: 2, world: 'world1', completed: [1] });
  const legacy = require('@/features/levels/store') as typeof import('@/features/levels/store');
  expect(legacy.getCampaignPriorCompletion(1)).toBe(true); expect(legacy.getCampaignPriorCompletion(2)).toBeNull();
  store.setJSON(store.KEYS.campaignHistoryProof, { version: 1, complete: true });
  store.setJSON(store.KEYS.levelsProgress, { currentLevel: 2, world: 'world1', completed: [1, 'lost'] });
  expect(legacy.getCampaignPriorCompletion(2)).toBeNull();
});
test('fresh daily history can prove a new puzzle, and reset removes that proof', () => {
  const store = storageFixture(); store.setJSON(store.KEYS.currency, { coins: 20, gems: 0, newProfile: true });
  const daily = require('@/features/dailypuzzle') as typeof import('@/features/dailypuzzle');
  expect(daily.getDailyPriorCompletion('2026-11-03')).toBe(false);
  daily.useDailyPuzzle.getState().reset(); expect(daily.getDailyPriorCompletion('2026-11-03')).toBeNull();
  daily.useDailyPuzzle.setState({ solvedDates: ['2026-11-01'] }); expect(daily.getDailyPriorCompletion('2026-11-01')).toBe(true);
});
test('legacy daily migration preserves known positive completion but missing older dates stay unknown', () => {
  const store = storageFixture(); store.setJSON(store.KEYS.dailyPuzzle, { lastDoneDay: '2026-11-01', streak: 1 });
  const daily = require('@/features/dailypuzzle') as typeof import('@/features/dailypuzzle');
  expect(daily.getDailyPriorCompletion('2026-11-01')).toBe(true); expect(daily.getDailyPriorCompletion('2026-11-02')).toBeNull();
});
