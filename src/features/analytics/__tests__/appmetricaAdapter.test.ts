/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

type NativeMock = {
  reportEvent: jest.Mock;
  isTestDevice?: boolean;
  setDataSendingEnabled?: jest.Mock;
  getDataSendingPreference?: jest.Mock;
  getIdentifiers?: jest.Mock;
  getSoftwareBuildInfo?: jest.Mock;
};

function adapter(native: NativeMock | null) {
  jest.resetModules();
  const expo = require('expo') as { requireOptionalNativeModule: jest.Mock };
  expo.requireOptionalNativeModule.mockReturnValue(native);
  return require('@/core/native/appmetrica') as typeof import('@/core/native/appmetrica');
}

describe('AppMetrica local handoff', () => {
  it('reads software metadata on a keyless QA bridge without enabling SDK collection', () => {
    const native = { reportEvent: jest.fn(), isTestDevice: true,
      setDataSendingEnabled: jest.fn(), getIdentifiers: jest.fn(),
      getSoftwareBuildInfo: jest.fn(() => ({ versionName: '0.1.34', versionCode: '34' })) };
    expect(adapter(native).getSoftwareBuildInfo()).toEqual({ versionName: '0.1.34', versionCode: '34' });
    expect(native.getSoftwareBuildInfo).toHaveBeenCalledTimes(1);
    expect(native.reportEvent).not.toHaveBeenCalled();
    expect(native.setDataSendingEnabled).not.toHaveBeenCalled();
    expect(native.getIdentifiers).not.toHaveBeenCalled();
  });

  it('does not fabricate a native build for absent, old or failing bridges', () => {
    expect(adapter(null).getSoftwareBuildInfo()).toBeNull();
    expect(adapter({ reportEvent: jest.fn() }).getSoftwareBuildInfo()).toBeNull();
    expect(adapter({ reportEvent: jest.fn(), getSoftwareBuildInfo: jest.fn(() => { throw new Error('unavailable'); }) })
      .getSoftwareBuildInfo()).toBeNull();
  });

  it('preserves exact native long version codes and validates software fields independently', () => {
    const native = { reportEvent: jest.fn(), getSoftwareBuildInfo: jest.fn((): unknown => ({
      versionName: '0.1.34', versionCode: '9223372036854775807' })) };
    const api = adapter(native);
    expect(api.getSoftwareBuildInfo()).toEqual({ versionName: '0.1.34', versionCode: '9223372036854775807' });
    native.getSoftwareBuildInfo.mockReturnValue({ versionName: 'invalid name@example.org', versionCode: '34' });
    expect(api.getSoftwareBuildInfo()).toEqual({ versionName: null, versionCode: '34' });
    native.getSoftwareBuildInfo.mockReturnValue({ versionName: '0.1.34', versionCode: 34 });
    expect(api.getSoftwareBuildInfo()).toEqual({ versionName: '0.1.34', versionCode: null });
    for (const code of ['-1', '034', '3e1', '9223372036854775808', '1'.repeat(100)]) {
      native.getSoftwareBuildInfo.mockReturnValue({ versionName: null, versionCode: code });
      expect(api.getSoftwareBuildInfo()).toBeNull();
    }
  });

  it('confirms only an explicit SDK acceptance from a real production bridge', () => {
    const native = { reportEvent: jest.fn(() => true), isTestDevice: false };
    const appmetrica = adapter(native);
    expect(appmetrica.isAppMetricaAvailable()).toBe(true);
    expect(appmetrica.reportEvent('reward_granted', { event_id: 'e_1' })).toBe(true);
    expect(native.reportEvent).toHaveBeenCalledWith('reward_granted', '{"event_id":"e_1"}');
  });

  it('returns failure after a native exception so the outbox can retry', () => {
    const native = { reportEvent: jest.fn(() => { throw new Error('SDK unavailable'); }), isTestDevice: false };
    const appmetrica = adapter(native);
    expect(appmetrica.reportEvent('reward_granted', { event_id: 'e_1' })).toBe(false);
  });

  it('returns failure when the native module is absent', () => {
    const appmetrica = adapter(null);
    expect(appmetrica.isAppMetricaAvailable()).toBe(false);
    expect(appmetrica.reportEvent('app_open')).toBe(false);
  });

  it('admits production funnel telemetry only for an explicitly identified real release device', () => {
    expect(adapter({ reportEvent: jest.fn(), isTestDevice: false }).isAppMetricaTestDevice()).toBe(false);
    expect(adapter({ reportEvent: jest.fn(), isTestDevice: true }).isAppMetricaTestDevice()).toBe(true);
    expect(adapter({ reportEvent: jest.fn() }).isAppMetricaTestDevice()).toBe(true);
    expect(adapter(null).isAppMetricaTestDevice()).toBe(true);
  });

  it('does not interpret the old void bridge or a refused call as a handoff', () => {
    expect(adapter({ reportEvent: jest.fn(), isTestDevice: false }).reportEvent('reward_granted')).toBe(false);
    expect(adapter({ reportEvent: jest.fn(() => false), isTestDevice: false }).reportEvent('reward_granted')).toBe(false);
  });

  it('never forwards production events to a QA or unidentified device', () => {
    for (const isTestDevice of [true, undefined]) {
      const native = { reportEvent: jest.fn(() => true), isTestDevice };
      expect(adapter(native).reportEvent('reward_granted')).toBe(false);
      expect(native.reportEvent).not.toHaveBeenCalled();
    }
  });

  it('persists native policy through the bridge for both opt-out and opt-in', () => {
    const native = { reportEvent: jest.fn(), setDataSendingEnabled: jest.fn(() => true) };
    const appmetrica = adapter(native);
    expect(appmetrica.setDataSendingEnabled(false)).toBe(true);
    expect(appmetrica.setDataSendingEnabled(true)).toBe(true);
    expect(native.setDataSendingEnabled.mock.calls).toEqual([[false], [true]]);
  });

  it('fails closed if the native policy cannot be persisted/applied', () => {
    expect(adapter(null).setDataSendingEnabled(true)).toBe(false);
    expect(adapter({ reportEvent: jest.fn() }).setDataSendingEnabled(true)).toBe(false);
    expect(adapter({ reportEvent: jest.fn(), setDataSendingEnabled: jest.fn(() => false) }).setDataSendingEnabled(false)).toBe(false);
    expect(adapter({ reportEvent: jest.fn(), setDataSendingEnabled: jest.fn(() => { throw new Error('storage'); }) }).setDataSendingEnabled(false)).toBe(false);
  });

  it('distinguishes an explicit native refusal from an unmigrated preference', () => {
    expect(adapter({ reportEvent: jest.fn(), getDataSendingPreference: jest.fn(() => false) }).getDataSendingPreference()).toBe(false);
    expect(adapter({ reportEvent: jest.fn(), getDataSendingPreference: jest.fn(() => true) }).getDataSendingPreference()).toBe(true);
    expect(adapter({ reportEvent: jest.fn(), getDataSendingPreference: jest.fn(() => null) }).getDataSendingPreference()).toBeNull();
    expect(adapter({ reportEvent: jest.fn() }).getDataSendingPreference()).toBeNull();
    expect(adapter(null).getDataSendingPreference()).toBeNull();
    expect(adapter({ reportEvent: jest.fn(), getDataSendingPreference: jest.fn(() => { throw new Error('storage'); }) }).getDataSendingPreference()).toBeNull();
  });

  it('preserves UInt64 SDK identity as a decimal string and installation identity separately', async () => {
    const native = {
      reportEvent: jest.fn(), isTestDevice: false,
      getIdentifiers: jest.fn(async () => ({ deviceId: '18446744073709551615', installationId: 'install-uuid' })),
    };
    expect(await adapter(native).getAppMetricaIdentifiers()).toEqual({
      deviceId: '18446744073709551615', installationId: 'install-uuid',
    });
  });

  it('rejects numeric/coerced or malformed identities instead of rounding or exposing arbitrary text', async () => {
    const native = {
      reportEvent: jest.fn(), isTestDevice: false,
      getIdentifiers: jest.fn(async (): Promise<{ deviceId: unknown; installationId: unknown }> => ({ deviceId: 18446744073709551615, installationId: 'email@example.org' })),
    };
    expect(await adapter(native).getAppMetricaIdentifiers()).toEqual({});
    native.getIdentifiers.mockResolvedValue({ deviceId: '123e+20', installationId: 'bad id' });
    expect(await adapter(native).getAppMetricaIdentifiers()).toEqual({});
  });

  it('does not request identifiers on QA/unknown bridges and tolerates unavailable startup params', async () => {
    const native = { reportEvent: jest.fn(), isTestDevice: true, getIdentifiers: jest.fn() };
    expect(await adapter(native).getAppMetricaIdentifiers()).toEqual({});
    expect(native.getIdentifiers).not.toHaveBeenCalled();
    expect(await adapter(null).getAppMetricaIdentifiers()).toEqual({});
    expect(await adapter({ reportEvent: jest.fn(), isTestDevice: false }).getAppMetricaIdentifiers()).toEqual({});
    expect(await adapter({
      reportEvent: jest.fn(), isTestDevice: false,
      getIdentifiers: jest.fn(async () => { throw new Error('offline'); }),
    }).getAppMetricaIdentifiers()).toEqual({});
  });
});
