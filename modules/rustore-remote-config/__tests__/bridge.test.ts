const mockNative = {
  isAvailable: jest.fn(() => true), status: jest.fn(() => 'ready'), setAllowed: jest.fn(),
  fetchConfig: jest.fn<Promise<unknown>, []>(async () => ({ status: 'success', json: '{"test":1}' })),
  fetchHelpExperimentControl: jest.fn<Promise<unknown>, []>(async () => ({ status: 'success', json: '{}', source: 'actual_sdk_fetch' })),
};
let mockInstalled = true;
let mockHelpInstalled = true;
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn(() => mockInstalled
  ? mockHelpInstalled ? mockNative : { ...mockNative, fetchHelpExperimentControl: undefined } : null) }));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  Object.defineProperty(actual.Platform, 'OS', { get: () => 'android', configurable: true });
  return actual;
});
function bridge(): typeof import('../index') {
  let result!: typeof import('../index');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  jest.isolateModules(() => { result = require('../index'); });
  return result;
}
beforeEach(() => { jest.clearAllMocks(); mockInstalled = true; mockHelpInstalled = true; mockNative.isAvailable.mockReturnValue(true);
  mockNative.status.mockReturnValue('ready'); mockNative.fetchConfig.mockResolvedValue({ status: 'success', json: '{"test":1}' });
  mockNative.fetchHelpExperimentControl.mockResolvedValue({ status: 'success', json: '{}', source: 'actual_sdk_fetch' }); });

test('old binaries and native failures keep gameplay available without raw exception telemetry', async () => {
  mockInstalled = false;
  expect(await bridge().fetchRemotePolicy()).toEqual({ status: 'unavailable', reason: 'missing_capability' });
  mockInstalled = true;
  mockNative.fetchConfig.mockRejectedValue(new Error('private-token@example.com'));
  expect(await bridge().fetchRemotePolicy()).toEqual({ status: 'retryable', reason: 'unavailable' });
});

test('first-install consent enables no lazy build: control until the next cold launch capability', async () => {
  mockNative.isAvailable.mockReturnValue(false); mockNative.status.mockReturnValue('restart_required');
  const adapter = bridge(); adapter.setRemoteConfigAllowed(true);
  expect(await adapter.fetchRemotePolicy()).toEqual({ status: 'unavailable', reason: 'restart_required' });
  expect(mockNative.fetchConfig).not.toHaveBeenCalled();
  mockNative.isAvailable.mockReturnValue(true); mockNative.status.mockReturnValue('ready');
  expect(await bridge().fetchRemotePolicy()).toEqual({ status: 'success', json: '{"test":1}' });
});

test('oversized/unknown native responses are typed failures and explicit refusal reaches the native gate', async () => {
  const adapter = bridge(); adapter.setRemoteConfigAllowed(false);
  expect(mockNative.setAllowed).toHaveBeenCalledWith(false);
  mockNative.fetchConfig.mockResolvedValue({ status: 'success', json: ' '.repeat(16_385) });
  expect(await adapter.fetchRemotePolicy()).toEqual({ status: 'terminal', reason: 'invalid_payload' });
  mockNative.fetchConfig.mockResolvedValue({ status: 'unexpected', token: 'private' });
  expect(await adapter.fetchRemotePolicy()).toEqual({ status: 'terminal', reason: 'invalid_payload' });
});

test('older binaries with the numeric policy method cannot provide help-trial permission', async () => {
  mockHelpInstalled = false;
  const adapter = bridge();
  expect(await adapter.fetchHelpExperimentControl()).toEqual({ status: 'unavailable', reason: 'missing_capability' });
  expect(mockNative.fetchHelpExperimentControl).not.toHaveBeenCalled();
  expect(mockNative.fetchConfig).not.toHaveBeenCalled();
  expect(await adapter.fetchRemotePolicy()).toEqual({ status: 'success', json: '{"test":1}' });
  expect(mockNative.setAllowed).not.toHaveBeenCalled();
});

test('help fetch uses its separate actual-fetch capability without changing shared permission or numeric policy', async () => {
  const adapter = bridge();
  expect(await adapter.fetchHelpExperimentControl()).toEqual({ status: 'success', json: '{}', source: 'actual_sdk_fetch' });
  expect(mockNative.fetchHelpExperimentControl).toHaveBeenCalledTimes(1);
  expect(mockNative.fetchConfig).not.toHaveBeenCalled(); expect(mockNative.setAllowed).not.toHaveBeenCalled();
  expect(await adapter.fetchRemotePolicy()).toEqual({ status: 'success', json: '{"test":1}' });
  expect(mockNative.fetchHelpExperimentControl).toHaveBeenCalledTimes(1);
});

test('help capability missing/disabled/restart-required never calls a fetch fallback', async () => {
  mockInstalled = false;
  expect(await bridge().fetchHelpExperimentControl()).toEqual({ status: 'unavailable', reason: 'missing_capability' });
  mockInstalled = true; mockNative.isAvailable.mockReturnValue(false); mockNative.status.mockReturnValue('restart_required');
  expect(await bridge().fetchHelpExperimentControl()).toEqual({ status: 'unavailable', reason: 'restart_required' });
  mockNative.status.mockReturnValue('consent_required');
  expect(await bridge().fetchHelpExperimentControl()).toEqual({ status: 'unavailable', reason: 'missing_capability' });
  expect(mockNative.fetchHelpExperimentControl).not.toHaveBeenCalled(); expect(mockNative.fetchConfig).not.toHaveBeenCalled();
});

test.each([null, {}, { status: 'success', json: '{}' }, { status: 'success', json: '{}', source: 'cache' },
  { status: 'success', json: ' '.repeat(16_385), source: 'actual_sdk_fetch' },
  { status: 'success', json: 1, source: 'actual_sdk_fetch' }, { status: 'unexpected', secret: 'do-not-return' }])(
  'malformed help capability response fails closed (%#)', async (value) => {
    mockNative.fetchHelpExperimentControl.mockResolvedValue(value);
    expect(await bridge().fetchHelpExperimentControl()).toEqual({ status: 'terminal', reason: 'invalid_payload' });
  });

test.each(['unavailable', 'retryable', 'terminal', 'cancelled'] as const)('help %s failures expose only bounded reasons', async (status) => {
  mockNative.fetchHelpExperimentControl.mockResolvedValue({ status, reason: 'background', secret: 'do-not-return' });
  expect(await bridge().fetchHelpExperimentControl()).toEqual({ status, reason: 'background' });
  mockNative.fetchHelpExperimentControl.mockResolvedValue({ status, reason: 'private-exception' });
  expect(await bridge().fetchHelpExperimentControl()).toEqual({ status, reason: 'unavailable' });
});

test('help native rejection is normalized without raw exception data', async () => {
  mockNative.fetchHelpExperimentControl.mockRejectedValue(new Error('private-token@example.com'));
  expect(await bridge().fetchHelpExperimentControl()).toEqual({ status: 'retryable', reason: 'unavailable' });
});
