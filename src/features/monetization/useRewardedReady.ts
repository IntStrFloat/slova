import { useCallback, useSyncExternalStore } from 'react';

import { getAds } from './providers';
import type { RewardedState } from './types';

/** Keep an open reward offer in sync with native ad loads and consumption. */
export function useRewardedReady(): boolean {
  const provider = getAds();
  const subscribe = useCallback((listener: () => void) =>
    provider.subscribeRewardedReady?.(listener) ?? (() => {}), [provider]);
  const getSnapshot = useCallback(() => provider.isRewardedReady(), [provider]);

  // Providers without notifications still refresh on ordinary React renders.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** A primitive snapshot also updates when an unavailable reason changes. */
export function useRewardedState(): RewardedState {
  const provider = getAds();
  const subscribe = useCallback((listener: () => void) =>
    provider.subscribeRewardedState?.(listener) ?? provider.subscribeRewardedReady?.(listener) ?? (() => {}), [provider]);
  const getSnapshot = useCallback(() => provider.getRewardedState?.()
    ?? (provider.isRewardedReady() ? 'ready' : 'not_ready'), [provider]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
