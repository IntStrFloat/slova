const mockNative = {
  isAvailable: jest.fn(() => true),
  prepare: jest.fn(() => Promise.resolve(true)),
  launch: jest.fn(() => Promise.resolve('completed')),
  discard: jest.fn(),
  prepareResult: jest.fn(() => Promise.resolve('ready')),
  hasActiveForm: jest.fn(() => false),
  getLifecycleVersion: jest.fn(() => 2),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};
let mockPlatform = 'android';
let mockInstalled = true;
let mockLifecycleCapable = true;

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  Object.defineProperty(actual.Platform, 'OS', { get: () => mockPlatform, configurable: true });
  return actual;
});
jest.mock('expo', () => ({
  requireOptionalNativeModule: jest.fn(() => {
    if (!mockInstalled) return null;
    if (mockLifecycleCapable) return mockNative;
    return { isAvailable: mockNative.isAvailable, prepare: mockNative.prepare,
      launch: mockNative.launch, discard: mockNative.discard };
  }),
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
    mockLifecycleCapable = true;
    mockNative.isAvailable.mockReset().mockReturnValue(true);
    mockNative.prepare.mockReset().mockResolvedValue(true);
    mockNative.launch.mockReset().mockResolvedValue('completed');
    mockNative.discard.mockReset();
    mockNative.prepareResult.mockReset().mockResolvedValue('ready');
    mockNative.hasActiveForm.mockReset().mockReturnValue(false);
    mockNative.getLifecycleVersion.mockReset().mockReturnValue(2);
    mockNative.addListener.mockClear();
  });

  it('uses the Android bridge and waits for native completion', async () => {
    const review = bridge();
    expect(review.isAvailable()).toBe(true);
    expect(await review.prepare()).toBe(true);
    expect(await review.prepareResult()).toBe('ready');
    expect(review.hasActiveForm()).toBe(false);
    expect(await review.launch()).toBe('completed');
    review.discard();
    expect(mockNative.discard).toHaveBeenCalledTimes(1);
  });

  it('fails closed for automatic Review on an older binary without lifecycle capability', async () => {
    mockLifecycleCapable = false;
    const review = bridge();
    expect(review.isAvailable()).toBe(false);
    expect(await review.prepareResult()).toBe('unavailable');
    expect(mockNative.prepare).not.toHaveBeenCalled();
    expect(mockNative.launch).not.toHaveBeenCalled();
  });

  it('contains unknown native values and retains a form guard when its query fails', async () => {
    mockNative.prepareResult.mockResolvedValue('unexpected');
    mockNative.launch.mockResolvedValue('unexpected');
    mockNative.hasActiveForm.mockImplementation(() => { throw new Error('bridge unavailable'); });
    const review = bridge();
    expect(await review.prepareResult()).toBe('error');
    expect(await review.launch()).toBe('error');
    expect(review.hasActiveForm()).toBe(true);
  });

  it('subscribes once to native owner invalidations and removes the exact subscription', () => {
    const review = bridge();
    const listener = jest.fn();
    const remove = jest.fn();
    mockNative.addListener.mockReturnValueOnce({ remove });
    const stop = review.subscribeFormOwnership(listener);
    expect(mockNative.addListener).toHaveBeenCalledWith('onFormOwnerChanged', listener);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe or start automatic Review on a previous lifecycle binary', () => {
    mockNative.getLifecycleVersion.mockReturnValue(1);
    const review = bridge();
    expect(review.isAvailable()).toBe(false);
    expect(() => review.subscribeFormOwnership(jest.fn())()).not.toThrow();
    expect(mockNative.addListener).not.toHaveBeenCalled();
  });

  it('retains Review support and owner subscriptions on the shared Updates guardian v3', () => {
    mockNative.getLifecycleVersion.mockReturnValue(3);
    const review = bridge();
    expect(review.isAvailable()).toBe(true);
    review.subscribeFormOwnership(jest.fn());
    expect(mockNative.addListener).toHaveBeenCalledTimes(1);
  });

  it.each([0, 4, 99])('fails closed on unknown native lifecycle version %s', (version) => {
    mockNative.getLifecycleVersion.mockReturnValue(version);
    const review = bridge();
    expect(review.isAvailable()).toBe(false);
    review.subscribeFormOwnership(jest.fn());
    expect(mockNative.addListener).not.toHaveBeenCalled();
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
