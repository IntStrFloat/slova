/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
const payload = { schemaVersion: 1 as const, errorKind: 'Error', fatal: true, engine: 'hermes' as const, frames: [] };
function adapter(native: unknown) {
  jest.resetModules();
  require('expo').requireOptionalNativeModule.mockReturnValue(native);
  return require('@/core/native/appmetrica') as typeof import('@/core/native/appmetrica');
}
test('old binary and unknown bridge are unavailable without changing existing analytics', () => {
  expect(adapter(null).reportJsError(payload)).toBe('unavailable');
  expect(adapter({ reportEvent: jest.fn() }).getCrashReportingCapabilities()).toBeNull();
});
test('a QA bridge can return only a local result and cannot acknowledge production SDK reporting', () => {
  const native = { isTestDevice: true, getCrashReportingCapabilities: () => ({ version: 1, enabled: true, localQa: true }),
    reportJsError: jest.fn(() => 'qa_local') };
  const api = adapter(native);
  expect(api.reportJsError(payload)).toBe('qa_local');
  native.reportJsError.mockReturnValue('sdk_error_handoff');
  expect(api.reportJsError(payload)).toBe('invalid');
});
test('production accepts only an explicit native SDK error handoff and keeps test exclusion', () => {
  const native = { isTestDevice: false, getCrashReportingCapabilities: () => ({ version: 1, enabled: true, localQa: false }),
    reportJsError: jest.fn(() => 'sdk_error_handoff') };
  const api = adapter(native);
  expect(api.reportJsError(payload)).toBe('sdk_error_handoff');
  native.isTestDevice = true;
  expect(api.reportJsError(payload)).toBe('disabled');
  expect(native.reportJsError).toHaveBeenCalledTimes(1);
});
