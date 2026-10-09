import { AppState } from 'react-native';

import { startFocusedRefresh } from '../foregroundRefresh';

describe('focused foreground refresh', () => {
  it('stops periodic work in background, refreshes immediately on active, and removes its listener on blur', () => {
    jest.useFakeTimers();
    let change!: (state: string) => void;
    const remove = jest.fn();
    const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback: any) => {
      change = callback; return { remove };
    });
    const refresh = jest.fn();
    const stop = startFocusedRefresh(refresh);
    refresh.mockClear();
    change('active');
    expect(refresh).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    change('background');
    jest.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    change('active');
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    listener.mockRestore(); jest.useRealTimers();
  });
});
