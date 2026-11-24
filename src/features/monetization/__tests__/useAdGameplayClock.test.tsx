import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';

import { EMPTY_ADS_META, type AdsState } from '../frequency';
import { loadAdsMeta, saveAdsMeta } from '../index';
import { useAdGameplayClock } from '../useAdGameplayClock';

jest.mock('../index', () => ({ loadAdsMeta: jest.fn(), saveAdsMeta: jest.fn() }));

describe('precise foreground ad gameplay timing', () => {
  let tree: ReactTestRenderer | undefined;
  let flush: () => void;
  let stateListener: (state: AppStateStatus) => void;
  let meta: AdsState;
  let remove: jest.Mock;
  const initialState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  const initialPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const prepare = jest.fn();

  function Clock({ active, attempt = 'attempt-a' }: {
    active: boolean; attempt?: string; revision?: number;
  }) {
    flush = useAdGameplayClock(active, attempt, prepare);
    return null;
  }

  function transition(state: AppStateStatus) {
    Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
    stateListener(state);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    prepare.mockClear();
    jest.setSystemTime(new Date('2026-10-22T09:00:00Z'));
    meta = { ...EMPTY_ADS_META, campaignCompletedIds: [], interstitialShownAt: [] };
    jest.mocked(loadAdsMeta).mockReset().mockImplementation(() => meta);
    jest.mocked(saveAdsMeta).mockReset().mockImplementation((next) => { meta = next as AdsState; });
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      stateListener = listener;
      return { remove };
    });
  });

  afterEach(() => {
    if (tree) act(() => tree!.unmount());
    tree = undefined;
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.useRealTimers();
    if (initialState) Object.defineProperty(AppState, 'currentState', initialState);
    if (initialPerformance) Object.defineProperty(globalThis, 'performance', initialPerformance);
  });

  it('keeps partial seconds through rapid accepted-word rerenders', () => {
    act(() => { tree = create(<Clock active />); });
    for (let revision = 1; revision <= 13; revision++) {
      act(() => {
        jest.advanceTimersByTime(1_000);
        tree!.update(<Clock active revision={revision} />);
      });
    }
    act(() => flush());
    expect(meta.lifetimeVisibleGameplaySec).toBe(13);
    expect(meta.visibleGameplaySinceFullscreenSec).toBe(13);
    expect(saveAdsMeta).toHaveBeenCalledTimes(3);
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('prepares only live checkpoints, never background or unmount cleanup', () => {
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(5_000); });
    expect(prepare).toHaveBeenCalledTimes(1);
    act(() => { transition('background'); jest.advanceTimersByTime(20_000); });
    expect(prepare).toHaveBeenCalledTimes(1);
    act(() => { transition('active'); jest.advanceTimersByTime(5_000); });
    expect(prepare).toHaveBeenCalledTimes(2);
    act(() => { tree!.unmount(); }); tree = undefined;
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('flushes the winning partial interval once, without double counting the next tick', () => {
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(1_250); flush(); flush(); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(1.25);
    act(() => { jest.advanceTimersByTime(3_750); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(5);
    expect(saveAdsMeta).toHaveBeenCalledTimes(2);
  });

  it('excludes a thirty-minute background interval and resumes the same counters', () => {
    meta.visibleGameplaySinceFullscreenSec = 42;
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(1_750); transition('background'); });
    expect(meta.visibleGameplaySinceFullscreenSec).toBe(43.75);
    act(() => { jest.advanceTimersByTime(30 * 60_000); flush(); });
    expect(meta.visibleGameplaySinceFullscreenSec).toBe(43.75);
    act(() => { transition('active'); jest.advanceTimersByTime(1_125); flush(); });
    expect(meta.visibleGameplaySinceFullscreenSec).toBe(44.875);
    expect(meta.lifetimeVisibleGameplaySec).toBe(2.875);
  });

  it('excludes inactive time and does not start while initially backgrounded', () => {
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(10_000); flush(); });
    expect(saveAdsMeta).not.toHaveBeenCalled();
    act(() => { transition('active'); jest.advanceTimersByTime(700); transition('inactive'); });
    act(() => { jest.advanceTimersByTime(9_000); flush(); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(0.7);
  });

  it('saves partial time before a modal opens and excludes its duration', () => {
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(875); });
    act(() => { tree!.update(<Clock active={false} />); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(0.875);
    expect(remove).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(20_000); flush(); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(0.875);
    act(() => { tree!.update(<Clock active />); });
    act(() => { jest.advanceTimersByTime(625); flush(); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(1.5);
  });

  it('flushes both sides of an attempt change and the final unmount interval', () => {
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(600); });
    act(() => { tree!.update(<Clock active attempt="attempt-b" />); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(0.6);
    act(() => { jest.advanceTimersByTime(350); tree!.unmount(); });
    tree = undefined;
    expect(meta.lifetimeVisibleGameplaySec).toBe(0.95);
    expect(remove).toHaveBeenCalledTimes(2);
    act(() => { jest.advanceTimersByTime(10_000); flush(); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(0.95);
  });

  it('uses monotonic time even when the system clock jumps', () => {
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(900); });
    jest.setSystemTime(new Date('2027-10-22T09:00:00Z'));
    act(() => flush());
    expect(meta.lifetimeVisibleGameplaySec).toBe(0.9);
  });

  it('falls back to a nonnegative wall clock without recounting a backwards jump', () => {
    Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true });
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(1_000); flush(); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(1);
    jest.setSystemTime(new Date('2026-10-22T08:59:59Z'));
    act(() => flush());
    jest.setSystemTime(new Date('2026-10-22T09:00:02Z'));
    act(() => flush());
    expect(meta.lifetimeVisibleGameplaySec).toBe(2);
  });

  it('does not let a storage failure block a winning action or replay its time', () => {
    jest.mocked(saveAdsMeta).mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(1_000); });
    expect(() => act(() => flush())).not.toThrow();
    act(() => { jest.advanceTimersByTime(500); flush(); });
    expect(meta.lifetimeVisibleGameplaySec).toBe(0.5);
  });
});
