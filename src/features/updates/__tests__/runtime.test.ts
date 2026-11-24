/* eslint-disable @typescript-eslint/no-require-imports */
let mockEnabled = true;
const mockRewarded = jest.fn(async () => false), mockBrowser = jest.fn<Promise<void>, [string]>(async () => {});
const mockCheck = jest.fn(async () => ({ result: 'unavailable', reason: 'disabled' }));
jest.mock('../config', () => ({ get UPDATES_ENABLED() { return mockEnabled; } }));
jest.mock('../../../../modules/rustore-updates', () => ({ updatesGateway: { isSupported: () => true, getNativeVersionCode: () => '34',
  checkAvailability: () => mockCheck(), discard: () => {}, subscribe: () => () => {} } }));
jest.mock('../../../../modules/rustore-review', () => ({ hasActiveForm: () => false }));
jest.mock('@/features/analytics', () => ({ track: jest.fn(), trackOnce: jest.fn() }));
jest.mock('@/features/monetization/nativeRewardJournal', () => ({ hasActiveNativeRewardedShow: () => mockRewarded() }));
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockBrowser(url) }));
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  AppState: { value: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) } },
}));
function fixture() { jest.resetModules(); return require('../runtime') as typeof import('../runtime'); }
beforeEach(() => { mockEnabled = true; jest.clearAllMocks(); mockRewarded.mockResolvedValue(false); });
test('disabled startup hides SDK and manual paths; repeated cleanup is harmless', async () => {
  mockEnabled = false; const f = fixture(); const stop = f.startUpdates();
  expect(f.getUpdatesSnapshot().manualAvailable).toBe(false); expect(mockCheck).not.toHaveBeenCalled();
  expect(await f.openManualUpdate(() => true, 'runtime-result')).toBe(false); expect(mockBrowser).not.toHaveBeenCalled(); stop(); stop();
});
test('manual update can only open the fixed main-package listing using update owner at a fresh safe point', async () => {
  const f = fixture(); const stop = f.startUpdates();
  expect(await f.openManualUpdate(() => false, 'runtime-result')).toBe(false); expect(mockBrowser).not.toHaveBeenCalled();
  expect(await f.openManualUpdate(() => true, 'runtime-result')).toBe(true);
  expect(mockBrowser).toHaveBeenCalledWith('https://www.rustore.ru/catalog/app/com.intstrfloat.slova'); stop();
});
test('native orphan blocks the manual listing too', async () => {
  const f = fixture(); mockRewarded.mockResolvedValueOnce(true);
  expect(await f.openManualUpdate(() => true, 'runtime-result')).toBe(false); expect(mockBrowser).not.toHaveBeenCalled();
});
test('manual tap reserves its actual browser boundary synchronously before an unresolved native guard', async () => {
  const f = fixture(); const fullscreen = require('@/core/fullscreen') as typeof import('@/core/fullscreen');
  let resolve!: (value: boolean) => void; mockRewarded.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  let safe = true; const pending = f.openManualUpdate(() => safe, 'runtime-result');
  expect(fullscreen.getFullscreenSnapshot().owner).toBe('update'); safe = false; resolve(false);
  expect(await pending).toBe(false); expect(fullscreen.getFullscreenSnapshot().owner).toBeNull(); expect(mockBrowser).not.toHaveBeenCalled();
});
test('manual browser admission rechecks the saved result after every asynchronous preflight boundary', async () => {
  const unsafeDispatches: number[] = [];
  for (let hops = 0; hops < 7; hops++) {
    const f = fixture(); let safe = true;
    mockBrowser.mockImplementation(async () => { if (!safe) unsafeDispatches.push(hops); });
    const opened = f.openManualUpdate(() => safe, 'runtime-result');
    for (let i = 0; i < hops; i++) await Promise.resolve();
    safe = false; await opened;
  }
  expect(unsafeDispatches).toEqual([]);
});
test.each(['{broken', '{"version":999,"offerUntil":1800000100000,"future":"preserve"}'])(
  'manual fixed listing stays usable with unreadable optional metadata %s, preserving it and suppressing only this result', async (raw) => {
    const f = fixture();
    const { storage, KEYS } = require('@/core/storage') as typeof import('@/core/storage');
    storage.set('updates.state.v1', raw); const stop = f.startUpdates();
    expect(await f.openManualUpdate(() => true, 'manual-same-result')).toBe(true);
    expect(mockBrowser).toHaveBeenCalledTimes(1); expect(storage.getString('updates.state.v1')).toBe(raw);
    expect(f.hasUpdateAttemptForResult('manual-same-result')).toBe(true); expect(f.hasUpdateAttemptForResult('another-result')).toBe(false);
    storage.set(KEYS.profile, JSON.stringify({ userId: 'replacement-profile' }));
    expect(f.hasUpdateAttemptForResult('manual-same-result')).toBe(false); stop();
  },
);
test('unwritable durable result marker prevents manual dispatch and leaves fullscreen ownership free', async () => {
  const f = fixture(), { storage } = require('@/core/storage') as typeof import('@/core/storage');
  const fullscreen = require('@/core/fullscreen') as typeof import('@/core/fullscreen');
  const write = storage.set.bind(storage);
  const failing = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    if (key === 'updates.result-attempt.v1') throw Error('unwritable'); write(key, value);
  });
  try {
    expect(await f.openManualUpdate(() => true, 'unsaved-marker-result')).toBe(false); expect(mockBrowser).not.toHaveBeenCalled();
    expect(fullscreen.getFullscreenSnapshot().owner).toBeNull();
  } finally { failing.mockRestore(); }
});
