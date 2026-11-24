let mockNative: Record<string, unknown> | null;
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  Platform: { value: { OS: 'android' } },
}));
jest.mock('expo', () => ({ requireOptionalNativeModule: () => mockNative }));
function fixture() {
  jest.resetModules();
  mockNative = { getCapabilities: jest.fn(() => ({ bridgeVersion: 1, guardianVersion: 3, flexible: true })),
    getNativeVersionCode: jest.fn(() => '34'), checkAvailability: jest.fn(async () => ({ result: 'available', versionCode: '35', installedVersionCode: '34', state: 'unknown', infoToken: 'opaque-1' })),
    startFlexible: jest.fn(async () => ({ result: 'cancelled', reason: 'declined' })), completeFlexible: jest.fn(async () => ({ result: 'flow_ended_unconfirmed', reason: 'flow_returned' })),
    discard: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) };
  return { load: () => jest.requireActual('../index') as typeof import('../index'), native: mockNative };
}
test('capability and native package version are pure; enabled methods use exact typed outcomes', async () => {
  const f = fixture(), bridge = f.load(); expect(bridge.isSupported()).toBe(true); expect(bridge.getNativeVersionCode()).toBe('34');
  expect(f.native.checkAvailability).not.toHaveBeenCalled(); expect((await bridge.checkAvailability()).result).toBe('available');
  expect((await bridge.completeFlexible('35')).result).toBe('flow_ended_unconfirmed');
});
test.each([null, {}, { getCapabilities: () => ({ bridgeVersion: 1, guardianVersion: 2, flexible: true }) }])('older or missing binary fails closed', async (native) => {
  const f = fixture(); mockNative = native; const bridge = f.load(); expect(bridge.isSupported()).toBe(false); expect((await bridge.checkAvailability()).result).toBe('unavailable');
});
test('malformed native version, unknown outcome and raw metadata are contained', async () => {
  const f = fixture(); (f.native.getNativeVersionCode as jest.Mock).mockReturnValue(35); (f.native.checkAvailability as jest.Mock).mockResolvedValue({ result: 'installed', reason: 'secret@example.invalid' });
  const bridge = f.load(); expect(bridge.getNativeVersionCode()).toBeNull(); expect(await bridge.checkAvailability()).toEqual({ result: 'unknown', reason: 'invalid_native_result' });
});
test('an explicit native cancellation remains distinct from unknown or no available update', async () => {
  const f = fixture(); (f.native.checkAvailability as jest.Mock).mockResolvedValue({ result: 'cancelled', reason: 'aborted', errorCode: 4010 });
  expect(await f.load().checkAvailability()).toEqual({ result: 'cancelled', reason: 'aborted', errorCode: 4010 });
});
