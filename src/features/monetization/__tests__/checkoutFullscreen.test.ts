/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native', () => Object.create(jest.requireActual('react-native'), {
  AppState: { value: { currentState: 'active', addEventListener: jest.fn() } },
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));
jest.mock('../../../../modules/rustore-review', () => ({ hasActiveForm: jest.fn(() => false) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture() {
  jest.resetModules();
  const { AppState } = require('react-native');
  const listeners = new Map<string, Set<(state?: string) => void>>();
  AppState.currentState = 'active';
  AppState.addEventListener.mockImplementation((event: string, callback: (state?: string) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(callback);
    return { remove: jest.fn(() => listeners.get(event)!.delete(callback)) };
  });
  const dispatch = (event: string, value?: string) => {
    if (event === 'change') AppState.currentState = value;
    for (const callback of [...(listeners.get(event) ?? [])]) callback(value);
  };
  const { openURL } = require('expo-linking');
  return { AppState, listeners, dispatch, openURL, fullscreen: require('@/core/fullscreen'),
    native: require('../../../../modules/rustore-review'),
    open: require('../checkoutFullscreen').openCheckoutConfirmation };
}

test('browser launch acceptance keeps UI owned until an observed departure and active focused return', async () => {
  const f = fixture();
  await f.open('https://example.invalid/checkout');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('checkout');
  f.dispatch('focus');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('checkout');
  f.dispatch('blur'); f.dispatch('change', 'background');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('checkout');
  f.dispatch('change', 'active');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('checkout');
  f.dispatch('focus');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
  expect([...f.listeners.values()].every((set) => set.size === 0)).toBe(true);
});

test('an explicit fixed store listing uses update ownership with the same actual browser return boundary', async () => {
  const f = fixture();
  await f.open('https://www.rustore.ru/catalog/app/com.intstrfloat.slova', 'update');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('update');
  f.dispatch('blur'); f.dispatch('change', 'background'); f.dispatch('change', 'active');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('update');
  f.dispatch('focus'); expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});

test('lifecycle return before the launch Promise is accepted is retained until acceptance', async () => {
  const f = fixture();
  const launch = deferred<boolean>();
  f.openURL.mockReturnValueOnce(launch.promise);
  const pending = f.open('https://example.invalid/checkout');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('checkout');
  f.dispatch('blur'); f.dispatch('change', 'background'); f.dispatch('change', 'active'); f.dispatch('focus');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('checkout');
  launch.resolve(true);
  await pending;
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});

test('notification-shade blur/focus alone is not evidence that the browser returned', async () => {
  const f = fixture();
  await f.open('https://example.invalid/checkout');
  f.dispatch('blur'); f.dispatch('focus');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('checkout');
  f.dispatch('change', 'background'); f.dispatch('change', 'active'); f.dispatch('focus');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});

test('launch failure releases the exact lease and queued old callbacks cannot release a newer owner', async () => {
  const f = fixture();
  const launch = deferred<boolean>();
  f.openURL.mockReturnValueOnce(launch.promise);
  const pending = f.open('https://example.invalid/checkout');
  const callbacks = [...f.listeners.entries()].flatMap(([name, entries]) => [...entries].map((callback) => ({ name, callback })));
  launch.reject(new Error('no handler'));
  await expect(pending).rejects.toThrow('browser_unavailable');
  const next = f.fullscreen.tryAcquireFullscreen('review');
  for (const { name, callback } of callbacks) callback(name === 'change' ? 'active' : undefined);
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('review');
  f.fullscreen.releaseFullscreen(next);
});

test.each(['review', 'interstitial', 'rewarded', 'update'])('%s blocks browser launch without changing its owner', async (owner) => {
  const f = fixture();
  const lease = f.fullscreen.tryAcquireFullscreen(owner);
  await expect(f.open('https://example.invalid/checkout')).rejects.toThrow('checkout_unavailable');
  expect(f.openURL).not.toHaveBeenCalled();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe(owner);
  f.fullscreen.releaseFullscreen(lease);
});

test('a native Review retained across JS recreation blocks checkout even with an empty JS owner', async () => {
  const f = fixture();
  f.native.hasActiveForm.mockReturnValueOnce(true);
  await expect(f.open('https://example.invalid/checkout')).rejects.toThrow('checkout_unavailable');
  expect(f.openURL).not.toHaveBeenCalled();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});

test('background callers cannot open an unsolicited browser and failure to observe lifecycle fails closed', async () => {
  const f = fixture();
  f.AppState.currentState = 'background';
  await expect(f.open('https://example.invalid/checkout')).rejects.toThrow('checkout_unavailable');
  f.AppState.currentState = 'active';
  f.AppState.addEventListener.mockImplementationOnce(() => { throw new Error('bridge gone'); });
  await expect(f.open('https://example.invalid/checkout')).rejects.toThrow('browser_unavailable');
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
  expect(f.openURL).not.toHaveBeenCalled();
});
test('optional update preflight keeps one synchronous lease before launch and releases it on refusal', async () => {
  const f = fixture(), before = deferred<boolean>();
  const pending = f.open('https://www.rustore.ru/catalog/app/com.intstrfloat.slova', 'update', () => before.promise);
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('update'); expect(f.openURL).not.toHaveBeenCalled();
  expect(f.listeners.size).toBe(0); before.resolve(false);
  await expect(pending).rejects.toThrow('browser_unavailable'); expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});
test('a successful preflight hands the same lease to browser departure/return instead of launch acceptance', async () => {
  const f = fixture(), before = deferred<boolean>();
  const pending = f.open('https://www.rustore.ru/catalog/app/com.intstrfloat.slova', 'update', () => before.promise);
  const reserved = f.fullscreen.getFullscreenSnapshot(); before.resolve(true); await pending;
  expect(f.fullscreen.getFullscreenSnapshot()).toBe(reserved);
  f.dispatch('change', 'background'); f.dispatch('change', 'active'); expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('update');
  f.dispatch('focus'); expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});
