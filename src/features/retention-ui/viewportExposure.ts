import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

type Bounds = { y: number; height: number };

/** A card counts when half of it (or 80 dp for a tall card) is visible. */
export function isExposed(bounds: Bounds, offset: number, viewportHeight: number): boolean {
  if (bounds.height <= 0 || viewportHeight <= 0) return false;
  const visible = Math.max(0, Math.min(bounds.y + bounds.height, offset + viewportHeight) - Math.max(bounds.y, offset));
  return visible >= Math.min(bounds.height / 2, 80);
}

/** Layouts are content coordinates. Call focus/blur from the screen's focus effect. */
export function useViewportExposure(onExposure: (id: string) => void, activeIds?: readonly string[], version = '') {
  const state = useRef({ focused: false, foreground: AppState.currentState === 'active' || AppState.currentState === null, version, offset: 0, height: 0, bounds: new Map<string, Bounds>(), seen: new Set<string>(), active: activeIds ? new Set(activeIds) : null });
  const callback = useRef(onExposure);
  const check = useCallback(() => {
    const current = state.current;
    if (!current.focused || !current.foreground) return;
    for (const [id, bounds] of current.bounds) {
      if (!current.seen.has(id) && isExposed(bounds, current.offset, current.height)) {
        current.seen.add(id);
        callback.current(id);
      }
    }
  }, []);
  useLayoutEffect(() => {
    callback.current = onExposure;
    const current = state.current;
    if (current.version !== version) { current.version = version; current.seen.clear(); }
    current.active = activeIds ? new Set(activeIds) : null;
    for (const id of current.bounds.keys()) {
      if (current.active && !current.active.has(id)) { current.bounds.delete(id); current.seen.delete(id); }
    }
    check();
  }, [onExposure, activeIds, version, check]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => { state.current.foreground = next === 'active'; });
    return () => subscription.remove();
  }, []);
  // Let the focus refresh commit today's state before reusing last visit's measured layouts.
  const focus = useCallback(() => { state.current.focused = true; state.current.seen.clear(); setTimeout(check, 0); }, [check]);
  const blur = useCallback(() => { state.current.focused = false; }, []);
  const cardLayout = useCallback((id: string) => (event: LayoutChangeEvent) => {
    if (state.current.active && !state.current.active.has(id)) return;
    const { y, height } = event.nativeEvent.layout;
    state.current.bounds.set(id, { y, height });
    check();
  }, [check]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    state.current.height = event.nativeEvent.layout.height;
    check();
  }, [check]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    state.current.offset = Math.max(0, event.nativeEvent.contentOffset.y);
    state.current.height = event.nativeEvent.layoutMeasurement.height;
    check();
  }, [check]);
  return useMemo(() => ({ focus, blur, cardLayout, scrollProps: { onLayout, onScroll, scrollEventThrottle: 100 } }), [focus, blur, cardLayout, onLayout, onScroll]);
}
