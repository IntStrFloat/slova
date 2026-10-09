import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';

import { useGameplayClock } from '../useGameplayClock';
import { useGame } from '../store';

describe('foreground gameplay timing', () => {
  let tree: ReactTestRenderer;
  let flush: () => void;
  let stateListener: (state: AppStateStatus) => void;
  let record: jest.SpyInstance;
  function Clock({ active, attempt = 'attempt-a' }: { active: boolean; attempt?: string }) {
    flush = useGameplayClock(active, attempt);
    return null;
  }
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-03T09:00:00Z'));
    record = jest.spyOn(useGame.getState(), 'recordVisibleTime').mockImplementation(() => {});
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      stateListener = listener;
      return { remove: jest.fn() };
    });
  });
  afterEach(() => {
    if (tree) act(() => tree.unmount());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('flushes a partial interval before a winning action', () => {
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(1_250); flush(); });
    expect(record).toHaveBeenLastCalledWith('attempt-a', 1_250);
    act(() => { jest.advanceTimersByTime(3_750); });
    expect(record).toHaveBeenLastCalledWith('attempt-a', 3_750);
  });
  it('excludes background time and starts counting again on foreground', () => {
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(2_000); stateListener('background'); });
    expect(record).toHaveBeenLastCalledWith('attempt-a', 2_000);
    record.mockClear();
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(record).not.toHaveBeenCalled();
    act(() => { stateListener('active'); jest.advanceTimersByTime(5_000); flush(); });
    expect(record.mock.calls.reduce((sum, call) => sum + call[1], 0)).toBe(5_000);
  });
  it('flushes once when a menu stops gameplay and does not count its time', () => {
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(800); });
    act(() => { tree.update(<Clock active={false} />); });
    expect(record).toHaveBeenLastCalledWith('attempt-a', 800);
    record.mockClear();
    act(() => { jest.advanceTimersByTime(20_000); });
    expect(record).not.toHaveBeenCalled();
  });
  it('uses the old attempt for cleanup and new attempt for new gameplay', () => {
    act(() => { tree = create(<Clock active />); });
    act(() => { jest.advanceTimersByTime(600); tree.update(<Clock active attempt="attempt-b" />); });
    expect(record).toHaveBeenCalledWith('attempt-a', 600);
    act(() => { jest.advanceTimersByTime(5_000); });
    expect(record).toHaveBeenLastCalledWith('attempt-b', 5_000);
  });
  it('an optional timing save failure does not block the winning action', () => {
    record.mockImplementation(() => { throw new Error('storage unavailable'); });
    act(() => { tree = create(<Clock active />); jest.advanceTimersByTime(1_000); });
    expect(() => act(() => flush())).not.toThrow();
  });
});
