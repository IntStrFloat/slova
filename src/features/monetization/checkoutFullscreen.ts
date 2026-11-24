import * as Linking from 'expo-linking';
import { AppState } from 'react-native';

import { hasActiveForm } from '../../../modules/rustore-review';
import { releaseFullscreen, tryAcquireFullscreen } from '@/core/fullscreen';

/** Browser acceptance is separate from the external UI's actual departure/return. */
export async function openCheckoutConfirmation(
  url: string, owner: 'checkout' | 'update' = 'checkout', beforeLaunch?: () => Promise<boolean>, canLaunch?: () => boolean,
): Promise<void> {
  if (AppState.currentState !== 'active' || hasActiveForm()) throw new Error('checkout_unavailable');
  const lease = tryAcquireFullscreen(owner);
  if (!lease) throw new Error('checkout_unavailable');
  const subscriptions: { remove: () => void }[] = [];
  let accepted = false;
  let departed = false;
  let foreground = true;
  let focused = true;
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    for (const subscription of subscriptions) {
      try { subscription.remove(); } catch { /* Stale observers cannot own a newer token. */ }
    }
    releaseFullscreen(lease);
  };
  const observeReturn = () => {
    if (accepted && departed && foreground && focused && AppState.currentState === 'active') finish();
  };
  try {
    // Optional update preflight runs under this same lease, before any external UI exists.
    if (beforeLaunch && (!await beforeLaunch() || AppState.currentState !== 'active' || hasActiveForm())) throw new Error('browser_preflight_refused');
    // Install all observers before openURL: lifecycle notifications may precede its Promise.
    subscriptions.push(AppState.addEventListener('change', (state) => {
      if (closed) return;
      foreground = state === 'active';
      if (!foreground) focused = false;
      if (state === 'background') departed = true;
      observeReturn();
    }));
    subscriptions.push(AppState.addEventListener('blur', () => {
      if (closed) return;
      focused = false;
    }));
    subscriptions.push(AppState.addEventListener('focus', () => {
      if (closed) return;
      focused = true;
      observeReturn();
    }));
    if (canLaunch && !canLaunch()) throw new Error('browser_preflight_refused');
    await Linking.openURL(url);
    accepted = true;
    observeReturn();
  } catch {
    finish();
    throw new Error('browser_unavailable');
  }
}
