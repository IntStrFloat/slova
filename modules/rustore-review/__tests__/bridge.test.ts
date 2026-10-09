const mockNative = {
  isAvailable: jest.fn(() => true),
  prepare: jest.fn(() => Promise.resolve(true)),
  launch: jest.fn(() => Promise.resolve('completed')),
  discard: jest.fn(),
};
let mockPlatform = 'android';
let mockInstalled = true;

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  Object.defineProperty(actual.Platform, 'OS', { get: () => mockPlatform, configurable: true });
  return actual;
});
jest.mock('expo', () => ({
  requireOptionalNativeModule: jest.fn(() => mockInstalled ? mockNative : null),
}));

function bridge(): typeof import('../index') {
  let module!: typeof import('../index');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = require('../index');
  });
  return module;
}

describe('optional RuStore Review bridge', () => {
  beforeEach(() => {
    mockPlatform = 'android';
    mockInstalled = true;
    mockNative.isAvailable.mockReset().mockReturnValue(true);
    mockNative.prepare.mockReset().mockResolvedValue(true);
    mockNative.launch.mockReset().mockResolvedValue('completed');
    mockNative.discard.mockReset();
  });

  it('uses the Android bridge and waits for native completion', async () => {
    const review = bridge();
    expect(review.isAvailable()).toBe(true);
    expect(await review.prepare()).toBe(true);
    expect(await review.launch()).toBe('completed');
    review.discard();
    expect(mockNative.discard).toHaveBeenCalledTimes(1);
  });

  it.each(['web', 'ios'])('skips native requests on %s', async (platform) => {
    mockPlatform = platform;
    const review = bridge();
    expect(review.isAvailable()).toBe(false);
    expect(await review.prepare()).toBe(false);
    expect(await review.launch()).toBe('unavailable');
    expect(mockNative.prepare).not.toHaveBeenCalled();
    expect(mockNative.launch).not.toHaveBeenCalled();
  });

  it('is a silent no-op in builds without the optional native module', async () => {
    mockInstalled = false;
    const review = bridge();
    expect(review.isAvailable()).toBe(false);
    expect(await review.prepare()).toBe(false);
    expect(await review.launch()).toBe('unavailable');
    expect(() => review.discard()).not.toThrow();
  });

  it('contains native failures so they cannot interrupt the game', async () => {
    mockNative.isAvailable.mockImplementation(() => { throw new Error('unavailable'); });
    mockNative.prepare.mockRejectedValue(new Error('store missing'));
    mockNative.launch.mockRejectedValue(new Error('store error'));
    mockNative.discard.mockImplementation(() => { throw new Error('module gone'); });
    const review = bridge();
    expect(review.isAvailable()).toBe(false);
    expect(await review.prepare()).toBe(false);
    expect(await review.launch()).toBe('error');
    expect(() => review.discard()).not.toThrow();
  });
});
