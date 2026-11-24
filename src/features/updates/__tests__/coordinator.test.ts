/* eslint-disable @typescript-eslint/no-require-imports */
import type { CheckResult, DownloadEvent, FlowResult } from '../../../../modules/rustore-updates/types';
import type { UpdatesDependencies } from '../coordinator';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const available = (state = 'unknown'): CheckResult => ({ result: 'available', versionCode: '35', installedVersionCode: '34', state, infoToken: 'native-1' } as CheckResult);
function fixture(saved: { value: string | null; marker?: string | null } = { value: null }) {
  jest.resetModules();
  let now = 1_800_000_000_000, enabled = true, scope = 'guest', foreground = true, version = '34';
  let listener: (event: DownloadEvent) => void = () => {};
  const gateway = {
    isSupported: jest.fn(() => true), getNativeVersionCode: jest.fn(() => version),
    checkAvailability: jest.fn(async (): Promise<CheckResult> => available()),
    startFlexible: jest.fn(async (): Promise<FlowResult> => ({ result: 'download_accepted', reason: 'accepted' })),
    completeFlexible: jest.fn(async (): Promise<FlowResult> => ({ result: 'flow_ended_unconfirmed', reason: 'flow_returned' })),
    discard: jest.fn(), subscribe: jest.fn((callback: typeof listener) => { listener = callback; return jest.fn(); }),
  };
  const deps: UpdatesDependencies = { gateway, enabled: () => enabled, scope: () => scope, now: () => now,
    foreground: () => foreground, nativeFormBusy: jest.fn(() => false), nativeRewardedBusy: jest.fn(async () => false),
    read: () => saved.value, write: jest.fn((value: string) => { saved.value = value; return true; }),
    readResultMarker: () => saved.marker ?? null, writeResultMarker: jest.fn((value: string) => { saved.marker = value; return true; }), event: jest.fn() };
  const mod = require('../coordinator') as typeof import('../coordinator');
  const coordinator = mod.createUpdatesCoordinator(deps);
  return { coordinator, deps, gateway, saved, mod, fullscreen: require('@/core/fullscreen') as typeof import('@/core/fullscreen'),
    setNow: (value: number) => { now = value; }, now: () => now, setEnabled: (value: boolean) => { enabled = value; },
    setScope: (value: string) => { scope = value; }, setForeground: (value: boolean) => { foreground = value; },
    setVersion: (value: string) => { version = value; }, emit: (event: DownloadEvent) => listener(event) };
}
afterEach(() => { jest.useRealTimers(); });

