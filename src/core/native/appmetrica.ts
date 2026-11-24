import { requireOptionalNativeModule } from 'expo';
import type { SafeJsError } from '@/features/crash-reporting/policy';

/**
 * Тонкий обёрточный слой над нативным модулем `modules/appmetrica` (Expo Modules API).
 * На web / Expo Go / в jest нативный модуль отсутствует.
 * Возвращаем статус локальной передачи SDK, чтобы очередь могла повторить сбой.
 */
interface AppMetricaNativeModule {
  readonly isTestDevice?: boolean;
  reportEvent(name: string, jsonValue?: string): boolean;
  setDataSendingEnabled?(enabled: boolean): boolean;
  getDataSendingPreference?(): boolean | null;
  getIdentifiers?(): Promise<{ deviceId?: unknown; installationId?: unknown }>;
  getSoftwareBuildInfo?(): unknown;
  getCrashReportingCapabilities?(): unknown;
  reportJsError?(payload: SafeJsError): unknown;
  canRunCrashQa?(): boolean;
  addListener?(eventName: 'onCrashQaRequested', listener: (event: { runId?: unknown }) => void): { remove(): void };
}

export type CrashCapabilities = { version: 1; enabled: boolean; localQa: boolean };
export type CrashReportResult = 'sdk_error_handoff' | 'qa_local' | 'disabled' | 'invalid' | 'unavailable';
export type SoftwareBuildInfo = { versionName: string | null; versionCode: string | null };

/** Pure installed-package metadata. Missing older capability stays unknown, never guessed from JS. */
export function getSoftwareBuildInfo(): SoftwareBuildInfo | null {
  try {
    const value = getNative()?.getSoftwareBuildInfo?.() as Partial<SoftwareBuildInfo> | undefined;
    const versionName = typeof value?.versionName === 'string'
      && /^[a-z0-9][a-z0-9_.:-]{0,191}$/i.test(value.versionName) ? value.versionName : null;
    const code = value?.versionCode;
    const versionCode = typeof code === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(code)
      && (code.length < 19 || code <= '9223372036854775807') ? code : null;
    return versionName !== null || versionCode !== null ? { versionName, versionCode } : null;
  } catch { return null; }
}

export function getCrashReportingCapabilities(): CrashCapabilities | null {
  try {
    const native = getNative();
    const value = native?.getCrashReportingCapabilities?.() as Partial<CrashCapabilities> | undefined;
    return value?.version === 1 && typeof value.enabled === 'boolean' && typeof value.localQa === 'boolean'
      && typeof native?.reportJsError === 'function'
      ? { version: 1, enabled: value.enabled, localQa: value.localQa } : null;
  } catch { return null; }
}

/** Native owns consent and validates the DTO again. A handoff is not a server receipt. */
export function reportJsError(payload: SafeJsError): CrashReportResult {
  try {
    const native = getNative();
    const capabilities = getCrashReportingCapabilities();
    if (!capabilities || !native?.reportJsError) return 'unavailable';
    if (!capabilities.enabled) return 'disabled';
    if (!capabilities.localQa && native.isTestDevice !== false) return 'disabled';
    const result = native.reportJsError(payload);
    if (result === 'qa_local') return capabilities.localQa ? result : 'invalid';
    if (result === 'sdk_error_handoff') return !capabilities.localQa && native.isTestDevice === false ? result : 'invalid';
    return result === 'disabled' || result === 'invalid' ? result : 'unavailable';
  } catch { return 'unavailable'; }
}

export function subscribeCrashQaRequests(listener: (runId: string) => void): { remove(): void } | null {
  try {
    const native = getNative();
    if (!getCrashReportingCapabilities()?.localQa || !native?.addListener) return null;
    return native.addListener('onCrashQaRequested', (event) => {
      if (typeof event?.runId === 'string' && /^[a-z0-9_-]{1,48}$/.test(event.runId)) listener(event.runId);
    });
  } catch { return null; }
}

export function canRunCrashQa(): boolean {
  try { return getCrashReportingCapabilities()?.localQa === true && getNative()?.canRunCrashQa?.() === true; }
  catch { return false; }
}

let cached: AppMetricaNativeModule | null | undefined;

function getNative(): AppMetricaNativeModule | null {
  if (cached === undefined) {
    try {
      cached = requireOptionalNativeModule<AppMetricaNativeModule>('Appmetrica');
    } catch {
      cached = null;
    }
  }
  return cached;
}

/** Доступен ли нативный AppMetrica-модуль (false на web/Expo Go/jest). */
export function isAppMetricaAvailable(): boolean {
  return getNative() != null;
}

/** Unknown/older bridges are excluded until the native build can identify a real production device. */
export function isAppMetricaTestDevice(): boolean {
  return getNative()?.isTestDevice !== false;
}

/** Persist/apply native consent before any enqueue or flush; false is fail-closed. */
export function setDataSendingEnabled(enabled: boolean): boolean {
  const native = getNative();
  if (!native?.setDataSendingEnabled) return false;
  try {
    return native.setDataSendingEnabled(enabled) === true;
  } catch {
    return false;
  }
}

/** A persisted native refusal takes precedence over a failed/older JS preference write. */
export function getDataSendingPreference(): boolean | null {
  try {
    const value = getNative()?.getDataSendingPreference?.();
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

/** IDs stay strings: UInt64 device IDs must never pass through a JS Number. */
export async function getAppMetricaIdentifiers(): Promise<{ deviceId?: string; installationId?: string }> {
  const native = getNative();
  if (!native?.getIdentifiers || native.isTestDevice !== false) return {};
  try {
    const result = await native.getIdentifiers();
    const identifiers: { deviceId?: string; installationId?: string } = {};
    if (typeof result?.deviceId === 'string' && /^[0-9]{1,20}$/.test(result.deviceId)) {
      identifiers.deviceId = result.deviceId;
    }
    if (typeof result?.installationId === 'string' && /^[a-zA-Z0-9_.:-]{1,96}$/.test(result.installationId)) {
      identifiers.installationId = result.installationId;
    }
    return identifiers;
  } catch {
    return {};
  }
}

/** True is explicit local SDK acceptance, not server delivery or a legacy void return. */
export function reportEvent(name: string, props?: Record<string, unknown>): boolean {
  const native = getNative();
  if (!native || native.isTestDevice !== false) return false;
  try {
    const json =
      props && Object.keys(props).length > 0 ? JSON.stringify(props) : undefined;
    return native.reportEvent(name, json) === true;
  } catch {
    return false;
  }
}
