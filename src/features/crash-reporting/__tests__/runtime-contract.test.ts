import { installCrashReporting, type CrashGateway, type CrashRuntime } from '../index';

jest.mock('react-native/Libraries/Core/NativeExceptionsManager', () => ({
  __esModule: true,
  default: { reportException: jest.fn() },
}));

type LegacyRuntime = CrashRuntime & {
  ErrorUtils: NonNullable<CrashRuntime['ErrorUtils']> & { reportFatalError(error: unknown): void };
};

test.each([false, undefined])('RN 0.85 JS fatal pipeline captures before native when always-available flag is %s', (flag) => {
  // Execute installed RN JS code, not a hand-written listener payload. The native
  // RN$handleException false boundary mirrors ReactInstance.cpp after runtimeReady.
  const target = globalThis as unknown as Record<string, unknown>;
  const keys = ['__DEV__', 'ErrorUtils', 'HermesInternal', 'RN$useAlwaysAvailableJSErrorHandling',
    'RN$registerExceptionListener', 'RN$handleException', 'RN$hasHandledFatalException',
    'RN$notifyOfFatalException', '__slovaCrashReportingV1', '__fbDisableExceptionsManager'];
  const saved = keys.map((key) => [key, Object.getOwnPropertyDescriptor(target, key)] as const);
  const originalConsoleError = Object.getOwnPropertyDescriptor(console, 'error');
  const originalConsoleReporter = Object.getOwnPropertyDescriptor(console, '_errorOriginal');
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const key of keys) delete target[key];
    Object.assign(target, { __DEV__: false, HermesInternal: {},
      RN$useAlwaysAvailableJSErrorHandling: flag,
      RN$registerExceptionListener: jest.fn(), RN$handleException: jest.fn(() => false),
      RN$hasHandledFatalException: () => false, RN$notifyOfFatalException: jest.fn() });
    jest.isolateModules(() => {
      jest.requireActual('@react-native/js-polyfills/error-guard');
      jest.requireActual('react-native/Libraries/Core/setUpErrorHandling');
      const native = jest.requireMock('react-native/Libraries/Core/NativeExceptionsManager').default;
      const order: string[] = [];
      native.reportException.mockImplementation(() => { order.push('native_fatal'); });
      const gateway: CrashGateway = { capabilities: () => ({ version: 1, enabled: true, localQa: true }),
        report: jest.fn(() => { order.push('local_capture'); return 'qa_local'; }),
        subscribeQa: () => null };
      const runtime = globalThis as unknown as LegacyRuntime;
      const previous = runtime.ErrorUtils.getGlobalHandler();
      const mode = installCrashReporting(runtime, gateway);
      const error = new TypeError('private-receipt=user@example.org');
      error.stack = 'TypeError: private-receipt=user@example.org\n'
        + '    at slovaControlledJsCrash (address at index.android.bundle:1:3026435)\n'
        + '    at anonymous (address at index.android.bundle:1:3842239)';
      runtime.ErrorUtils.reportFatalError(error);

      expect(native.reportException).toHaveBeenCalledTimes(1);
      expect(native.reportException.mock.calls[0][0]).toMatchObject({ isFatal: true,
        name: 'TypeError', stack: [{ file: 'index.android.bundle', lineNumber: 1, column: 3026435 },
          { file: 'index.android.bundle', lineNumber: 1, column: 3842239 }] });
      expect(gateway.report).toHaveBeenCalledTimes(1);
      expect(gateway.report).toHaveBeenCalledWith({ schemaVersion: 1, errorKind: 'TypeError',
        fatal: true, engine: 'hermes', frames: [
          { file: 'index.android.bundle', line: 1, column: 3026435 },
          { file: 'index.android.bundle', line: 1, column: 3842239 }] });
      expect(JSON.stringify((gateway.report as jest.Mock).mock.calls)).not.toMatch(/private-receipt|example\.org|originalMessage|extraData/);
      expect(order).toEqual(['local_capture', 'native_fatal']);
      expect(mode).toBe('error_utils');
      expect(runtime.ErrorUtils.getGlobalHandler()).not.toBe(previous);
      expect(target.RN$registerExceptionListener).not.toHaveBeenCalled();
      expect(target.RN$handleException).toHaveBeenCalledWith(error, true, true);
      expect(target.RN$notifyOfFatalException).toHaveBeenCalledTimes(1);
    });
  } finally {
    consoleError.mockRestore();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    }
    if (originalConsoleError) Object.defineProperty(console, 'error', originalConsoleError);
    if (originalConsoleReporter) Object.defineProperty(console, '_errorOriginal', originalConsoleReporter);
    else delete (console as unknown as Record<string, unknown>)._errorOriginal;
  }
});
