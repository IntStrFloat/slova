/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/core/native/appmetrica', () => ({ getAppMetricaIdentifiers: jest.fn() }));
function fixture() {
  jest.resetModules();
  const native = require('@/core/native/appmetrica') as { getAppMetricaIdentifiers: jest.Mock };
  const api = require('../sdkIdentity') as typeof import('../sdkIdentity');
  const gate = { enabled: true }; api.setSdkIdentityGate(() => gate.enabled);
  return { ...api, native, gate };
}
test('prewarm shares one native request and preserves UInt64 decimal identity without Number conversion', async () => {
  const f = fixture(); let resolve!: (v: object) => void;
  f.native.getAppMetricaIdentifiers.mockReturnValue(new Promise((r) => { resolve = r; }));
  const first = f.primeSdkIdentity(), second = f.primeSdkIdentity(); expect(second).toBe(first);
  expect(f.native.getAppMetricaIdentifiers).toHaveBeenCalledTimes(1);
  resolve({ deviceId: '18446744073709551615', installationId: 'fixture_install' }); await first;
  expect(f.getSdkIdentitySnapshot()).toMatchObject({ status: 'ready', deviceId: '18446744073709551615' });
  await f.primeSdkIdentity(); expect(f.native.getAppMetricaIdentifiers).toHaveBeenCalledTimes(1);
});
test('denial and stale pre-opt-in promise cannot repopulate the new generation', async () => {
  const f = fixture(); let oldResolve!: (v: object) => void;
  f.native.getAppMetricaIdentifiers.mockReturnValueOnce(new Promise((r) => { oldResolve = r; }));
  const old = f.primeSdkIdentity(); f.gate.enabled = false; f.invalidateSdkIdentity(); await f.primeSdkIdentity();
  expect(f.native.getAppMetricaIdentifiers).toHaveBeenCalledTimes(1);
  f.gate.enabled = true; f.native.getAppMetricaIdentifiers.mockResolvedValueOnce({ deviceId: '22', installationId: 'new_install' });
  await f.primeSdkIdentity(); oldResolve({ deviceId: '11', installationId: 'old_install' }); await old;
  expect(f.getSdkIdentitySnapshot()).toMatchObject({ status: 'ready', deviceId: '22', installationId: 'new_install' });
});
test.each([{ deviceId: 18446744073709551615, installationId: 'ok' }, { deviceId: '1e19', installationId: 'ok' },
  { deviceId: '123', installationId: 'email@example.test' }, {}, { deviceId: '123' }])('invalid/missing native identity is unavailable: %j', async (value) => {
  const f = fixture(); f.native.getAppMetricaIdentifiers.mockResolvedValue(value); await f.primeSdkIdentity();
  expect(f.getSdkIdentitySnapshot().status).toBe('unavailable');
});
