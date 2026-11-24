import { getCrashReportingCapabilities, reportJsError, subscribeCrashQaRequests,
  canRunCrashQa,
  type CrashCapabilities, type CrashReportResult } from '@/core/native/appmetrica';
import { sanitizeJsError, type SafeJsError } from './policy';

export interface CrashRuntime {
  RN$useAlwaysAvailableJSErrorHandling?: boolean;
  RN$registerExceptionListener?: (listener: (data: unknown) => void) => void;
  HermesInternal?: unknown;
  ErrorUtils?: { getGlobalHandler(): (error: unknown, fatal: boolean) => void;
    setGlobalHandler(handler: (error: unknown, fatal: boolean) => void): void };
  setTimeout?: (callback: () => void, delay: number) => unknown;
  __slovaCrashReportingV1?: 'rn_listener' | 'error_utils';
}
export interface CrashGateway {
  capabilities(): CrashCapabilities | null;
  report(payload: SafeJsError): CrashReportResult;
  subscribeQa(listener: (runId: string) => void): { remove(): void } | null;
  qaAllowed?(): boolean;
}
const nativeGateway: CrashGateway = { capabilities: getCrashReportingCapabilities,
  report: reportJsError, subscribeQa: subscribeCrashQaRequests,
  qaAllowed: canRunCrashQa };

/** Named only for an explicit, native-guarded local QA request; never called on startup. */
export function slovaControlledJsCrash(): never { throw new Error('slova_controlled_js_crash'); }

/** One observer per runtime. It never prevents RN's original fatal handling. */
export function installCrashReporting(runtime: CrashRuntime = globalThis as CrashRuntime,
  gateway: CrashGateway = nativeGateway): 'rn_listener' | 'error_utils' | 'disabled' | 'unavailable' {
  if (runtime.__slovaCrashReportingV1) return runtime.__slovaCrashReportingV1;
  let capabilities: CrashCapabilities | null;
  try { capabilities = gateway.capabilities(); } catch { return 'unavailable'; }
  if (!capabilities) return 'unavailable';
  if (!capabilities.enabled) return 'disabled';
  // RN's C++ callback IDs increase synchronously in this runtime. A watermark
  // prevents old refused callbacks returning after a finite dedup cache fills.
  let lastNativeId = -1;
  const objects = new WeakSet<object>();
  const capture = (input: unknown, fatal = false, nativeCallback = false) => {
    try {
      const data = input !== null && typeof input === 'object' ? input as Record<string, unknown> : null;
      const id = data?.id;
      if (nativeCallback && typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) {
        if (id <= lastNativeId) return;
        lastNativeId = id;
      } else if (data) {
        if (objects.has(data)) return;
        objects.add(data);
      }
      // Mark attempted callbacks too: refusal/failed handoff must not replay after later opt-in.
      gateway.report(sanitizeJsError(input, fatal, runtime.HermesInternal ? 'hermes' : 'unknown'));
    } catch { /* Reporting failure must never replace the original exception or recurse. */ }
  };
  let kind: 'rn_listener' | 'error_utils';
  try {
    // RN 0.85 exposes the listener even when its C++ pipeline is disabled.
    // After runtimeReady that mode uses ExceptionsManager/ErrorUtils instead.
    if (runtime.RN$useAlwaysAvailableJSErrorHandling === true &&
      typeof runtime.RN$registerExceptionListener === 'function') {
      runtime.RN$registerExceptionListener((data) => capture(data, false, true));
      kind = 'rn_listener';
    } else if (runtime.ErrorUtils) {
      const previous = runtime.ErrorUtils.getGlobalHandler();
      if (typeof previous !== 'function') return 'unavailable';
      runtime.ErrorUtils.setGlobalHandler((error, fatal) => {
        try { capture(error, fatal); } finally { previous(error, fatal); }
      });
      kind = 'error_utils';
    } else return 'unavailable';
    runtime.__slovaCrashReportingV1 = kind;
  } catch { return 'unavailable'; }
  if (capabilities.localQa) {
    const qaRuns = new Set<string>();
    try {
      gateway.subscribeQa((runId) => {
        if (!/^[a-z0-9_-]{1,48}$/.test(runId) || qaRuns.has(runId)) return;
        qaRuns.add(runId);
        if (qaRuns.size > 32) qaRuns.delete(qaRuns.values().next().value!);
        (runtime.setTimeout ?? setTimeout)(() => {
          let allowed = false;
          try { allowed = gateway.qaAllowed?.() === true; } catch { /* Unknown gate fails closed. */ }
          if (allowed) slovaControlledJsCrash();
        }, 50);
      });
    } catch { /* QA request transport never changes the production error route. */ }
  }
  return kind;
}
