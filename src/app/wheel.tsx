import { useGoBack } from '@/core/nav';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Polygon, Text as SvgText } from 'react-native-svg';

import { ECONOMY } from '@/core/config/economy';
import { t } from '@/core/i18n';
import { track } from '@/features/analytics';
import { useCurrency } from '@/features/currency';
import { requestRewarded } from '@/features/monetization';
import { useWheel } from '@/features/wheel';
import { AppButton, AppText, CoinBadge, colors, fonts, GlassPanel, Icon, WorldBackground } from '@/ui';

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
  const goBack = useGoBack();
  const coins = useCurrency((s) => s.coins);
  const addCoins = useCurrency((s) => s.add);
  const canFree = useWheel((s) => s.canFree());
  const rewardedLeft = useWheel((s) => s.rewardedLeft());
  const spin = useWheel((s) => s.spin);
  const rotation = useSharedValue(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [resultSector, setResultSector] = useState<number | null>(null);
  const [shownResult, setShownResult] = useState(0);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  useEffect(() => {
    if (result == null) return;
    setShownResult(0);
    const steps = 12;
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setShownResult(Math.round((result * current) / steps));
      if (current >= steps) clearInterval(timer);
    }, 32);
    return () => clearInterval(timer);
  }, [result]);

  const grant = (value: number, sector: number) => {
    addCoins('coins', value);
    track('coins_earned', { reason: 'wheel', amount: value });
    setResult(value);
    setResultSector(sector);
    setBusy(false);
  };

  const doSpin = async (viaRewarded: boolean) => {
    if (busy) return;
    if (viaRewarded) {
      const r = await requestRewarded('wheel');
      if (r !== 'rewarded') return;
    }
    const res = spin(viaRewarded);
    if (!res) return;
    setBusy(true);
    setResult(null);
    setResultSector(null);
    const target = 360 * 5 + (360 - (res.sector * STEP + STEP / 2));
    rotation.value = withTiming(rotation.value + target, { duration: 1500 }, (done) => {
      if (done) runOnJS(grant)(res.value, res.sector);
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
          <CoinBadge value={coins} />
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <AppText preset="display">{t('wheel')}</AppText>

          <View style={{ width: 300, height: 320, alignItems: 'center' }}>
            <Animated.View style={style}>
              <Svg width={300} height={300}>
                <G>
                  <Circle cx={C} cy={C} r={R + 8} fill={colors.glassStrong} />
                  {SECTORS.map((v, i) => (
                    <Path
                      key={i}
                      d={slice(i * STEP, (i + 1) * STEP)}
                      fill={resultSector === i ? colors.amber : i % 2 === 0 ? colors.green : colors.greenDark}
                      stroke={colors.glassBorder}
                      strokeWidth={resultSector === i ? 3 : 1.2}
                    />
                  ))}
                  {SECTORS.map((_, i) => {
                    const a = ((i * STEP - 90) * Math.PI) / 180;
                    return <Line key={`d${i}`} x1={C} y1={C} x2={C + R * Math.cos(a)} y2={C + R * Math.sin(a)} stroke={colors.glassBorder} strokeWidth={1} />;
                  })}
                  {SECTORS.map((v, i) => {
                    const mid = ((i * STEP + STEP / 2 - 90) * Math.PI) / 180;
                    return (
                      <SvgText
                        key={`t${i}`}
                        x={C + R * 0.66 * Math.cos(mid)}
                        y={C + R * 0.66 * Math.sin(mid) + 6}
                        fontSize={20}
                        fontFamily={fonts.tile}
                        fill={resultSector === i ? colors.onAmber : colors.text}
                        textAnchor="middle"
                      >
                        {v}
                      </SvgText>
                    );
                  })}
                  <Circle cx={C} cy={C} r={42} fill={colors.glassStrong} stroke={colors.gridHint} strokeWidth={2} />
                  <Circle cx={C} cy={C} r={18} fill={colors.amber} />
                </G>
              </Svg>
            </Animated.View>
            {/* Указатель — статичный оверлей поверх крутящегося диска (внутри своего <Svg>). */}
            <Svg width={300} height={20} style={{ position: 'absolute', top: 0, zIndex: 2 }} pointerEvents="none">
              <Polygon points="150,20 136,0 164,0" fill={colors.shadow} opacity={0.32} />
              <Polygon points="150,18 138,0 162,0" fill={colors.amber} />
            </Svg>
          </View>

          {result !== null ? (
            <GlassPanel strong style={{ paddingVertical: 10, paddingHorizontal: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="coin" size={22} color={colors.amber} />
                <AppText preset="title">Выигрыш: {shownResult}</AppText>
              </View>
            </GlassPanel>
          ) : null}

          <View style={{ gap: 10, alignItems: 'center' }}>
            <AppButton label={canFree ? 'Бесплатное вращение' : 'Уже крутили сегодня'} icon="wheel" large disabled={!canFree || busy} onPress={() => doSpin(false)} />
            <AppButton label={`За рекламу (${rewardedLeft})`} variant="glass" icon="play" disabled={rewardedLeft <= 0 || busy} onPress={() => doSpin(true)} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
