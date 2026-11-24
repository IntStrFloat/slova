import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';
import { useViewportExposure } from '../viewportExposure';

test('exposure needs one continuous foreground second and cancels on scroll/background/blur', () => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  let onState: (value: string) => void = () => {};
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback: any) => {
    onState = callback; return { remove: jest.fn() };
  });
  let exposure!: ReturnType<typeof useViewportExposure>;
  const seen = jest.fn();
  function Probe() { exposure = useViewportExposure(seen, ['card']); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { tree = TestRenderer.create(<Probe />); });
    act(() => {
      exposure.focus();
      exposure.scrollProps.onLayout({ nativeEvent: { layout: { height: 300 } } } as any);
      exposure.cardLayout('card')({ nativeEvent: { layout: { y: 100, height: 100 } } } as any);
      jest.advanceTimersByTime(500);
      exposure.scrollProps.onScroll({ nativeEvent: { contentOffset: { y: 300 }, layoutMeasurement: { height: 300 } } } as any);
      jest.advanceTimersByTime(1_000);
    });
    expect(seen).not.toHaveBeenCalled();
    act(() => {
      exposure.scrollProps.onScroll({ nativeEvent: { contentOffset: { y: 0 }, layoutMeasurement: { height: 300 } } } as any);
      jest.advanceTimersByTime(500); onState('background'); jest.advanceTimersByTime(1_000);
    });
    expect(seen).not.toHaveBeenCalled();
    act(() => { onState('active'); jest.advanceTimersByTime(999); });
    expect(seen).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(seen).toHaveBeenCalledTimes(1);
    act(() => { exposure.blur(); jest.advanceTimersByTime(1_000); tree.unmount(); });
  } finally { listener.mockRestore(); jest.clearAllTimers(); jest.useRealTimers(); }
});

test('Android window blur cancels dwell without app-state change, and focus preserves background and seen gates', () => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  const callbacks = new Map<string, (...args: any[]) => void>();
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback: any) => {
    callbacks.set(event, callback); return { remove: jest.fn() };
  });
  let exposure!: ReturnType<typeof useViewportExposure>;
  const seen = jest.fn();
  function Probe() { exposure = useViewportExposure(seen, ['card']); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { tree = TestRenderer.create(<Probe />); });
    act(() => { exposure.focus(); exposure.setViewport(0, 300);
      exposure.cardLayout('card')({ nativeEvent: { layout: { y: 100, height: 100 } } } as any); });
    act(() => { jest.advanceTimersByTime(500); callbacks.get('blur')!(); jest.advanceTimersByTime(1_000); });
    expect(seen).not.toHaveBeenCalled();
    act(() => { callbacks.get('focus')!(); jest.advanceTimersByTime(999); });
    expect(seen).not.toHaveBeenCalled();
    act(() => { callbacks.get('change')!('background'); callbacks.get('blur')!(); callbacks.get('focus')!(); jest.advanceTimersByTime(2_000); });
    expect(seen).not.toHaveBeenCalled();
    act(() => { callbacks.get('change')!('active'); jest.advanceTimersByTime(999); });
    expect(seen).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); }); expect(seen).toHaveBeenCalledTimes(1);
    act(() => { callbacks.get('blur')!(); callbacks.get('focus')!(); jest.advanceTimersByTime(1_000); });
    expect(seen).toHaveBeenCalledTimes(1);
    act(() => { tree.unmount(); });
  } finally { listener.mockRestore(); platform.restore(); jest.clearAllTimers(); jest.useRealTimers(); }
});

test('a new hook instance inherits a previously observed Android blur until actual window focus', () => {
  jest.useFakeTimers(); AppState.currentState = 'active';
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  const callbacks = new Map<string, (...args: any[]) => void>();
  const listener = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback: any) => {
    callbacks.set(event, callback); return { remove: jest.fn() };
  });
  let exposure!: ReturnType<typeof useViewportExposure>;
  const seen = jest.fn();
  function Probe() { exposure = useViewportExposure(seen, ['card']); return null; }
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    act(() => { tree = TestRenderer.create(<Probe />); });
    act(() => { callbacks.get('blur')!(); tree.unmount(); });
    act(() => { tree = TestRenderer.create(<Probe />); });
    act(() => { exposure.focus(); exposure.setViewport(0, 300);
      exposure.cardLayout('card')({ nativeEvent: { layout: { y: 100, height: 100 } } } as any);
      jest.advanceTimersByTime(1_000); });
    expect(seen).not.toHaveBeenCalled();
    act(() => { callbacks.get('focus')!(); jest.advanceTimersByTime(999); }); expect(seen).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); }); expect(seen).toHaveBeenCalledTimes(1);
  } finally { act(() => { callbacks.get('focus')?.(); tree.unmount(); }); listener.mockRestore(); platform.restore(); jest.clearAllTimers(); jest.useRealTimers(); }
});
