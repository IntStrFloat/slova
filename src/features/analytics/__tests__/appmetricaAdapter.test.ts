/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

function adapter(native: { reportEvent: jest.Mock } | null) {
  jest.resetModules();
  const expo = require('expo') as { requireOptionalNativeModule: jest.Mock };
  expo.requireOptionalNativeModule.mockReturnValue(native);
  return require('@/core/native/appmetrica') as typeof import('@/core/native/appmetrica');
}

describe('AppMetrica local handoff', () => {
  it('confirms only a native call that returned normally', () => {
    const native = { reportEvent: jest.fn() };
    const appmetrica = adapter(native);
    expect(appmetrica.isAppMetricaAvailable()).toBe(true);
    expect(appmetrica.reportEvent('reward_granted', { event_id: 'e_1' })).toBe(true);
    expect(native.reportEvent).toHaveBeenCalledWith('reward_granted', '{"event_id":"e_1"}');
  });

  it('returns failure after a native exception so the outbox can retry', () => {
    const native = { reportEvent: jest.fn(() => { throw new Error('SDK unavailable'); }) };
    const appmetrica = adapter(native);
    expect(appmetrica.reportEvent('reward_granted', { event_id: 'e_1' })).toBe(false);
  });

  it('returns failure when the native module is absent', () => {
    const appmetrica = adapter(null);
    expect(appmetrica.isAppMetricaAvailable()).toBe(false);
    expect(appmetrica.reportEvent('app_open')).toBe(false);
  });
});
