import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type ReviewLaunchResult = 'completed' | 'unavailable' | 'error';

interface RuStoreReviewNativeModule {
  isAvailable(): boolean;
  prepare(): Promise<boolean>;
  launch(): Promise<ReviewLaunchResult>;
  discard(): void;
}

const nativeModule = Platform.OS === 'android'
  ? requireOptionalNativeModule<RuStoreReviewNativeModule>('RuStoreReview')
  : null;

export function isAvailable(): boolean {
  try {
    return nativeModule?.isAvailable() ?? false;
  } catch {
    return false;
  }
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
    return await nativeModule?.launch() ?? 'unavailable';
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
