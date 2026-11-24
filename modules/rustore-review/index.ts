import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type ReviewLaunchResult = 'completed' | 'unavailable' | 'error';
export type ReviewPrepareResult = 'ready' | 'unavailable' | 'error';

interface RuStoreReviewNativeModule {
  isAvailable(): boolean;
  prepare(): Promise<boolean>;
  launch(): Promise<ReviewLaunchResult>;
  discard(): void;
  prepareResult?: () => Promise<ReviewPrepareResult>;
  hasActiveForm?: () => boolean;
  getLifecycleVersion?: () => number;
  addListener?: (event: 'onFormOwnerChanged', listener: () => void) => { remove: () => void };
}

const nativeModule = Platform.OS === 'android'
  ? requireOptionalNativeModule<RuStoreReviewNativeModule>('RuStoreReview')
  : null;

function supportedLifecycle(): boolean {
  const version = nativeModule?.getLifecycleVersion?.();
  return version === 2 || version === 3;
}

export function isAvailable(): boolean {
  try {
    // New JS must not start an automatic form on an old binary without lifetime guards.
    return typeof nativeModule?.prepareResult === 'function'
      && typeof nativeModule?.hasActiveForm === 'function'
      && typeof nativeModule?.addListener === 'function'
      && supportedLifecycle() && nativeModule.isAvailable();
  } catch {
    return false;
  }
}

/** Includes a form retained by a previous JS runtime in this Android process. */
export function hasActiveForm(): boolean {
  try { return nativeModule?.hasActiveForm?.() === true; } catch { return true; }
}

/** Invalidation only: subscribers read the current native owner rather than trusting a queued payload. */
export function subscribeFormOwnership(listener: () => void): () => void {
  try {
    if (!supportedLifecycle()) return () => {};
    const subscription = nativeModule?.addListener?.('onFormOwnerChanged', listener);
    return () => { try { subscription?.remove(); } catch { /* Optional lifecycle cleanup. */ } };
  } catch { return () => {}; }
}

export async function prepareResult(): Promise<ReviewPrepareResult> {
  try {
    if (!isAvailable()) return 'unavailable';
    const result = await nativeModule!.prepareResult!();
    return result === 'ready' || result === 'unavailable' || result === 'error' ? result : 'error';
  } catch { return 'error'; }
}

export async function prepare(): Promise<boolean> {
  try {
    return await nativeModule?.prepare() ?? false;
  } catch {
    return false;
  }
}

// Completion means the native flow ended; the SDK does not expose the chosen
// stars or whether the player submitted a review.
export async function launch(): Promise<ReviewLaunchResult> {
  try {
    const result = await nativeModule?.launch() ?? 'unavailable';
    return result === 'completed' || result === 'unavailable' || result === 'error' ? result : 'error';
  } catch {
    return 'error';
  }
}

export function discard(): void {
  try {
    nativeModule?.discard();
  } catch {
    // Optional prompting must never interrupt the game.
  }
}
