import { AppState } from 'react-native';
import { updatesGateway } from '../../../modules/rustore-updates';
import { hasActiveForm } from '../../../modules/rustore-review';
import { getJSON, KEYS, storage } from '@/core/storage';
import { track, trackOnce } from '@/features/analytics';
import { hasActiveNativeRewardedShow } from '@/features/monetization/nativeRewardJournal';
import { openCheckoutConfirmation } from '@/features/monetization/checkoutFullscreen';
import { createUpdatesCoordinator, UPDATES_RESULT_KEY, UPDATES_STATE_KEY } from './coordinator';
import { UPDATES_ENABLED } from './config';

let focused = true, cleanup: (() => void) | null = null;
let manualBusy = false;
const profileScope = () => getJSON<{ userId?: string } | null>(KEYS.profile, null)?.userId ?? 'guest';
const coordinator = createUpdatesCoordinator({ gateway: updatesGateway, enabled: () => UPDATES_ENABLED,
  foreground: () => AppState.currentState === 'active' && focused,
  scope: profileScope, now: Date.now,
  nativeFormBusy: hasActiveForm, nativeRewardedBusy: hasActiveNativeRewardedShow,
  read: () => storage.getString(UPDATES_STATE_KEY) ?? null,
  write: (value) => { storage.set(UPDATES_STATE_KEY, value); return storage.getString(UPDATES_STATE_KEY) === value; },
  readResultMarker: () => storage.getString(UPDATES_RESULT_KEY) ?? null,
  writeResultMarker: (value) => { storage.set(UPDATES_RESULT_KEY, value); return storage.getString(UPDATES_RESULT_KEY) === value; },
  event: (name, properties, onceKey) => { if (onceKey) trackOnce(name, onceKey, properties); else track(name, properties); },
});

/** Root owns one lifecycle registration; network work never blocks application startup. */
export function startUpdates(): () => void {
  if (cleanup) return cleanup;
  coordinator.start();
  const refresh = () => { if (AppState.currentState === 'active' && focused) void coordinator.refresh(); };
  const subscriptions = UPDATES_ENABLED ? [AppState.addEventListener('change', (state) => { if (state !== 'active') focused = false; refresh(); }),
    AppState.addEventListener('blur', () => { focused = false; }), AppState.addEventListener('focus', () => { focused = true; refresh(); })] : [];
  if (UPDATES_ENABLED) refresh();
  let closed = false;
  cleanup = () => {
    if (closed) return;
    closed = true; for (const subscription of subscriptions) subscription.remove(); coordinator.stop(); cleanup = null;
  };
  return cleanup;
}
export const getUpdatesSnapshot = coordinator.getSnapshot;
export const subscribeUpdates = coordinator.subscribe;
export const requestUpdate = coordinator.request;
export const hasUpdateAttemptForResult = coordinator.hasResultAttempt;

/** Fixed main-app listing. Published store-card mapping is a future release check. */
export const MANUAL_UPDATE_URL = 'https://www.rustore.ru/catalog/app/com.intstrfloat.slova';
export async function openManualUpdate(isSafePoint: () => boolean, resultAttemptId: string): Promise<boolean> {
  const scope = profileScope();
  const safe = () => { try { return UPDATES_ENABLED && AppState.currentState === 'active' && focused && isSafePoint() && !hasActiveForm() && profileScope() === scope; } catch { return false; } };
  if (manualBusy || !safe()) return false;
  manualBusy = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await openCheckoutConfirmation(MANUAL_UPDATE_URL, 'update', async () => {
      const nativeBusy = await Promise.race([hasActiveNativeRewardedShow(), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), 1000); })]);
      return !nativeBusy && safe();
    }, () => safe() && coordinator.markResultAttempt(resultAttemptId));
    return true;
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); manualBusy = false; }
}