test('default off and unsupported binary stay dormant without gateway checks or listener', async () => {
  const f = fixture(); f.setEnabled(false); f.coordinator.start(); await f.coordinator.refresh();
  expect(f.gateway.checkAvailability).not.toHaveBeenCalled(); expect(f.gateway.subscribe).not.toHaveBeenCalled();
  expect((await f.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false);
  f.setEnabled(true); f.gateway.isSupported.mockReturnValue(false); await f.coordinator.refresh();
  expect(f.gateway.checkAvailability).not.toHaveBeenCalled();
});
test('single flight and exact TTL expiry retain distinct none/unknown/error results', async () => {
  const f = fixture(); const work = deferred<CheckResult>(); f.gateway.checkAvailability.mockReturnValueOnce(work.promise);
  f.coordinator.start(); const a = f.coordinator.refresh(), b = f.coordinator.refresh();
  expect(f.gateway.checkAvailability).toHaveBeenCalledTimes(1); work.resolve({ result: 'none', reason: 'not_available' }); await Promise.all([a, b]);
  f.setNow(f.now() + f.mod.AVAILABILITY_TTL_MS - 1); await f.coordinator.refresh(); expect(f.gateway.checkAvailability).toHaveBeenCalledTimes(1);
  f.setNow(f.now() + 1); f.gateway.checkAvailability.mockResolvedValueOnce({ result: 'unknown', reason: 'unknown_state' }); await f.coordinator.refresh();
  expect(f.coordinator.getSnapshot().status).toBe('unknown');
  f.gateway.checkAvailability.mockResolvedValueOnce({ result: 'retryable_error', reason: 'network' }); await f.coordinator.refresh(true);
  expect(f.coordinator.getSnapshot().status).toBe('retryable_error');
});
test.each(['0', '33', '34', '35.1', '3.5e1', '9223372036854775808'])('rejects invalid or non-newer target %s', async (versionCode) => {
  const f = fixture(); f.gateway.checkAvailability.mockResolvedValue({ ...available(), versionCode } as CheckResult); f.coordinator.start();
  expect((await f.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false); expect(f.gateway.startFlexible).not.toHaveBeenCalled();
});
test('compares long version strings without rounding and never accepts URL input', () => {
  const f = fixture(); expect(f.mod.isNewerVersion('9007199254740993', '9007199254740992')).toBe(true);
  expect(f.mod.isNewerVersion('https://example.invalid/a.apk', '34')).toBe(false);
});
test.each(['review', 'interstitial', 'rewarded', 'checkout'] as const)('%s lease blocks Updates without releasing foreign owner', async (owner) => {
  const f = fixture(); f.coordinator.start(); const lease = f.fullscreen.tryAcquireFullscreen(owner)!;
  expect((await f.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false); expect(f.gateway.startFlexible).not.toHaveBeenCalled();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe(owner); f.fullscreen.releaseFullscreen(lease);
});
test('a late check cannot launch after safe point or profile changes', async () => {
  const f = fixture(); f.coordinator.start(); await f.coordinator.refresh(); let safe = true;
  const work = deferred<CheckResult>(); f.gateway.checkAvailability.mockReturnValueOnce(work.promise);
  const pending = f.coordinator.request(() => safe, undefined, 'fixture-result'); await Promise.resolve(); safe = false; f.setScope('other'); work.resolve(available());
  expect((await pending).attempted).toBe(false); expect(f.gateway.startFlexible).not.toHaveBeenCalled(); expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});
test('native rewarded orphan and failed native query fail closed', async () => {
  const f = fixture(); f.coordinator.start(); (f.deps.nativeRewardedBusy as jest.Mock).mockRejectedValueOnce(Error('native unavailable'));
  expect((await f.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false); expect(f.gateway.startFlexible).not.toHaveBeenCalled();
  (f.deps.nativeRewardedBusy as jest.Mock).mockResolvedValueOnce(true);
  expect((await f.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false);
});
test('open form retains the exact lease across disable/background/time and duplicate taps', async () => {
  const f = fixture(); f.coordinator.start(); const terminal = deferred<FlowResult>(); f.gateway.startFlexible.mockReturnValueOnce(terminal.promise);
  const pending = f.coordinator.request(() => true, undefined, 'fixture-result'); for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('update'); f.setEnabled(false); f.setForeground(false); f.setNow(f.now() + 9_000_000);
  expect((await f.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false); expect(f.fullscreen.getFullscreenSnapshot().owner).toBe('update');
  terminal.resolve({ result: 'cancelled', reason: 'declined' }); expect((await pending).attempted).toBe(true); expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});
test('cancel cooldown survives restart and expires exactly without touching unrelated state', async () => {
  const f = fixture(); f.coordinator.start(); f.gateway.startFlexible.mockResolvedValueOnce({ result: 'cancelled', reason: 'declined' });
  await f.coordinator.request(() => true, undefined, 'fixture-result'); const stored = f.saved.value; f.coordinator.stop();
  const next = fixture({ value: stored }); next.coordinator.start();
  expect((await next.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false); expect(next.gateway.startFlexible).not.toHaveBeenCalled();
  next.setNow(next.now() + next.mod.OFFER_COOLDOWN_MS); expect((await next.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(true);
});
test('DOWNLOADED during active play never installs; fresh explicit safe action remains unconfirmed', async () => {
  const f = fixture(); f.coordinator.start(); await f.coordinator.refresh();
  f.emit({ state: 'downloaded', versionCode: '35' }); expect(f.gateway.completeFlexible).not.toHaveBeenCalled();
  expect((await f.coordinator.request(() => false, undefined, 'fixture-result')).attempted).toBe(false);
  f.gateway.checkAvailability.mockResolvedValue(available('downloaded')); await f.coordinator.refresh(true);
  const result = await f.coordinator.request(() => true, { versionCode: '35', action: 'install' }, 'fixture-result');
  expect(result.result).toBe('flow_ended_unconfirmed'); expect(f.gateway.completeFlexible).toHaveBeenCalledWith('35');
  expect((f.deps.event as jest.Mock).mock.calls.some(([name]) => name === 'update_version_observed')).toBe(false);
});
test('pending recovery bypasses ordinary TTL and repeated download callbacks emit once per state', async () => {
  const f = fixture(); f.coordinator.start(); await f.coordinator.request(() => true, undefined, 'fixture-result'); const count = f.gateway.checkAvailability.mock.calls.length;
  f.emit({ state: 'downloading', versionCode: '35' }); f.emit({ state: 'downloading', versionCode: '35' });
  await f.coordinator.refresh(); expect(f.gateway.checkAvailability.mock.calls.length).toBeGreaterThan(count);
  const events = (f.deps.event as jest.Mock).mock.calls.filter(([name, props]) => name === 'update_download_state' && props.stage === 'downloading'); expect(events).toHaveLength(1);
});
test('durable reservation failure and corrupt record never permit a form', async () => {
  const f = fixture(); f.coordinator.start(); (f.deps.write as jest.Mock).mockReturnValue(false);
  expect((await f.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false); expect(f.gateway.startFlexible).not.toHaveBeenCalled();
  const corrupt = fixture({ value: '{"version":999}' }); corrupt.coordinator.start();
  expect((await corrupt.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false);
});
test('actual next-launch version observes adoption once with unknown source and no SDK check', () => {
  const f = fixture(); f.setEnabled(false); f.coordinator.start(); f.coordinator.stop();
  const next = fixture(f.saved); next.setEnabled(false); next.setVersion('35'); next.coordinator.start(); next.coordinator.stop(); next.coordinator.start();
  const events = (next.deps.event as jest.Mock).mock.calls.filter(([name]) => name === 'update_version_observed'); expect(events).toHaveLength(1);
  expect(events[0][1]).toMatchObject({ installed_version_code: '35', previous_version_code: '34', source: 'unknown' }); expect(next.gateway.checkAvailability).not.toHaveBeenCalled();
});
test('native version change invalidates an otherwise fresh availability cache', async () => {
  const f = fixture(); f.coordinator.start(); await f.coordinator.refresh(); f.setVersion('35');
  f.gateway.checkAvailability.mockResolvedValueOnce({ result: 'none', reason: 'not_available' });
  await f.coordinator.refresh(); expect(f.gateway.checkAvailability).toHaveBeenCalledTimes(2); expect(f.coordinator.getSnapshot().status).toBe('none');
});
test('a missing native rewarded callback times out preparation and releases only its own lease', async () => {
  jest.useFakeTimers(); const f = fixture(); f.coordinator.start();
  (f.deps.nativeRewardedBusy as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
  const pending = f.coordinator.request(() => true, undefined, 'fixture-result'); await jest.advanceTimersByTimeAsync(1000);
  expect((await pending).attempted).toBe(false); expect(f.gateway.startFlexible).not.toHaveBeenCalled(); expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});
test('query timeout contains a late callback and keeps free gameplay ownership available', async () => {
  jest.useFakeTimers(); const f = fixture(); const query = deferred<CheckResult>(); f.gateway.checkAvailability.mockReturnValueOnce(query.promise); f.coordinator.start();
  const pending = f.coordinator.request(() => true, undefined, 'fixture-result'); await jest.advanceTimersByTimeAsync(4000);
  expect((await pending).attempted).toBe(false); const snapshot = f.coordinator.getSnapshot();
  query.resolve(available()); await jest.advanceTimersByTimeAsync(0); expect(f.coordinator.getSnapshot()).toBe(snapshot);
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});
test('download ready arriving before offer callback remains ready after download acceptance', async () => {
  const f = fixture(); const terminal = deferred<FlowResult>(); f.gateway.startFlexible.mockReturnValueOnce(terminal.promise); f.coordinator.start();
  const pending = f.coordinator.request(() => true, undefined, 'fixture-result'); for (let i = 0; i < 8; i++) await Promise.resolve();
  f.emit({ versionCode: '35', state: 'downloaded' }); terminal.resolve({ result: 'download_accepted', reason: 'accepted' }); await pending;
  expect(f.coordinator.getSnapshot().status).toBe('downloaded'); expect(f.gateway.completeFlexible).not.toHaveBeenCalled();
});
test('the reservation is durably pending before an unresolved native UI callback, and restart recovery bypasses TTL', async () => {
  const f = fixture(), terminal = deferred<FlowResult>(); f.gateway.startFlexible.mockReturnValueOnce(terminal.promise); f.coordinator.start();
  const action = f.coordinator.request(() => true, undefined, 'fixture-result'); for (let i = 0; i < 12; i++) await Promise.resolve();
  const saved = JSON.parse(f.saved.value!); expect(saved).toMatchObject({ pending: true, targetVersion: '35', attemptNo: 1 });
  f.coordinator.stop(); const next = fixture({ value: f.saved.value }); next.coordinator.start();
  next.gateway.checkAvailability.mockResolvedValueOnce(available('downloading')); await next.coordinator.refresh();
  next.gateway.checkAvailability.mockResolvedValueOnce(available('downloaded')); await next.coordinator.refresh();
  expect(next.gateway.checkAvailability).toHaveBeenCalledTimes(2); expect(next.coordinator.getSnapshot().status).toBe('downloaded');
  terminal.resolve({ result: 'cancelled', reason: 'declined' }); await action; next.coordinator.stop();
});
test('a displayed downloaded target cannot authorize completing a different freshly queried target', async () => {
  const f = fixture(); f.gateway.checkAvailability.mockResolvedValueOnce(available('downloaded')); f.coordinator.start(); await f.coordinator.refresh();
  f.gateway.checkAvailability.mockResolvedValueOnce({ ...available('downloaded'), versionCode: '36' } as CheckResult);
  expect((await f.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false); expect(f.gateway.completeFlexible).not.toHaveBeenCalled();
  expect(f.coordinator.getSnapshot().versionCode).toBe('36');
  f.gateway.checkAvailability.mockResolvedValue({ ...available('downloaded'), versionCode: '36' } as CheckResult);
  expect((await f.coordinator.request(() => true, { versionCode: '36', action: 'install' }, 'fixture-result')).attempted).toBe(true);
  expect(f.gateway.completeFlexible).toHaveBeenCalledTimes(1); expect(f.gateway.completeFlexible).toHaveBeenCalledWith('36');
});
test('a first fresh downloaded snapshot only prepares the install action, requiring a new explicit target-bound tap', async () => {
  const f = fixture(); f.gateway.checkAvailability.mockResolvedValue(available('downloaded')); f.coordinator.start();
  expect((await f.coordinator.request(() => true, undefined, 'fixture-result')).attempted).toBe(false); expect(f.gateway.completeFlexible).not.toHaveBeenCalled();
  expect((await f.coordinator.request(() => true, { versionCode: '35', action: 'install' }, 'fixture-result')).result).toBe('flow_ended_unconfirmed');
  expect(f.gateway.completeFlexible).toHaveBeenCalledTimes(1);
});
test('the rendered intent also refuses a fresh offer-to-install change for the same target', async () => {
  const f = fixture(); f.coordinator.start(); await f.coordinator.refresh();
  f.gateway.checkAvailability.mockResolvedValueOnce(available('downloaded'));
  const result = await f.coordinator.request(() => true, { versionCode: '35', action: 'offer' }, 'fixture-result');
  expect(result.attempted).toBe(false); expect(f.gateway.completeFlexible).not.toHaveBeenCalled();
});
test.each(['failed', 'interrupted'] as const)('newer observed %s survives a late offer callback and supports a later explicit retry', async (state) => {
  const f = fixture(), terminal = deferred<FlowResult>(); f.gateway.startFlexible.mockReturnValueOnce(terminal.promise); f.coordinator.start();
  const action = f.coordinator.request(() => true, undefined, 'fixture-result'); for (let i = 0; i < 12; i++) await Promise.resolve();
  f.emit({ versionCode: '35', state, errorCode: state === 'failed' ? 4006 : 4016 }); terminal.resolve({ result: 'download_accepted', reason: 'accepted' }); await action;
  expect(f.coordinator.getSnapshot().status).toBe(state);
  f.setNow(f.now() + f.mod.OFFER_COOLDOWN_MS); f.gateway.checkAvailability.mockResolvedValueOnce(available(state)); await f.coordinator.refresh(true);
  expect(f.coordinator.getSnapshot().canAct).toBe(true);
});
test('completion Unit forces a post-terminal status query when focus already returned, and never installs from that query', async () => {
  const f = fixture(); f.gateway.checkAvailability.mockResolvedValue(available('downloaded')); f.coordinator.start(); await f.coordinator.refresh();
  const count = f.gateway.checkAvailability.mock.calls.length; const result = await f.coordinator.request(() => true, undefined, 'fixture-result');
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(result.result).toBe('flow_ended_unconfirmed'); expect(f.gateway.checkAvailability.mock.calls.length).toBe(count + 2);
  expect(f.gateway.completeFlexible).toHaveBeenCalledTimes(1); expect(f.coordinator.getSnapshot().busy).toBe(false);
  expect(f.coordinator.getSnapshot().canAct).toBe(false);
});
test('stop/start keeps an old open form owned but publishes its exact terminal busy cleanup to the surviving UI', async () => {
  const f = fixture(), terminal = deferred<FlowResult>(); f.gateway.startFlexible.mockReturnValueOnce(terminal.promise); f.coordinator.start();
  const action = f.coordinator.request(() => true, undefined, 'fixture-result'); for (let i = 0; i < 12; i++) await Promise.resolve();
  f.coordinator.stop(); f.coordinator.start(); expect(f.coordinator.getSnapshot().busy).toBe(true);
  const discards = f.gateway.discard.mock.calls.length;
  terminal.resolve({ result: 'cancelled', reason: 'declined' }); await action;
  expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull(); expect(f.coordinator.getSnapshot().busy).toBe(false);
  expect(f.gateway.discard).toHaveBeenCalledTimes(discards);
});
test('an old availability timeout settles its caller without discarding a newer lifecycle query', async () => {
  jest.useFakeTimers(); const f = fixture(), old = deferred<CheckResult>(), next = deferred<CheckResult>();
  f.gateway.checkAvailability.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise); f.coordinator.start();
  const previous = f.coordinator.refresh(); await jest.advanceTimersByTimeAsync(1000);
  f.coordinator.stop(); f.coordinator.start(); const current = f.coordinator.refresh(); const discards = f.gateway.discard.mock.calls.length;
  await jest.advanceTimersByTimeAsync(3000); expect(f.gateway.discard).toHaveBeenCalledTimes(discards);
  next.resolve(available()); await current; expect((await previous).result).toBe('unavailable');
  expect(f.coordinator.getSnapshot().status).toBe('available');
});
test('a timed-out query still invalidates its exact native request after profile change, while rejecting its result', async () => {
  jest.useFakeTimers(); const f = fixture(), query = deferred<CheckResult>(); f.gateway.checkAvailability.mockReturnValueOnce(query.promise);
  f.coordinator.start(); const pending = f.coordinator.refresh(); f.setScope('replacement-profile');
  await jest.advanceTimersByTimeAsync(4000); expect(f.gateway.discard).toHaveBeenCalledTimes(1);
  expect((await pending).result).toBe('unavailable'); expect(f.coordinator.getSnapshot().status).toBe('idle');
});
test('actual UI reservation persists only its exact result/profile marker across restart, OFF and native adoption', async () => {
  const f = fixture(); f.coordinator.start();
  await f.coordinator.request(() => true, { versionCode: '35', action: 'offer' }, 'saved-result-1');
  expect(f.coordinator.hasResultAttempt('saved-result-1')).toBe(true); expect(f.coordinator.hasResultAttempt('saved-result-2')).toBe(false);
  f.setScope('other-profile'); expect(f.coordinator.hasResultAttempt('saved-result-1')).toBe(false);
  f.setScope('guest'); f.coordinator.stop(); const next = fixture(f.saved); next.setEnabled(false); next.coordinator.start();
  expect(next.coordinator.hasResultAttempt('saved-result-1')).toBe(true);
  next.coordinator.stop(); next.setVersion('35'); next.coordinator.start(); expect(next.coordinator.hasResultAttempt('saved-result-1')).toBe(true);
  expect(JSON.stringify(f.saved.marker)).not.toMatch(/guest|other-profile/);
});
test('manual result marker can be durable on an older binary with unknown native version, without inventing a version', () => {
  const f = fixture(); f.gateway.isSupported.mockReturnValue(false); (f.gateway.getNativeVersionCode as jest.Mock).mockReturnValue(null); f.coordinator.start();
  expect(f.coordinator.markResultAttempt('manual-result-1')).toBe(true); expect(f.coordinator.hasResultAttempt('manual-result-1')).toBe(true);
  expect(f.saved.value).toBeNull(); expect(f.saved.marker).toContain('manual-result-1');
  f.coordinator.stop(); f.coordinator.start(); expect(f.coordinator.hasResultAttempt('manual-result-1')).toBe(true);
});
test.each(['write_failed', 'readback_mismatch'] as const)('result marker %s prevents native UI and releases its reservation', async (failure) => {
  const f = fixture(); f.coordinator.start();
  if (failure === 'write_failed') (f.deps.writeResultMarker as jest.Mock).mockReturnValue(false);
  else f.deps.readResultMarker = () => null;
  expect((await f.coordinator.request(() => true, undefined, 'blocked-result')).attempted).toBe(false);
  expect(f.gateway.startFlexible).not.toHaveBeenCalled(); expect(f.fullscreen.getFullscreenSnapshot().owner).toBeNull();
});
