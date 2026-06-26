import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { G, Path, Polygon, Text as SvgText } from 'react-native-svg';

import { ECONOMY } from '@/core/config/economy';
import { t } from '@/core/i18n';
import { useCurrency } from '@/features/currency';
import { getAds } from '@/features/monetization';
import { useWheel } from '@/features/wheel';
import { AppButton, AppText, CoinBadge, colors, fonts, GlassPanel, WorldBackground } from '@/ui';

const SECTORS = ECONOMY.wheel.sectors;
const N = SECTORS.length;
const STEP = 360 / N;
const C = 150;
const R = 140;

function slice(start: number, end: number): string {
  const a0 = ((start - 90) * Math.PI) / 180;
  const a1 = ((end - 90) * Math.PI) / 180;
  const x0 = C + R * Math.cos(a0);
  const y0 = C + R * Math.sin(a0);
  const x1 = C + R * Math.cos(a1);
  const y1 = C + R * Math.sin(a1);
  return `M${C} ${C} L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`;
}

export default function Wheel() {
  const router = useRouter();
  const coins = useCurrency((s) => s.coins);
  const addCoins = useCurrency((s) => s.add);
  const canFree = useWheel((s) => s.canFree());
  const rewardedLeft = useWheel((s) => s.rewardedLeft());
  const spin = useWheel((s) => s.spin);
  const rotation = useSharedValue(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  const grant = (value: number) => {
    addCoins('coins', value);
    setResult(value);
    setBusy(false);
  };

  const doSpin = async (viaRewarded: boolean) => {
    if (busy) return;
    if (viaRewarded) {
      const r = await getAds().showRewarded('wheel');
      if (r !== 'rewarded') return;
    }
    const res = spin(viaRewarded);
    if (!res) return;
    setBusy(true);
    setResult(null);
    const target = 360 * 5 + (360 - (res.sector * STEP + STEP / 2));
    rotation.value = withTiming(rotation.value + target, { duration: 1500 }, (done) => {
      if (done) runOnJS(grant)(res.value);
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
          <CoinBadge value={coins} />
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <AppText preset="display">{t('wheel')}</AppText>

          <View style={{ width: 300, height: 320, alignItems: 'center' }}>
            <Polygon points="150,18 138,0 162,0" fill={colors.amber} />
            <Animated.View style={style}>
              <Svg width={300} height={300}>
                <G>
                  {SECTORS.map((v, i) => (
                    <Path
                      key={i}
                      d={slice(i * STEP, (i + 1) * STEP)}
                      fill={i % 2 === 0 ? colors.green : colors.greenDark}
                      stroke={colors.glassBorder}
                      strokeWidth={1}
                    />
                  ))}
                  {SECTORS.map((v, i) => {
                    const mid = ((i * STEP + STEP / 2 - 90) * Math.PI) / 180;
                    return (
                      <SvgText
                        key={`t${i}`}
                        x={C + R * 0.66 * Math.cos(mid)}
                        y={C + R * 0.66 * Math.sin(mid) + 6}
                        fontSize={20}
                        fontFamily={fonts.tile}
                        fill={colors.text}
                        textAnchor="middle"
                      >
                        {v}
                      </SvgText>
                    );
                  })}
                </G>
              </Svg>
            </Animated.View>
          </View>

          {result !== null ? (
            <GlassPanel strong style={{ paddingVertical: 10, paddingHorizontal: 20 }}>
              <AppText preset="title">Выигрыш: {result} 🪙</AppText>
            </GlassPanel>
          ) : null}

          <View style={{ gap: 10, alignItems: 'center' }}>
            <AppButton label={canFree ? 'Бесплатное вращение' : 'Уже крутили сегодня'} icon="wheel" large onPress={() => doSpin(false)} style={{ opacity: canFree && !busy ? 1 : 0.5 }} />
            <AppButton label={`За рекламу (${rewardedLeft})`} variant="glass" icon="play" onPress={() => doSpin(true)} style={{ opacity: rewardedLeft > 0 && !busy ? 1 : 0.5 }} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
