import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, View } from 'react-native';

type Bounds = { y: number; height: number };
export type ExposureObservation = { visibility_ms: number; visible_fraction: number; visibility_rule: 'half_1s_v2' };
// Preserve the last observed Activity focus across screen/overlay hook instances.
// Existing mounted hooks own the listeners; this does not add permanent subscriptions.
let androidWindowFocused = true;
export function isExposureWindowFocused(): boolean { return Platform.OS !== 'android' || androidWindowFocused; }

/** Exposure policy v2: at least half visible continuously for one foreground second. */
export function isExposed(bounds: Bounds, offset: number, viewportHeight: number): boolean {
  if (bounds.height <= 0 || viewportHeight <= 0) return false;
  const visible = Math.max(0, Math.min(bounds.y + bounds.height, offset + viewportHeight) - Math.max(bounds.y, offset));
  return visible >= bounds.height / 2;
}

/** Layouts are content coordinates. Call focus/blur from the screen's focus effect. */
export function useViewportExposure(onExposure: (id: string, observation?: ExposureObservation) => void, activeIds?: readonly string[], version = '') {
  const state = useRef({ focused: false, windowFocused: isExposureWindowFocused(), foreground: AppState.currentState === 'active' || AppState.currentState === null, version, generation: 0,
    offset: 0, height: 0, bounds: new Map<string, Bounds>(), measurements: new Map<string, number>(), seen: new Set<string>(),
    pending: new Map<string, ReturnType<typeof setTimeout>>(), active: activeIds ? new Set(activeIds) : null });
  const callback = useRef(onExposure);
  const cancelPending = useCallback(() => {
    for (const timer of state.current.pending.values()) clearTimeout(timer);
    state.current.pending.clear();
  }, []);
  const check = useCallback(() => {
    const current = state.current;
    if (!current.focused || !current.foreground || !current.windowFocused) { cancelPending(); return; }
    for (const [id, bounds] of current.bounds) {
      const visible = (!current.active || current.active.has(id)) && isExposed(bounds, current.offset, current.height);
      if (!visible) {
        const timer = current.pending.get(id);
        if (timer) clearTimeout(timer);
        current.pending.delete(id);
      } else if (!current.seen.has(id) && !current.pending.has(id)) {
        const startedAt = Date.now();
        current.pending.set(id, setTimeout(() => {
          current.pending.delete(id);
          const latest = current.bounds.get(id);
          if (!current.focused || !current.foreground || !current.windowFocused || !latest || current.active && !current.active.has(id)
            || !isExposed(latest, current.offset, current.height) || current.seen.has(id)) return;
          current.seen.add(id);
          const visible = Math.max(0, Math.min(latest.y + latest.height, current.offset + current.height) - Math.max(latest.y, current.offset));
          callback.current(id, { visibility_ms: Math.max(1_000, Date.now() - startedAt),
            visible_fraction: Math.min(1, visible / latest.height), visibility_rule: 'half_1s_v2' });
        }, 1_000));
      }
    }
  }, [cancelPending]);
  useLayoutEffect(() => {
    callback.current = onExposure;
    const current = state.current;
    if (current.version !== version) { cancelPending(); current.generation += 1; current.version = version; current.seen.clear(); }
    current.active = activeIds ? new Set(activeIds) : null;
    for (const id of current.bounds.keys()) {
      if (current.active && !current.active.has(id)) { const timer = current.pending.get(id); if (timer) clearTimeout(timer); current.pending.delete(id); current.bounds.delete(id); current.seen.delete(id); }
    }
    check();
  }, [onExposure, activeIds, version, check, cancelPending]);
  useEffect(() => {
    const current = state.current;
    const subscription = AppState.addEventListener('change', (next) => { state.current.foreground = next === 'active'; check(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { androidWindowFocused = false; current.windowFocused = false; check(); }) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => { androidWindowFocused = true; current.windowFocused = true; check(); }) : null;
    return () => { subscription.remove(); blur?.remove(); focus?.remove(); current.focused = false; current.generation += 1; cancelPending(); };
  }, [check, cancelPending]);
  // Let the focus refresh commit today's state before reusing last visit's measured layouts.
  const focus = useCallback(() => { cancelPending(); state.current.generation += 1; state.current.focused = true; state.current.seen.clear(); check(); }, [check, cancelPending]);
  const blur = useCallback(() => { state.current.focused = false; state.current.generation += 1; cancelPending(); }, [cancelPending]);
  const invalidate = useCallback((id: string) => {
    const current = state.current;
    const timer = current.pending.get(id);
    if (timer) clearTimeout(timer);
    current.pending.delete(id); current.bounds.delete(id);
    current.measurements.set(id, (current.measurements.get(id) ?? 0) + 1);
  }, []);
  const measureLayout = useCallback((id: string, node: View | null, contentRoot: View | null) => {
    invalidate(id);
    const current = state.current;
    const token = current.measurements.get(id);
    const generation = current.generation;
    if (!node || !contentRoot) return;
    node.measureLayout(contentRoot, (_x, y, _width, height) => {
      if (state.current.generation !== generation || state.current.measurements.get(id) !== token
        || !Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return;
      state.current.bounds.set(id, { y, height }); check();
    }, () => {});
  }, [check, invalidate]);
  const setViewport = useCallback((offset: number, height: number) => {
    if (!Number.isFinite(offset) || !Number.isFinite(height)) return;
    state.current.offset = Math.max(0, offset); state.current.height = Math.max(0, height); check();
  }, [check]);
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
  return useMemo(() => ({ focus, blur, invalidate, measureLayout, setViewport, cardLayout,
    scrollProps: { onLayout, onScroll, scrollEventThrottle: 100 } }), [focus, blur, invalidate, measureLayout, setViewport, cardLayout, onLayout, onScroll]);
}
