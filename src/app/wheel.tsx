import { useGoBack } from '@/core/nav';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { cancelAnimation, Easing, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, G, Line, Path, Polygon, Text as SvgText } from 'react-native-svg';

import { ECONOMY } from '@/core/config/economy';
import { t } from '@/core/i18n';
import { trackOnce } from '@/features/analytics';
import { useCurrency } from '@/features/currency';
import { requestRewarded } from '@/features/monetization';
import { useWheel, type PendingWheelSpin } from '@/features/wheel';
import { wheelStopAngle } from '@/features/wheel/motion';
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
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const wheelSize = Math.min(300, width - 32, height < 700 ? 240 : height < 820 ? 260 : 300);
  const coins = useCurrency((s) => s.coins);
  const canFree = useWheel((s) => s.canFree());
  const rewardedLeft = useWheel((s) => s.rewardedLeft());
  const spin = useWheel((s) => s.spin);
  const pendingSpin = useWheel((s) => s.pendingSpin ?? null);
  const rotation = useSharedValue(0);
  const [busy, setBusy] = useState(Boolean(pendingSpin));
  const [result, setResult] = useState<number | null>(null);
  const [resultSector, setResultSector] = useState<number | null>(null);
  const [shownResult, setShownResult] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [awaitingAd, setAwaitingAd] = useState(false);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));

  useEffect(() => {
    if (result == null) return;
    const steps = 12;
    let current = 0;
    const start = setTimeout(() => setShownResult(0), 0);
    const timer = setInterval(() => {
      current += 1;
      setShownResult(Math.round((result * current) / steps));
      if (current >= steps) clearInterval(timer);
    }, 32);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [result]);

  const grant = useCallback((outcome: PendingWheelSpin) => {
    try {
      const wallet = useCurrency.getState();
      const applied = wallet.addOnce(outcome.effectId, 'coins', outcome.value);
      if (!applied && !wallet.hasApplied(outcome.effectId)) throw new Error('Wheel reward was not saved');
      useWheel.getState().claimPending(outcome.effectId);
      if (applied) trackOnce('coins_earned', outcome.effectId, { reason: 'wheel', amount: outcome.value });
      setResult(outcome.value);
      setResultSector(outcome.sector);
      setErrorMessage(null);
    } catch (error) {
      console.warn('[wheel] reward save deferred', error);
      setErrorMessage('Не удалось сохранить выигрыш. Повторите выдачу.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!pendingSpin) return;
    const target = wheelStopAngle(rotation.get(), pendingSpin.sector, N);
    if (reducedMotion) {
      rotation.set(target);
      const timer = setTimeout(() => grant(pendingSpin), 180);
      return () => clearTimeout(timer);
    }
    rotation.set(withTiming(target, {
      duration: 3_600,
      easing: Easing.bezier(0.77, 0, 0.175, 1),
    }, (finished) => {
      if (finished) scheduleOnRN(grant, pendingSpin);
    }));
    return () => cancelAnimation(rotation);
  }, [grant, pendingSpin, reducedMotion, rotation]);

  const doSpin = async (viaRewarded: boolean) => {
    if (busy || pendingSpin) return;
    setBusy(true);
    setResult(null);
    setResultSector(null);
    setErrorMessage(null);
    try {
      if (viaRewarded) {
        setAwaitingAd(true);
        const adResult = await requestRewarded('wheel');
        setAwaitingAd(false);
        if (adResult !== 'rewarded') {
          if (adResult === 'unavailable') {
            setErrorMessage('Реклама сейчас недоступна. Проверьте подключение и попробуйте позже.');
          }
          setBusy(false);
          return;
        }
      }
      if (!spin(viaRewarded)) setBusy(false);
    } catch (error) {
      console.warn('[wheel] spin save deferred', error);
      setAwaitingAd(false);
      setErrorMessage('Не удалось начать вращение. Повторите.');
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
          <CoinBadge value={coins} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
        >
          <AppText preset="display">{t('wheel')}</AppText>

          <View style={{ width: wheelSize, height: wheelSize + 12, alignItems: 'center' }}>
            <Animated.View style={style}>
              <Svg width={wheelSize} height={wheelSize} viewBox="0 0 300 300">
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
            <Svg width={wheelSize} height={20} viewBox="0 0 300 20" style={{ position: 'absolute', top: 0, zIndex: 2 }} pointerEvents="none">
              <Polygon points="150,20 136,0 164,0" fill={colors.shadow} opacity={0.32} />
              <Polygon points="150,18 138,0 162,0" fill={colors.amber} />
            </Svg>
          </View>

          {result !== null ? (
            <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(260)}>
              <GlassPanel strong style={{ paddingVertical: 10, paddingHorizontal: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="coin" size={22} color={colors.amber} />
                  <AppText preset="title">Выигрыш: {shownResult}</AppText>
                </View>
              </GlassPanel>
            </Animated.View>
          ) : null}

          {errorMessage ? <AppText preset="body" style={{ color: colors.cream, textAlign: 'center' }}>{errorMessage}</AppText> : null}
          {errorMessage && pendingSpin ? <AppButton label="Повторить выдачу" variant="accent" onPress={() => grant(pendingSpin)} /> : null}

          <View style={{ width: '100%', maxWidth: 360, gap: 10 }}>
            {canFree || busy ? (
              <AppButton label={busy ? awaitingAd ? 'Загрузка рекламы…' : 'Колесо вращается…' : 'Бесплатное вращение'} icon="wheel" large disabled={busy} onPress={() => doSpin(false)} style={{ alignSelf: 'stretch' }} />
            ) : (
              <AppText preset="body" style={{ color: colors.cream, textAlign: 'center', fontSize: 13, paddingVertical: 6 }}>
                Следующее бесплатное вращение завтра
              </AppText>
            )}
            <AppButton label={`За рекламу (${rewardedLeft})`} variant="glass" icon="play" disabled={rewardedLeft <= 0 || busy} onPress={() => doSpin(true)} style={{ alignSelf: 'stretch' }} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
