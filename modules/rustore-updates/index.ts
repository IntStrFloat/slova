import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { DOWNLOAD_STATES, validVersion, type CheckResult, type DownloadEvent, type FailureResult, type FlowResult, type UpdatesGateway } from './types';
export type { CheckResult, DownloadEvent, FlowResult, UpdatesGateway } from './types';

interface NativeUpdates {
  getCapabilities(): { bridgeVersion?: number; guardianVersion?: number; flexible?: boolean; realSdkAllowed?: boolean };
  getNativeVersionCode(): unknown;
  checkAvailability(): Promise<unknown>;
  startFlexible(token: string): Promise<unknown>;
  completeFlexible(versionCode: string): Promise<unknown>;
  discard(): void;
  addListener(event: string, listener: (value: unknown) => void): { remove(): void };
}
const native = Platform.OS === 'android' ? requireOptionalNativeModule<NativeUpdates>('RuStoreUpdates') : null;
const unavailable = (): FailureResult => ({ result: 'unavailable', reason: 'native_unavailable' });
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const token = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const reasons = new Set(['disabled', 'native_unavailable', 'busy', 'stale_info', 'activity_not_ready', 'not_available', 'unknown_state', 'invalid_version', 'accepted', 'declined', 'flow_returned', 'store_missing', 'store_outdated', 'unauthorized', 'feature_unavailable', 'network', 'download', 'storage', 'internal', 'aborted', 'interrupted', 'blocked', 'invalid_apk', 'conflict', 'incompatible', 'not_owned', 'missing_apk', 'source_denied', 'verification_blocked', 'unknown_error']);
function fields(value: Record<string, unknown>) {
  return { reason: typeof value.reason === 'string' && reasons.has(value.reason) ? value.reason : 'unknown_error',
    ...(typeof value.errorCode === 'number' && Number.isInteger(value.errorCode) && value.errorCode >= 0 && value.errorCode <= 100_000 ? { errorCode: value.errorCode } : {}) };
}
export function isSupported(): boolean {
  try {
    const c = native?.getCapabilities();
    return c?.bridgeVersion === 1 && c.guardianVersion === 3 && c.flexible === true
      && ['getNativeVersionCode', 'checkAvailability', 'startFlexible', 'completeFlexible', 'discard', 'addListener']
        .every((key) => typeof native?.[key as keyof NativeUpdates] === 'function');
  } catch { return false; }
}
/** PackageManager only. This must remain callable while the SDK factory is forbidden. */
export function getNativeVersionCode(): string | null {
  try { const value = native?.getNativeVersionCode(); return validVersion(value) ? value : null; } catch { return null; }
}
export async function checkAvailability(): Promise<CheckResult> {
  if (!isSupported()) return unavailable();
  try {
    const value = await native!.checkAvailability();
    if (plain(value)) {
      if (value.result === 'available' && validVersion(value.versionCode) && validVersion(value.installedVersionCode)
        && token(value.infoToken) && DOWNLOAD_STATES.includes(value.state as DownloadEvent['state'])) {
        return { result: 'available', versionCode: value.versionCode, installedVersionCode: value.installedVersionCode,
          infoToken: value.infoToken, state: value.state as DownloadEvent['state'] };
      }
      if (['none', 'cancelled', 'unavailable', 'retryable_error', 'terminal_error', 'unknown'].includes(value.result as string)) {
        return { result: value.result, ...fields(value) } as CheckResult;
      }
    }
    return { result: 'unknown', reason: 'invalid_native_result' };
  } catch { return { result: 'retryable_error', reason: 'native_error' }; }
}
async function flow(operation: () => Promise<unknown>): Promise<FlowResult> {
  if (!isSupported()) return unavailable();
  try {
    const value = await operation();
    if (plain(value) && ['download_accepted', 'cancelled', 'flow_ended_unconfirmed', 'unavailable', 'retryable_error', 'terminal_error', 'unknown'].includes(value.result as string)) {
      return { result: value.result, ...fields(value) } as FlowResult;
    }
    return { result: 'unknown', reason: 'invalid_native_result' };
  } catch { return { result: 'retryable_error', reason: 'native_error' }; }
}
export function startFlexible(infoToken: string): Promise<FlowResult> {
  return token(infoToken) ? flow(() => native!.startFlexible(infoToken)) : Promise.resolve({ result: 'unavailable', reason: 'stale_info' });
}
export function completeFlexible(versionCode: string): Promise<FlowResult> {
  return validVersion(versionCode) ? flow(() => native!.completeFlexible(versionCode)) : Promise.resolve({ result: 'unavailable', reason: 'invalid_version' });
}
export function discard(): void { try { native?.discard(); } catch { /* Invalidating preparation cannot interrupt play. */ } }
export function subscribe(listener: (event: DownloadEvent) => void): () => void {
  if (!isSupported()) return () => {};
  try {
    const subscription = native!.addListener('onDownloadState', (value) => {
      if (!plain(value) || !validVersion(value.versionCode) || !DOWNLOAD_STATES.includes(value.state as DownloadEvent['state'])) return;
      listener({ state: value.state as DownloadEvent['state'], versionCode: value.versionCode,
        ...(typeof value.errorCode === 'number' && Number.isInteger(value.errorCode) && value.errorCode >= 0 && value.errorCode <= 100_000 ? { errorCode: value.errorCode } : {}) });
    });
    return () => { try { subscription.remove(); } catch { /* Exact subscription only. */ } };
  } catch { return () => {}; }
}
export const updatesGateway: UpdatesGateway = { isSupported, getNativeVersionCode, checkAvailability, startFlexible, completeFlexible, discard, subscribe };
