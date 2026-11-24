import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BannerAdSize, BannerView, MobileAds } from 'yandex-mobile-ads';

import { MONETIZATION } from '@/core/config/monetization';
import { getFullscreenSnapshot, subscribeFullscreen } from '@/core/fullscreen';

import { useEntitlements } from './entitlements';
import { createAdTelemetry, safeAdErrorProperties, type AdTelemetry } from './adTelemetry';

type AdBannerProps = { adUnitId?: string };
type MeasuredBanner = {
  layout: { width: number; windowHeight: number; adUnitId: string };
  size: BannerAdSize;
  telemetry: AdTelemetry;
};

function subscribeAppVisibility(listener: () => void): () => void {
  const subscription = AppState.addEventListener('change', listener);
  return () => subscription.remove();
}

export const AdBanner = memo(function AdBanner({
  adUnitId = MONETIZATION.yandex.bannerAdUnitId,
}: AdBannerProps = {}) {
  const removeAds = useEntitlements((s) => s.removeAds);
  const [focused, setFocused] = useState(false);
  const foreground = useSyncExternalStore(subscribeAppVisibility, () => AppState.currentState === 'active', () => false);
  const fullscreen = useSyncExternalStore(subscribeFullscreen, getFullscreenSnapshot, getFullscreenSnapshot);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); };
  }, []));
  // A same-app ad Activity can keep AppState active while the SDK refreshes an obscured banner.
  if (!MONETIZATION.adsEnabled || !MONETIZATION.bannerEnabled || removeAds || !focused || !foreground || fullscreen.owner !== null) return null;
  return <StickyBanner adUnitId={adUnitId} />;
});

// Hidden stack routes cannot load or auto-refresh a native banner.
function StickyBanner({ adUnitId }: { adUnitId: string }) {
  const { height: windowHeight } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState<MeasuredBanner | null>(null);
  const layout = useMemo(() => ({ width, windowHeight, adUnitId }), [width, windowHeight, adUnitId]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0);
  }, []);

  useEffect(() => {
    let active = true;
    if (layout.width <= 0) return;
    // Mediation can refine the sticky size after initialization completes.
    void (async () => {
      await MobileAds.initialize();
      if (!active) return;
      const size = await BannerAdSize.stickySize(layout.width);
      if (active) {
        const request = createAdTelemetry('banner', 'game_banner');
        request.emit('eligible');
        request.emit('requested');
        setMeasured({ layout, size, telemetry: request });
      }
    })()
      .catch(() => {
        if (active) setMeasured(null);
      });
    return () => {
      active = false;
    };
  }, [layout]);

  // Even returning to the old dimensions must not resurrect a discarded request.
  const banner = measured?.layout === layout ? measured : null;

  return (
    <View
      testID="ad-banner-slot"
      onLayout={onLayout}
      style={{ width: '100%', height: banner?.size.height ?? 0, flexShrink: 0, alignItems: 'center' }}
    >
      {banner ? <NativeBanner key={banner.telemetry.requestId} banner={banner} /> : null}
    </View>
  );
}

// Callbacks and dedupe state belong to this native view's immutable request.
const NativeBanner = memo(function NativeBanner({ banner }: { banner: MeasuredBanner }) {
  const { size, layout: { adUnitId }, telemetry } = banner;
  const active = useRef(true);
  const loaded = useRef(false);
  const impressionCallbacks = useRef(new Map<string, number>());
  const adRequest = useMemo(() => ({ adUnitId }), [adUnitId]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  return <BannerView
        size={size}
        adRequest={adRequest}
        onAdLoaded={() => {
          if (!active.current) return;
          // The RN SDK does not expose auto-refresh request IDs. Do not invent new requests.
          if (!loaded.current) telemetry.emit('loaded');
          loaded.current = true;
        }}
        onAdImpression={(event) => {
          if (!active.current) return;
          // Use the callback payload only for local duplicate detection; never transmit it.
          const key = event.nativeEvent.impressionData ?? 'unknown';
          let ordinal = impressionCallbacks.current.get(key);
          if (ordinal === undefined) {
            ordinal = impressionCallbacks.current.size;
            if (ordinal >= 128) return;
            impressionCallbacks.current.set(key, ordinal);
          }
          telemetry.emit('impression', { reason: ordinal ? 'sdk_refresh_request_unknown' : 'sdk_callback' }, ordinal);
        }}
        onAdClicked={() => { if (active.current) telemetry.emit('click'); }}
        onAdFailedToLoad={(event) => {
          if (!active.current) return;
          telemetry.emit('error', { reason: 'load_failed', ...safeAdErrorProperties(event.nativeEvent) });
          console.warn('[ads] Yandex banner failed', event.nativeEvent);
        }}
      />;
});
