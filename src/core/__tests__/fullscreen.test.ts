import type { FullscreenLease, FullscreenOwner } from '../fullscreen';

let fullscreen: typeof import('../fullscreen');

beforeEach(() => {
  jest.resetModules();
  fullscreen = jest.requireActual('../fullscreen');
});

test.each(['interstitial', 'rewarded', 'review', 'checkout', 'update'] as const)(
  '%s synchronously blocks every other fullscreen owner', (owner) => {
    const lease = fullscreen.tryAcquireFullscreen(owner);
    expect(lease).not.toBeNull();
    const snapshot = fullscreen.getFullscreenSnapshot();
    expect(snapshot).toEqual({ owner, revision: 1 });

    for (const contender of ['interstitial', 'rewarded', 'review', 'checkout', 'update'] as const) {
      expect(fullscreen.tryAcquireFullscreen(contender)).toBeNull();
      expect(fullscreen.getFullscreenSnapshot()).toBe(snapshot);
    }

    expect(fullscreen.releaseFullscreen(lease!)).toBe(true);
    expect(fullscreen.getFullscreenSnapshot()).toEqual({ owner: null, revision: 2 });
  },
);

test('concurrent callers have one winner before either Promise resumes', async () => {
  const attempts = await Promise.all((['review', 'checkout', 'rewarded'] as const)
    .map(async (owner) => fullscreen.tryAcquireFullscreen(owner)));
  expect(attempts.filter(Boolean)).toHaveLength(1);
  expect(fullscreen.getFullscreenSnapshot().owner).toBe('review');
  expect(fullscreen.releaseFullscreen(attempts[0]!)).toBe(true);
});

test('unrelated Promise completion and elapsed time never release the UI owner', async () => {
  jest.useFakeTimers();
  try {
    const lease = fullscreen.tryAcquireFullscreen('rewarded')!;
    const snapshot = fullscreen.getFullscreenSnapshot();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000);
    expect(fullscreen.getFullscreenSnapshot()).toBe(snapshot);
    expect(fullscreen.tryAcquireFullscreen('review')).toBeNull();
    expect(fullscreen.releaseFullscreen(lease)).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test('duplicate, forged and stale callbacks cannot release a newer owner', () => {
  const old = fullscreen.tryAcquireFullscreen('rewarded')!;
  expect(fullscreen.releaseFullscreen({ ...old } as FullscreenLease)).toBe(false);
  expect(fullscreen.releaseFullscreen(old)).toBe(true);
  expect(fullscreen.releaseFullscreen(old)).toBe(false);

  const next = fullscreen.tryAcquireFullscreen('review')!;
  const snapshot = fullscreen.getFullscreenSnapshot();
  expect(next).not.toBe(old);
  expect(fullscreen.releaseFullscreen(old)).toBe(false);
  expect(fullscreen.getFullscreenSnapshot()).toBe(snapshot);
  expect(fullscreen.tryAcquireFullscreen('checkout')).toBeNull();
  expect(fullscreen.releaseFullscreen(next)).toBe(true);
});

test('snapshots stay stable and immutable without exposing the lease', () => {
  const initial = fullscreen.getFullscreenSnapshot();
  expect(initial).toEqual({ owner: null, revision: 0 });
  expect(fullscreen.getFullscreenSnapshot()).toBe(initial);
  expect(Object.isFrozen(initial)).toBe(true);

  const lease = fullscreen.tryAcquireFullscreen('checkout')!;
  const occupied = fullscreen.getFullscreenSnapshot();
  expect(occupied).not.toBe(initial);
  expect(Object.isFrozen(occupied)).toBe(true);
  expect(Object.keys(occupied).sort()).toEqual(['owner', 'revision']);
  expect(Reflect.set(occupied, 'owner', null)).toBe(false);
  expect(fullscreen.getFullscreenSnapshot()).toBe(occupied);
  expect(initial).toEqual({ owner: null, revision: 0 });

  expect(fullscreen.releaseFullscreen(lease)).toBe(true);
  expect(occupied).toEqual({ owner: 'checkout', revision: 1 });
  expect(fullscreen.getFullscreenSnapshot()).toEqual({ owner: null, revision: 2 });
});

test('subscriptions observe committed changes, ignore failed mutations and clean up independently', () => {
  const observed: (FullscreenOwner | null)[] = [];
  const listener = jest.fn(() => { observed.push(fullscreen.getFullscreenSnapshot().owner); });
  const stopFirst = fullscreen.subscribeFullscreen(listener);
  const stopSecond = fullscreen.subscribeFullscreen(listener);
  expect(listener).not.toHaveBeenCalled();

  const lease = fullscreen.tryAcquireFullscreen('interstitial')!;
  expect(observed).toEqual(['interstitial', 'interstitial']);
  expect(fullscreen.tryAcquireFullscreen('review')).toBeNull();
  expect(fullscreen.releaseFullscreen({} as FullscreenLease)).toBe(false);
  expect(listener).toHaveBeenCalledTimes(2);

  stopFirst(); stopFirst();
  fullscreen.releaseFullscreen(lease);
  expect(observed).toEqual(['interstitial', 'interstitial', null]);
  stopSecond();
  fullscreen.tryAcquireFullscreen('update');
  expect(listener).toHaveBeenCalledTimes(3);
});

test('a failing subscriber cannot roll back ownership or prevent another notification', () => {
  fullscreen.subscribeFullscreen(() => { throw new Error('subscriber failed'); });
  const listener = jest.fn();
  fullscreen.subscribeFullscreen(listener);
  const lease = fullscreen.tryAcquireFullscreen('review')!;
  expect(fullscreen.getFullscreenSnapshot().owner).toBe('review');
  expect(listener).toHaveBeenCalledTimes(1);
  expect(fullscreen.releaseFullscreen(lease)).toBe(true);
  expect(listener).toHaveBeenCalledTimes(2);
});

test('a subscriber can acquire after release without an old callback freeing the new owner', () => {
  const old = fullscreen.tryAcquireFullscreen('review')!;
  let next: FullscreenLease | null = null;
  const stop = fullscreen.subscribeFullscreen(() => {
    if (!next && fullscreen.getFullscreenSnapshot().owner === null) {
      next = fullscreen.tryAcquireFullscreen('checkout');
    }
  });
  const observed: (FullscreenOwner | null)[] = [];
  fullscreen.subscribeFullscreen(() => { observed.push(fullscreen.getFullscreenSnapshot().owner); });

  expect(fullscreen.releaseFullscreen(old)).toBe(true);
  expect(next).not.toBeNull();
  expect(fullscreen.getFullscreenSnapshot()).toEqual({ owner: 'checkout', revision: 3 });
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((owner) => owner === 'checkout')).toBe(true);
  expect(fullscreen.releaseFullscreen(old)).toBe(false);
  stop();
  expect(fullscreen.releaseFullscreen(next!)).toBe(true);
});

test('a subscription added during notification starts with the next transition', () => {
  const late = jest.fn();
  let registered = false;
  fullscreen.subscribeFullscreen(() => {
    if (!registered) {
      registered = true;
      fullscreen.subscribeFullscreen(late);
    }
  });
  const lease = fullscreen.tryAcquireFullscreen('rewarded')!;
  expect(late).not.toHaveBeenCalled();
  fullscreen.releaseFullscreen(lease);
  expect(late).toHaveBeenCalledTimes(1);
});
