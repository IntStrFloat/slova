import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { BannerAdSize, BannerView } from 'yandex-mobile-ads';

import { MONETIZATION } from '@/core/config/monetization';

import { useEntitlements } from './entitlements';

type AdBannerProps = { adUnitId?: string };

export function AdBanner({
  adUnitId = MONETIZATION.yandex.bannerAdUnitId,
}: AdBannerProps = {}) {
  const { width } = useWindowDimensions();
  const removeAds = useEntitlements((s) => s.removeAds);
  const [size, setSize] = useState<BannerAdSize | null>(null);

  useEffect(() => {
    let active = true;
    if (!MONETIZATION.bannerEnabled || removeAds) return;
    BannerAdSize.stickySize(width)
      .then((next) => {
        if (active) setSize(next);
      })
      .catch(() => {
        if (active) setSize(null);
      });
    return () => {
      active = false;
    };
  }, [removeAds, width]);

  if (!MONETIZATION.bannerEnabled || removeAds || !size) return null;

  return (
    <View style={{ width: '100%', height: size.height, alignItems: 'center' }}>
      <BannerView
        size={size}
        adRequest={{ adUnitId }}
        onAdFailedToLoad={(event) => {
          console.warn('[ads] Yandex banner failed', event.nativeEvent);
        }}
      />
    </View>
  );
}
