export type FullscreenOwner = 'interstitial' | 'rewarded' | 'review' | 'checkout' | 'update';

declare const leaseBrand: unique symbol;
export type FullscreenLease = Readonly<{ [leaseBrand]: true }>;
export type FullscreenSnapshot = Readonly<{ owner: FullscreenOwner | null; revision: number }>;

let activeLease: FullscreenLease | null = null;
let snapshot: FullscreenSnapshot = Object.freeze({ owner: null, revision: 0 });
const listeners = new Set<() => void>();

function publish(owner: FullscreenOwner | null): void {
  snapshot = Object.freeze({ owner, revision: snapshot.revision + 1 });
  // Invalidations are synchronous and may reenter. Read the current snapshot,
  // rather than treating a notification as a historical ownership event.
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* Observers cannot change an operation's result. */ }
  }
}

/** The caller owns the actual UI lifetime, including background and missing callbacks. */
export function tryAcquireFullscreen(owner: FullscreenOwner): FullscreenLease | null {
  if (activeLease !== null) return null;
  const lease = Object.freeze({}) as FullscreenLease;
  activeLease = lease;
  publish(owner);
  return lease;
}

/** Only the exact active lease can release ownership; stale callbacks are harmless. */
export function releaseFullscreen(lease: FullscreenLease): boolean {
  if (activeLease === null || activeLease !== lease) return false;
  activeLease = null;
  publish(null);
  return true;
}

export function getFullscreenSnapshot(): FullscreenSnapshot {
  return snapshot;
}

/** Subscribe to future changes. Each registration has an independent, idempotent cleanup. */
export function subscribeFullscreen(listener: () => void): () => void {
  const subscription = () => listener();
  listeners.add(subscription);
  return () => { listeners.delete(subscription); };
}
