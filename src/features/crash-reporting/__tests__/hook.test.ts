import { installCrashReporting, type CrashRuntime, type CrashGateway } from '../index';

function gateway(qa = false): CrashGateway {
  return { capabilities: () => ({ version: 1, enabled: true, localQa: qa }),
    report: jest.fn(() => 'sdk_error_handoff'), subscribeQa: jest.fn(() => ({ remove() {} })) };
}

test('uses the actual C++ exception listener once and preserves default fatal handling', () => {
  let listener!: (data: unknown) => void;
  const previous = jest.fn();
  const runtime: CrashRuntime = { RN$useAlwaysAvailableJSErrorHandling: true,
    RN$registerExceptionListener: jest.fn((fn) => { listener = fn; }),
    ErrorUtils: { getGlobalHandler: () => previous, setGlobalHandler: jest.fn() } };
  const api = gateway();
  expect(installCrashReporting(runtime, api)).toBe('rn_listener');
  expect(installCrashReporting(runtime, api)).toBe('rn_listener');
  const preventDefault = jest.fn();
  const data = { id: 4, isFatal: true, message: 'secret', stack: [], preventDefault };
  listener(data); listener(data);
  expect(api.report).toHaveBeenCalledTimes(1);
  expect(preventDefault).not.toHaveBeenCalled();
  expect(runtime.ErrorUtils!.setGlobalHandler).not.toHaveBeenCalled();
  expect(runtime.RN$registerExceptionListener).toHaveBeenCalledTimes(1);
  expect(api.subscribeQa).not.toHaveBeenCalled();
});

test('legacy fallback always calls the original handler once even when reporting throws', () => {
  let handler!: (error: unknown, fatal: boolean) => void;
  const error = new Error('secret');
  const previous = jest.fn(() => { throw error; });
  const runtime: CrashRuntime = { ErrorUtils: { getGlobalHandler: () => previous,
    setGlobalHandler: (fn) => { handler = fn; } } };
  const api = gateway();
  (api.report as jest.Mock).mockImplementation(() => { throw new Error('report failure'); });
  expect(installCrashReporting(runtime, api)).toBe('error_utils');
  expect(() => handler(error, true)).toThrow(error);
  expect(previous).toHaveBeenCalledTimes(1);
  expect(previous).toHaveBeenCalledWith(error, true);
});

test('never installs a hook for old or disabled binaries and does not invent capabilities', () => {
  const runtime: CrashRuntime = { RN$registerExceptionListener: jest.fn() };
  const api = gateway();
  api.capabilities = () => null;
  expect(installCrashReporting(runtime, api)).toBe('unavailable');
  api.capabilities = () => ({ version: 1, enabled: false, localQa: false });
  expect(installCrashReporting(runtime, api)).toBe('disabled');
  expect(runtime.RN$registerExceptionListener).not.toHaveBeenCalled();
});

test('a failed/disabled handoff cannot replay an old callback after consent changes', () => {
  let listener!: (data: unknown) => void;
  const runtime: CrashRuntime = { RN$useAlwaysAvailableJSErrorHandling: true,
    RN$registerExceptionListener: (fn) => { listener = fn; } };
  const api = gateway();
  (api.report as jest.Mock).mockReturnValueOnce('disabled').mockReturnValue('sdk_error_handoff');
  installCrashReporting(runtime, api);
  listener({ id: 8, isFatal: false }); listener({ id: 8, isFatal: false });
  expect(api.report).toHaveBeenCalledTimes(1);
});

test('an old native callback cannot return after the bounded observation window', () => {
  let listener!: (data: unknown) => void;
  const api = gateway();
  installCrashReporting({ RN$useAlwaysAvailableJSErrorHandling: true,
    RN$registerExceptionListener: (fn) => { listener = fn; } }, api);
  for (let id = 0; id < 150; id++) listener({ id, isFatal: false });
  listener({ id: 0, isFatal: false });
  expect(api.report).toHaveBeenCalledTimes(150);
});

test('legacy errors with unrelated application id fields are not merged', () => {
  let handler!: (error: unknown, fatal: boolean) => void;
  const api = gateway();
  installCrashReporting({ ErrorUtils: { getGlobalHandler: () => () => {}, setGlobalHandler: (fn) => { handler = fn; } } }, api);
  handler(Object.assign(new Error('first'), { id: 42 }), false);
  handler(Object.assign(new Error('second'), { id: 42 }), false);
  expect(api.report).toHaveBeenCalledTimes(2);
});

test('QA crash is explicit, scoped and scheduled; observer installation cannot crash by itself', () => {
  let request!: (runId: string) => void;
  const runtime: CrashRuntime = { RN$useAlwaysAvailableJSErrorHandling: true,
    RN$registerExceptionListener: jest.fn(), setTimeout: jest.fn() };
  const api = gateway(true);
  (api.subscribeQa as jest.Mock).mockImplementation((fn) => { request = fn; return { remove() {} }; });
  installCrashReporting(runtime, api);
  expect(runtime.setTimeout).not.toHaveBeenCalled();
  request('bad id');
  expect(runtime.setTimeout).not.toHaveBeenCalled();
  request('local-run-1'); request('local-run-1');
  expect(runtime.setTimeout).toHaveBeenCalledTimes(1);
});

test('refusal before the explicit QA timer runs cancels the pending crash', () => {
  let request!: (runId: string) => void;
  let scheduled!: () => void;
  const api = gateway(true);
  api.qaAllowed = () => false;
  (api.subscribeQa as jest.Mock).mockImplementation((fn) => { request = fn; return null; });
  installCrashReporting({ RN$useAlwaysAvailableJSErrorHandling: true,
    RN$registerExceptionListener: () => {}, setTimeout: (fn) => { scheduled = fn; } }, api);
  request('revoked-run');
  expect(() => scheduled()).not.toThrow();
});
