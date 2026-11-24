import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { ConfigFetchResult } from '../../src/features/remote-config/coordinator';

interface RemoteConfigModule {
  isAvailable(): boolean;
  status?(): string;
  setAllowed(allowed: boolean): void;
  fetchConfig(): Promise<unknown>;
  fetchHelpExperimentControl?(): Promise<unknown>;
}
export type HelpExperimentControlFetchResult = { status: 'success'; json: string; source: 'actual_sdk_fetch' }
  | { status: 'unavailable' | 'retryable' | 'terminal' | 'cancelled'; reason: string };
const nativeModule = Platform.OS === 'android'
  ? requireOptionalNativeModule<RemoteConfigModule>('RuStoreRemoteConfig') : null;

export function setRemoteConfigAllowed(allowed: boolean): void {
  try { nativeModule?.setAllowed(allowed); } catch { /* old native binary remains control */ }
}
export async function fetchRemotePolicy(): Promise<ConfigFetchResult> {
  try {
    if (!nativeModule?.isAvailable()) return { status: 'unavailable', reason: nativeModule?.status?.() === 'restart_required' ? 'restart_required' : 'missing_capability' };
    const value = await nativeModule.fetchConfig() as Partial<ConfigFetchResult> | null;
    if (value?.status === 'success' && 'json' in value && typeof value.json === 'string' && value.json.length <= 16_384) {
      return { status: 'success', json: value.json };
    }
    const allowed = ['unavailable', 'retryable', 'terminal', 'cancelled'] as const;
    if (value && allowed.some((status) => status === value.status)) {
      const reasons = ['network', 'not_initialized', 'missing_parameter', 'disabled', 'invalid_payload', 'oversized_payload'];
      return { status: value.status as typeof allowed[number],
        reason: 'reason' in value && typeof value.reason === 'string' && reasons.includes(value.reason) ? value.reason : 'unavailable' };
    }
    return { status: 'terminal', reason: 'invalid_payload' };
  } catch { return { status: 'retryable', reason: 'unavailable' }; }
}

/** Optional capability: an older binary cannot authorize the help trial. Never changes shared SDK consent. */
export async function fetchHelpExperimentControl(): Promise<HelpExperimentControlFetchResult> {
  try {
    if (!nativeModule?.fetchHelpExperimentControl || !nativeModule.isAvailable()) {
      return { status: 'unavailable', reason: nativeModule?.status?.() === 'restart_required' ? 'restart_required' : 'missing_capability' };
    }
    const value = await nativeModule.fetchHelpExperimentControl() as Partial<HelpExperimentControlFetchResult> | null;
    if (value?.status === 'success' && value.source === 'actual_sdk_fetch'
      && typeof value.json === 'string' && value.json.length <= 16_384) {
      return { status: 'success', json: value.json, source: 'actual_sdk_fetch' };
    }
    const statuses = ['unavailable', 'retryable', 'terminal', 'cancelled'] as const;
    if (value && statuses.some((status) => status === value.status)) {
      const reasons = ['network', 'not_initialized', 'missing_parameter', 'disabled', 'background', 'invalid_payload', 'oversized_payload'];
      return { status: value.status as typeof statuses[number],
        reason: 'reason' in value && typeof value.reason === 'string' && reasons.includes(value.reason) ? value.reason : 'unavailable' };
    }
    return { status: 'terminal', reason: 'invalid_payload' };
  } catch { return { status: 'retryable', reason: 'unavailable' }; }
}
