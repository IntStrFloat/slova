/* eslint-disable @typescript-eslint/no-require-imports */
let mockCapability: unknown;
let mockPlatform = 'android';
const mockPanelLoaded = jest.fn();
const mockBusinessLoaded = jest.fn();
const load = async () => { mockPanelLoaded(); return { ProductQaPanel: () => null }; };
jest.mock('react-native', () => ({ Platform: { get OS() { return mockPlatform; }, select: () => undefined }, TurboModuleRegistry: { get: () => null } }));
jest.mock('@/core/native/appmetrica', () => ({ getCrashReportingCapabilities: () => mockCapability }));
jest.mock('../ProductQaPanel', () => { mockPanelLoaded(); return { ProductQaPanel: () => null }; });
jest.mock('@/features/currency', () => { mockBusinessLoaded(); return { useCurrency: null }; });
const initialFlag = process.env.EXPO_PUBLIC_LOCAL_SDK_QA;
beforeEach(() => {
  jest.resetModules(); mockPanelLoaded.mockClear(); mockBusinessLoaded.mockClear(); mockPlatform = 'android';
  process.env.EXPO_PUBLIC_LOCAL_SDK_QA = '1';
  mockCapability = { version: 1, enabled: true, localQa: true };
});
afterAll(() => {
  if (initialFlag === undefined) delete process.env.EXPO_PUBLIC_LOCAL_SDK_QA;
  else process.env.EXPO_PUBLIC_LOCAL_SDK_QA = initialFlag;
});
test.each([undefined, '0', 'true', 'yes'])(
  'public flag %s never imports the QA panel or business stores', async (value) => {
    if (value === undefined) delete process.env.EXPO_PUBLIC_LOCAL_SDK_QA;
    else process.env.EXPO_PUBLIC_LOCAL_SDK_QA = value;
    expect(await require('../entry').loadProductQaPanel(load)).toBeNull();
    expect(require('../loadRuntime').getProductQaHarness()).toBeNull();
    expect(mockPanelLoaded).not.toHaveBeenCalled();
    expect(mockBusinessLoaded).not.toHaveBeenCalled();
  },
);
test.each([null, undefined, {}, { version: 2, enabled: true, localQa: true },
  { version: 1, enabled: false, localQa: true }, { version: 1, enabled: true, localQa: false },
  { version: 1, enabled: true, localQa: 'true' }])('unknown/native non-QA capability %j denies all loading', async (value) => {
  mockCapability = value;
  expect(await require('../entry').loadProductQaPanel(load)).toBeNull();
  expect(require('../loadRuntime').getProductQaHarness()).toBeNull();
  expect(mockPanelLoaded).not.toHaveBeenCalled();
  expect(mockBusinessLoaded).not.toHaveBeenCalled();
});
test('only Android with public and strict native package capability can load the panel', async () => {
  mockPlatform = 'web';
  expect(await require('../entry').loadProductQaPanel(load)).toBeNull();
  expect(mockPanelLoaded).not.toHaveBeenCalled();
  mockPlatform = 'android';
  expect(await require('../entry').loadProductQaPanel(load)).toEqual(expect.any(Function));
  expect(mockPanelLoaded).toHaveBeenCalledTimes(1);
});
test('revoking native capability during asynchronous panel loading prevents mounting', async () => {
  const pending = require('../entry').loadProductQaPanel(load);
  mockCapability = null;
  expect(await pending).toBeNull();
});
